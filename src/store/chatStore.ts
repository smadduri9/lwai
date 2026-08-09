import { create } from "zustand";
import { newId } from "../lib/id";
import * as repo from "../db/workspaceRepository";
import type {
  Anchor,
  Artifact,
  Branch,
  Citation,
  Message,
  StreamPhase,
  StreamStatus,
  WindowMode,
} from "../types";
import {
  SUBCHAT_DEFAULT_BUBBLE,
  SUBCHAT_DEFAULT_FULL,
  clampRailSize,
  clampSubChatSize,
} from "../lib/subChatLayout";
import { centerFloatRect } from "../lib/subChatFloat";
import { scrollBackToOrigin } from "../lib/scrollToHighlight";
import { useUiStore } from "./uiStore";

export { newId } from "../lib/id";

export interface ChatStore {
  /** Active conversation id (IndexedDB). Null until workspace hydrates. */
  conversationId: string | null;
  branches: Record<string, Branch>;
  rootBranchId: string;
  topZIndex: number;

  streamingBranches: Record<string, StreamStatus>;

  createSubBranch: (anchor: Anchor, spawnPosition: { x: number; y: number }) => string;
  /**
   * Append more selected text into the branch anchor (API context).
   * Does not touch the composer draft.
   */
  appendSelectionContext: (branchId: string, text: string) => void;
  appendMessage: (branchId: string, role: Message["role"], content: string) => string;
  appendStreamDelta: (messageId: string, branchId: string, text: string) => void;
  addCitation: (messageId: string, branchId: string, citation: Citation) => void;
  addArtifact: (messageId: string, branchId: string, artifact: Artifact) => void;
  /** Patch a tool artifact (kind "tool", matched by tool id) with output/status. */
  updateToolArtifact: (
    messageId: string,
    branchId: string,
    toolId: string,
    patch: { output?: string; status?: "running" | "done" | "error"; input?: string },
  ) => void;
  /** Keep messageId; delete later messages on the branch and orphaned sub-branches. */
  truncateBranchFromMessage: (branchId: string, messageId: string) => void;
  updateUserMessage: (branchId: string, messageId: string, content: string) => void;
  setStreaming: (branchId: string, streaming: boolean) => void;
  setStreamStatus: (branchId: string, phase: StreamPhase, query?: string) => void;
  setRailSide: (branchId: string, side: "left" | "right") => void;
  setRailSize: (branchId: string, size: { w?: number; h?: number } | null) => void;
  /** Vertical slide offset for a docked card; null clears the override. */
  setRailOffsetY: (branchId: string, offsetY: number | null) => void;
  setWindowMode: (
    branchId: string,
    mode: WindowMode,
    /** When popping out of a rail, seed float position from the card's DOM rect. */
    positionFromDom?: { x: number; y: number },
  ) => void;
  setWindowRect: (
    branchId: string,
    rect: Partial<{ position: { x: number; y: number }; size: { width: number; height: number } }>,
  ) => void;
  focusWindow: (branchId: string) => void;
  /** Pop out (or reposition) a sub-chat as a centered float window. */
  floatSubChatToCenter: (branchId: string) => void;
  /**
   * Force every floating ("full") sub-chat back to docked ("bubble") so the
   * rail layout owns it. Called on back-navigation to the main chat — a
   * window may only float when the user explicitly floats it in this view.
   */
  dockFloatingWindows: () => void;
  deleteBranch: (branchId: string) => void;
  /** @deprecated Prefer workspaceStore.newChat — kept for tests. */
  clearAll: () => void;
}

function makeRootBranch(): Branch {
  return {
    id: newId(),
    parentBranchId: null,
    anchor: null,
    messages: [],
    window: null,
  };
}

function emptyChat() {
  const root = makeRootBranch();
  return {
    conversationId: null as string | null,
    branches: { [root.id]: root } as Record<string, Branch>,
    rootBranchId: root.id,
    topZIndex: 10,
    streamingBranches: {} as Record<string, StreamStatus>,
  };
}

/** Collect the ids of a branch and all of its descendants. */
export function collectSubtreeIds(branches: Record<string, Branch>, branchId: string): string[] {
  const ids: string[] = [branchId];
  for (const b of Object.values(branches)) {
    if (b.parentBranchId === branchId) {
      ids.push(...collectSubtreeIds(branches, b.id));
    }
  }
  return ids;
}

