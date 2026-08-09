import type { Anchor, NoteAnchor } from "../types";
import type { PendingSelection } from "../store/selectionStore";
import { chatUrl } from "./chatUrl";
import { useChatStore } from "../store/chatStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

function spawnPositionFromRect(rect: PendingSelection["rect"]) {
  return {
    x: Math.min(Math.max(rect.left, 12), window.innerWidth - 380),
    y: Math.min(rect.bottom + 8, window.innerHeight - 220),
  };
}

function focusComposer(branchId: string) {
  useUiStore.getState().setActiveBranch(branchId);
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      `textarea[data-branch-id="${branchId}"]`,
    );
    el?.focus({ preventScroll: true });
  });
}

function parentIdForPending(pending: PendingSelection): string | null {
  const chat = useChatStore.getState();
  if (pending.kind === "chat" && pending.anchor) {
    const a = pending.anchor as Anchor;
    const parent = Object.values(chat.branches).find((b) =>
      b.messages.some((m) => m.id === a.sourceMessageId),
    );
    return parent?.id ?? chat.rootBranchId;
  }
  return null;
}

/** True when the branch anchor is the exact same selection range. */
function anchorsMatchExact(
  branchAnchor: Anchor | null | undefined,
  pending: PendingSelection,
): boolean {
  if (!branchAnchor || !pending.anchor) return false;
  if (pending.kind === "chat") {
    const a = pending.anchor as Anchor;
    return (
      branchAnchor.sourceMessageId === a.sourceMessageId &&
      branchAnchor.startOffset === a.startOffset &&
      branchAnchor.endOffset === a.endOffset
    );
  }
  return false;
}

function isReusableSelectionBranch(
  branchId: string,
  pending: PendingSelection,
  opts?: { allowMinimized?: boolean },
): boolean {
  const chat = useChatStore.getState();
  const branch = chat.branches[branchId];
  if (!branch?.window) return false;
  if (!opts?.allowMinimized && branch.window.mode === "minimized") return false;

  const expectedParent = parentIdForPending(pending);
  if (!expectedParent || branch.parentBranchId !== expectedParent) return false;
  return anchorsMatchExact(branch.anchor, pending);
}

/** Find an existing child with the exact same selection (not a different quote). */
function findExactSelectionBranch(
  pending: PendingSelection,
  opts?: { allowMinimized?: boolean },
): string | null {
  const ui = useUiStore.getState();
  if (
    ui.selectionAskBranchId &&
    isReusableSelectionBranch(ui.selectionAskBranchId, pending, opts)
  ) {
    return ui.selectionAskBranchId;
  }

  const chat = useChatStore.getState();
  const expectedParent = parentIdForPending(pending);
  if (!expectedParent) return null;

  for (const b of Object.values(chat.branches)) {
    if (b.parentBranchId !== expectedParent || !b.window) continue;
    if (!opts?.allowMinimized && b.window.mode === "minimized") continue;
    if (anchorsMatchExact(b.anchor, pending)) return b.id;
  }
  return null;
}

function selectionText(pending: PendingSelection): string {
  if (pending.kind === "chat" || pending.kind === "note") {
    return (pending.anchor?.quotedText ?? "").trim();
  }
  return "";
}

/** Drop drafts that were wrongly seeded with the selection quote. */
function scrubSelectionDraft(branchId: string, selection: string) {
  const ui = useUiStore.getState();
  const draft = (ui.drafts[branchId] ?? "").trim();
  if (!draft) return;
  const anchorQuote =
    useChatStore.getState().branches[branchId]?.anchor?.quotedText?.trim() ?? "";
  if (
    draft === selection ||
    (anchorQuote && draft === anchorQuote) ||
    (selection && draft.startsWith(selection) && draft.length <= selection.length + 2)
  ) {
    ui.setDraft(branchId, "");
  }
}

/**
 * Create or reuse a selection ask branch for a *chat* selection.
 * Reuses only when the exact same selection range already has a card.
 * Does not focus composer / clear selection — callers decide surface behavior.
 */
