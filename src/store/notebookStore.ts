import { create } from "zustand";
import * as repo from "../db/workspaceRepository";
import { sourceChatUrl } from "../lib/focusChat";
import { materializeCaptureImages } from "../lib/noteCapture";
import { buildCaptureFragment } from "../lib/noteCaptureFragment";
import { sanitizeNoteHtml } from "../lib/noteHtml";
import { useToastStore } from "./toastStore";
import type { NoteAnchor, NotebookEntry } from "../types";

interface NotebookStore {
  /** All notebooks, hydrated from IndexedDB. */
  notebooks: Record<string, NotebookEntry>;
  /** Global capture target — persisted in IndexedDB meta. */
  lastUsedNotebookId: string | null;
  hydrate: () => Promise<void>;
  createNotebook: (title: string) => Promise<string>;
  renameNotebook: (id: string, title: string) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;
  /** Change the global capture target. */
  setLastUsedNotebook: (id: string) => void;
  /**
   * Append a capture (quote + optional thought) to a notebook.
   * Targets `opts.notebookId`, else the last-used notebook (created on demand).
   * Shows a toast and returns the notebook id, or null on failure.
   */
  appendCapture: (
    anchor: NoteAnchor,
    supportingText: string,
    opts?: { notebookId?: string; silent?: boolean },
  ) => Promise<string | null>;
  updateBody: (notebookId: string, html: string) => void;
  linkBranch: (notebookId: string, branchId: string) => void;
  unlinkBranch: (notebookId: string, branchId: string) => void;
}

/** Notebooks sorted most-recently-updated first. */
export function sortedNotebooks(notebooks: Record<string, NotebookEntry>): NotebookEntry[] {
  return Object.values(notebooks).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useNotebookStore = create<NotebookStore>((set) => ({
  notebooks: {},
  lastUsedNotebookId: null,

  hydrate: async () => {
    const [notebooks, lastUsedNotebookId] = await Promise.all([
      repo.loadNotebooks(),
      repo.getLastUsedNotebookId(),
    ]);
    set({ notebooks, lastUsedNotebookId });
  },

  createNotebook: async (title) => {
    const record = await repo.createNotebook(title.trim() || "Untitled");
    const notebooks = await repo.loadNotebooks();
    set({ notebooks, lastUsedNotebookId: record.id });
    return record.id;
  },

  renameNotebook: async (id, title) => {
    const next = title.trim();
    if (!next) return;
    await repo.renameNotebook(id, next);
    set((s) => {
      const nb = s.notebooks[id];
      if (!nb) return s;
      return {
        notebooks: { ...s.notebooks, [id]: { ...nb, title: next, updatedAt: Date.now() } },
      };
    });
  },

  deleteNotebook: async (id) => {
    await repo.deleteNotebook(id);
    const [notebooks, lastUsedNotebookId] = await Promise.all([
      repo.loadNotebooks(),
      repo.getLastUsedNotebookId(),
    ]);
    set({ notebooks, lastUsedNotebookId });
  },

  setLastUsedNotebook: (id) => {
    set({ lastUsedNotebookId: id });
    void repo.setLastUsedNotebookId(id).catch(console.error);
  },

  appendCapture: async (anchor, supportingText, opts) => {
    const quote = anchor.quotedText.trim();
    const thought = supportingText.trim();
    const rich = anchor.quotedHtml?.trim() ?? "";
    if (!quote && !thought && !rich) return null;

    try {
      // Resolve target notebook: explicit > last-used > create default.
      let target = opts?.notebookId ? await repo.getNotebook(opts.notebookId) : undefined;
      if (!target) target = await repo.ensureDefaultNotebook();
      if (opts?.notebookId && target.id !== opts.notebookId) return null;

      let sourceHref: string | null = null;
      if (anchor.sourceMessageId && !anchor.sourceMessageId.startsWith("note:")) {
        const { useChatStore } = await import("./chatStore");
        const chat = useChatStore.getState();
        sourceHref = sourceChatUrl({
          sourceMessageId: anchor.sourceMessageId,
          conversationId: chat.conversationId,
          branchId: anchor.branchId,
          rootBranchId: chat.rootBranchId,
        });
      }
      // Rich HTML (tables, math, code, diagrams, images) is always preserved
      // so notebook captures render exactly like the chat; plain text is the
      // fallback when no rich markup was captured.
      let fragment = buildCaptureFragment(quote, thought, {
        sourceHref,
        richHtml: rich || null,
      });
      if (!fragment) return target.id;

      if (fragment.includes("<img")) {
        fragment = await materializeCaptureImages(fragment, target.id);
      } else {
        fragment = sanitizeNoteHtml(fragment);
      }
      if (!fragment.trim()) return target.id;

      await repo.appendToNotebook({ notebookId: target.id, htmlFragment: fragment });
      await repo.setLastUsedNotebookId(target.id);
      if (anchor.branchId) {
        await repo.linkBranch(target.id, anchor.branchId).catch(console.error);
      }
      const notebooks = await repo.loadNotebooks();
      set({ notebooks, lastUsedNotebookId: target.id });

      if (!opts?.silent) {
        useToastStore.getState().show(`Added to ${target.title}`);
      }
      return target.id;
    } catch (e) {
      console.error(e);
      useToastStore.getState().show("Could not add to notebook");
      return null;
    }
  },

  updateBody: (notebookId, html) => {
    set((s) => {
      const nb = s.notebooks[notebookId];
      if (!nb) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [notebookId]: { ...nb, body: html, updatedAt: Date.now() },
        },
      };
    });
    void repo.updateNotebookBody(notebookId, html).catch(console.error);
  },

  linkBranch: (notebookId, branchId) => {
    set((s) => {
      const nb = s.notebooks[notebookId];
      if (!nb || nb.linkedBranchIds.includes(branchId)) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [notebookId]: {
            ...nb,
            linkedBranchIds: [...nb.linkedBranchIds, branchId],
            updatedAt: Date.now(),
          },
        },
      };
    });
    void repo.linkBranch(notebookId, branchId).catch(console.error);
  },

  unlinkBranch: (notebookId, branchId) => {
    set((s) => {
      const nb = s.notebooks[notebookId];
      if (!nb) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [notebookId]: {
            ...nb,
            linkedBranchIds: nb.linkedBranchIds.filter((id) => id !== branchId),
            updatedAt: Date.now(),
          },
        },
      };
    });
    void repo.unlinkBranch(notebookId, branchId).catch(console.error);
  },
}));