const BUBBLE_SIZE = { ...SUBCHAT_DEFAULT_BUBBLE };
const FULL_SIZE = { ...SUBCHAT_DEFAULT_FULL };

/** Always dock as bubble; WindowLayer floats when the parent has no visible rail. */
function dockOrFloatWindow(
  s0: { branches: Record<string, Branch> },
  parentId: string,
  spawnPosition: { x: number; y: number },
  zIndex: number,
) {
  const docked = Object.values(s0.branches).filter(
    (b) => b.parentBranchId === parentId && b.window?.mode === "bubble",
  );
  // Alternate left/right for every parent (page roots and nested mini-rails).
  // Prefer right first, then fill the thinner side.
  const leftCount = docked.filter((b) => (b.window?.railSide ?? "right") === "left").length;
  const railSide: "left" | "right" =
    leftCount < docked.length - leftCount ? "left" : "right";
  return {
    mode: "bubble" as const,
    position: spawnPosition,
    size: { ...BUBBLE_SIZE },
    zIndex,
    railSide,
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...emptyChat(),

  createSubBranch: (anchor, spawnPosition) => {
    const id = newId();
    const s0 = get();
    const zIndex = s0.topZIndex + 1;
    const parent = Object.values(s0.branches).find((b) =>
      b.messages.some((m) => m.id === anchor.sourceMessageId),
    );
    const parentId = parent?.id ?? s0.rootBranchId;
    const window = dockOrFloatWindow(s0, parentId, spawnPosition, zIndex);
    const branch: Branch = {
      id,
      parentBranchId: parentId,
      anchor,
      messages: [],
      window,
    };
    set((s) => ({
      branches: { ...s.branches, [id]: branch },
      topZIndex: zIndex,
    }));

    const conversationId = s0.conversationId;
    if (conversationId) {
      void repo
        .createSubBranch({ conversationId, anchor, spawnPosition, id })
        .catch(console.error);
    }

    return id;
  },

  appendSelectionContext: (branchId, text) => {
    const chunk = text.trim();
    if (!chunk) return;
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.anchor) return s;
      const existing = branch.anchor.quotedText.trimEnd();
      // Avoid duplicating the same chunk if the user re-selects it.
      if (existing.includes(chunk)) return s;
      const quotedText = existing ? `${existing}\n\n${chunk}` : chunk;
      const anchor: Anchor = {
        ...branch.anchor,
        quotedText,
        endOffset: branch.anchor.startOffset + quotedText.length,
      };
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, anchor },
        },
      };
    });
    const branch = get().branches[branchId];
    if (branch?.anchor) {
      void repo.updateBranchAnchor(branchId, branch.anchor).catch(console.error);
    }
  },

  appendMessage: (branchId, role, content) => {
    const id = newId();
    let createdAt = Date.now();
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      const last = branch.messages[branch.messages.length - 1];
      if (last && createdAt <= last.createdAt) createdAt = last.createdAt + 1;
      const message: Message = { id, role, content, branchId, createdAt };
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, messages: [...branch.messages, message] },
        },
      };
    });
    const conversationId = get().conversationId;
    if (conversationId) {
      void repo
        .appendMessage({ conversationId, branchId, role, content, id, createdAt })
        .catch(console.error);
    }
    return id;
  },

  appendStreamDelta: (messageId, branchId, text) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: {
            ...branch,
            messages: branch.messages.map((m) =>
              m.id === messageId ? { ...m, content: m.content + text } : m,
            ),
          },
        },
      };
    });
    void repo.appendStreamDelta(messageId, text).catch(console.error);
  },

  addCitation: (messageId, branchId, citation) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: {
            ...branch,
            messages: branch.messages.map((m) => {
              if (m.id !== messageId) return m;
              const existing = m.citations ?? [];
              if (existing.some((c) => c.url === citation.url)) return m;
              return { ...m, citations: [...existing, citation] };
            }),
          },
        },
      };
    });
    void repo.addCitation(messageId, citation).catch(console.error);
  },

  addArtifact: (messageId, branchId, artifact) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: {
            ...branch,
            messages: branch.messages.map((m) =>
              m.id === messageId ? { ...m, artifacts: [...(m.artifacts ?? []), artifact] } : m,
            ),
          },
        },
      };
    });
    void repo.addArtifact(messageId, artifact).catch(console.error);
  },

  updateToolArtifact: (messageId, branchId, toolId, patch) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: {
            ...branch,
            messages: branch.messages.map((m) => {
              if (m.id !== messageId) return m;
              const artifacts = (m.artifacts ?? []).map((a) =>
                a.kind === "tool" && a.id === toolId ? { ...a, ...patch } : a,
              );
              return { ...m, artifacts };
            }),
          },
        },
      };
    });
    void repo.updateToolArtifact(messageId, toolId, patch).catch(console.error);
  },

  truncateBranchFromMessage: (branchId, messageId) => {
    const s0 = get();
    const branch = s0.branches[branchId];
    if (!branch) return;
    const idx = branch.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const removedIds = new Set(branch.messages.slice(idx + 1).map((m) => m.id));
    const keptMessages = branch.messages.slice(0, idx + 1);

    const orphanRoots = Object.values(s0.branches).filter(
      (b) => b.anchor?.sourceMessageId && removedIds.has(b.anchor.sourceMessageId),
    );
    const doomed = new Set<string>();
    for (const orphan of orphanRoots) {
      for (const id of collectSubtreeIds(s0.branches, orphan.id)) doomed.add(id);
    }

    set((s) => {
      const branches: Record<string, Branch> = {};
      for (const [id, b] of Object.entries(s.branches)) {
        if (doomed.has(id)) continue;
        if (id === branchId) {
          branches[id] = { ...b, messages: keptMessages };
        } else {
          branches[id] = b;
        }
      }
      return { branches };
    });

    const conversationId = s0.conversationId;
    if (conversationId) {
      void repo
        .truncateBranchFromMessage(conversationId, branchId, messageId)
        .catch(console.error);
    }
  },

  updateUserMessage: (branchId, messageId, content) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: {
            ...branch,
            messages: branch.messages.map((m) =>
              m.id === messageId && m.role === "user" ? { ...m, content } : m,
            ),
          },
        },
      };
    });
    void repo.updateUserMessage(messageId, content).catch(console.error);
  },

  setStreaming: (branchId, streaming) => {
    set((s) => {
      const next = { ...s.streamingBranches };
      if (streaming) next[branchId] = { phase: "thinking" };
      else delete next[branchId];
      return { streamingBranches: next };
    });
  },

  setStreamStatus: (branchId, phase, query) => {
    set((s) => {
      if (!s.streamingBranches[branchId]) return s;
      return {
        streamingBranches: {
          ...s.streamingBranches,
          [branchId]: { phase, query: query ?? s.streamingBranches[branchId].query },
        },
      };
    });
  },

  setRailSide: (branchId, side) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: { ...branch.window, railSide: side } },
        },
      };
    });
    void repo.setRailSide(branchId, side).catch(console.error);
  },

  setRailSize: (branchId, size) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      const railSize =
        size === null ? undefined : clampRailSize({ ...branch.window.railSize, ...size });
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: { ...branch.window, railSize } },
        },
      };
    });
    void repo.setRailSize(branchId, size).catch(console.error);
  },

  setRailOffsetY: (branchId, offsetY) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      const railOffsetY =
        offsetY == null || !Number.isFinite(offsetY) ? undefined : Math.round(offsetY);
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: { ...branch.window, railOffsetY } },
        },
      };
    });
    void repo.setRailOffsetY(branchId, offsetY).catch(console.error);
  },

  setWindowMode: (branchId, mode, positionFromDom) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      const prev = branch.window;
      let { size, position } = prev;
      if (mode === "full" && prev.mode === "bubble") {
        size = clampSubChatSize({
          width: Math.max(size.width, FULL_SIZE.width),
          height: Math.max(size.height, FULL_SIZE.height),
        });
        if (positionFromDom) position = positionFromDom;
      }
      const restoreMode =
        mode === "minimized"
          ? prev.mode === "minimized"
            ? prev.restoreMode
            : prev.mode
          : undefined;
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: { ...prev, mode, size, position, restoreMode } },
        },
      };
    });
    void repo.setWindowMode(branchId, mode).catch(console.error);
    if (positionFromDom) {
      void repo.setWindowRect(branchId, { position: positionFromDom }).catch(console.error);
    }
    if (mode === "minimized") {
      const ui = useUiStore.getState();
      if (ui.selectionAskBranchId === branchId) ui.setSelectionAskBranch(null);
      // Phase 5: closing a sub-chat scrolls back to its origin highlight.
      const branch = get().branches[branchId];
      scrollBackToOrigin(branchId, branch?.anchor?.sourceMessageId);
    }
  },

  setWindowRect: (branchId, rect) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      const next = { ...branch.window, ...rect };
      if (rect.size) next.size = clampSubChatSize(rect.size);
      return {
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: next },
        },
      };
    });
    void repo.setWindowRect(branchId, rect).catch(console.error);
  },

  focusWindow: (branchId) => {
    set((s) => {
      const branch = s.branches[branchId];
      if (!branch?.window) return s;
      if (branch.window.zIndex === s.topZIndex) return s;
      const zIndex = s.topZIndex + 1;
      return {
        topZIndex: zIndex,
        branches: {
          ...s.branches,
          [branchId]: { ...branch, window: { ...branch.window, zIndex } },
        },
      };
    });
    void repo.focusWindow(branchId).catch(console.error);
  },

  floatSubChatToCenter: (branchId) => {
    const rect = centerFloatRect();
    const branch = get().branches[branchId];
    if (!branch?.window) return;
    // Mark origin so the float window can play a pop-in animation.
    if (typeof document !== "undefined") {
      document.documentElement.dataset.pendingFloatCenter = branchId;
    }
    const apply = () => {
      get().setWindowMode(branchId, "full", rect.position);
      get().setWindowRect(branchId, rect);
      get().focusWindow(branchId);
    };
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && "startViewTransition" in doc) {
      (
        doc as Document & {
          startViewTransition: (cb: () => void) => void;
        }
      ).startViewTransition(apply);
    } else {
      apply();
    }
  },

  dockFloatingWindows: () => {
    const changed: string[] = [];
    set((s) => {
      let dirty = false;
      const branches: Record<string, Branch> = { ...s.branches };
      for (const [id, b] of Object.entries(s.branches)) {
        if (id === s.rootBranchId || !b.window) continue;
        const w = b.window;
        if (w.mode === "full") {
          branches[id] = { ...b, window: { ...w, mode: "bubble" } };
          changed.push(id);
          dirty = true;
        } else if (w.mode === "minimized" && w.restoreMode === "full") {
          // Un-minimizing later must also dock, never re-float mid-screen.
          branches[id] = { ...b, window: { ...w, restoreMode: "bubble" } };
          dirty = true;
        }
      }
      return dirty ? { branches } : s;
    });
    for (const id of changed) {
      void repo.setWindowMode(id, "bubble").catch(console.error);
    }
  },

  deleteBranch: (branchId) => {
    const s0 = get();
    if (branchId === s0.rootBranchId) return;
    const sourceMessageId = s0.branches[branchId]?.anchor?.sourceMessageId ?? null;
    const doomed = new Set(collectSubtreeIds(s0.branches, branchId));
    set((s) => {
      const branches: Record<string, Branch> = {};
      for (const [id, b] of Object.entries(s.branches)) {
        if (!doomed.has(id)) branches[id] = b;
      }
      return { branches };
    });
    const conversationId = s0.conversationId;
    if (conversationId) {
      void repo.deleteBranch(conversationId, branchId).catch(console.error);
    }
    const ui = useUiStore.getState();
    if (ui.selectionAskBranchId && doomed.has(ui.selectionAskBranchId)) {
      ui.setSelectionAskBranch(null);
    }
    if (ui.activeBranchId && doomed.has(ui.activeBranchId)) {
      ui.setActiveBranch(null);
    }
    // Phase 5: after deleting a sub-chat, return to where it came from.
    if (sourceMessageId && !sourceMessageId.startsWith("note:")) {
      scrollBackToOrigin(branchId, sourceMessageId);
    }
  },

  clearAll: () => {
    // In-memory reset for unit tests that don't hydrate IndexedDB.
    set(emptyChat());
  },
}));