function resolveSelectionBranch(
  pending: PendingSelection,
  opts?: { allowMinimizedReuse?: boolean },
): string | null {
  if (pending.kind !== "chat" || !pending.anchor) return null;

  const chat = useChatStore.getState();
  const pos = spawnPositionFromRect(pending.rect);
  const text = selectionText(pending);

  let branchId = findExactSelectionBranch(pending, {
    allowMinimized: opts?.allowMinimizedReuse,
  });

  if (!branchId) {
    branchId = chat.createSubBranch(pending.anchor as Anchor, pos);
  } else {
    // Exact same selection — focus existing card; do not append quotes.
    chat.focusWindow(branchId);
  }

  if (!branchId) return null;
  scrubSelectionDraft(branchId, text);
  return branchId;
}

/**
 * Open or reuse a docked subchat for a chat text selection.
 * The selection lives on the branch anchor for API context only — the
 * composer stays empty so the user can type their question.
 * Notebook ("note") selections spawn a brand-new top-level chat instead.
 */
export function openSelectionSubchat(pending: PendingSelection): string | null {
  if (pending.kind === "note") {
    void openChatFromNoteSelection(pending);
    return null;
  }

  const branchId = resolveSelectionBranch(pending);
  if (!branchId) return null;

  const ui = useUiStore.getState();
  ui.setSelectionAskBranch(branchId);
  ui.setActiveBranch(branchId);
  useSelectionStore.getState().setPending(null);
  window.getSelection()?.removeAllRanges();
  focusComposer(branchId);
  return branchId;
}

/**
 * Notebook text selection → a new top-level chat whose root branch carries
 * the selection as a synthetic anchor, opened in a new tab (current page is
 * left exactly as it is).
 */
export async function openChatFromNoteSelection(
  pending: PendingSelection,
): Promise<string | null> {
  if (pending.kind !== "note" || !pending.anchor) return null;
  const na = pending.anchor as NoteAnchor;
  const sourceNoteId = na.sourceNoteId;
  if (!sourceNoteId) return null;

  const rootAnchor: Anchor = {
    sourceMessageId: `note:${sourceNoteId}`,
    quotedText: na.quotedText,
    quotedHtml: na.quotedHtml,
    startOffset: na.startOffset ?? 0,
    endOffset: na.endOffset ?? na.quotedText.length,
  };

  const { createChat } = await import("../db/workspaceRepository");
  const conversation = await createChat({ title: "New chat", rootAnchor });
  const { useNotebookStore } = await import("../store/notebookStore");
  useNotebookStore.getState().linkBranch(sourceNoteId, conversation.rootBranchId);

  useSelectionStore.getState().setPending(null);
  window.getSelection()?.removeAllRanges();
  window.open(chatUrl({ conversationId: conversation.id }), "_blank");
  return conversation.id;
}

/**
 * Create/reuse a selection ask from a cramped side subchat, minimize it so it
 * does not nest in the parent's mini-rail, and open the ask in a new tab.
 */
export function openSelectionAskInNewTab(pending: PendingSelection): string | null {
  if (pending.kind !== "chat") return null;

  const branchId = resolveSelectionBranch(pending, { allowMinimizedReuse: true });
  if (!branchId) return null;

  const chat = useChatStore.getState();
  const ui = useUiStore.getState();
  const workspace = useWorkspaceStore.getState();

  chat.setWindowMode(branchId, "minimized");
  ui.setSelectionAskBranch(branchId);
  useSelectionStore.getState().setPending(null);
  window.getSelection()?.removeAllRanges();

  const url = chatUrl({ conversationId: workspace.conversationId, branchId });
  window.open(url, "_blank");
  return branchId;
}

/** Whether the window currently has a non-empty text selection. */
export function hasWindowTextSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
}

/**
 * Add the current window selection into this subchat's API context (anchor).
 * Does not put text into the composer.
 */
export function appendCurrentWindowSelection(): boolean {
  const branchId = useUiStore.getState().selectionAskBranchId;
  if (!branchId) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const text = sel.toString().trim();
  if (!text) return false;
  useChatStore.getState().appendSelectionContext(branchId, text);
  return true;
}
