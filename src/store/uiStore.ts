import { create } from "zustand";
import type { NoteAnchor } from "../types";

/** Pending "Add to Notebook" capture before the user saves supporting text. */
export interface NoteCapture {
  anchor: NoteAnchor;
  /** null = top-level note; otherwise nest under this parent. */
  parentNoteId: string | null;
  /** Viewport rect for positioning the capture panel. */
  rect: { left: number; top: number; bottom: number; width: number };
}

/** Ephemeral UI state: active sub-chat focus, drafts, and note capture. */
interface UiStore {
  activeBranchId: string | null;
  setActiveBranch: (branchId: string | null) => void;
  /**
   * Last subchat opened by text selection — used for focus; reuse only when
   * the exact same selection range is chosen again.
   */
  selectionAskBranchId: string | null;
  setSelectionAskBranch: (branchId: string | null) => void;
  /**
   * Unsent composer text keyed by branch id, so a draft survives the composer
   * unmounting (card deactivated, popped out to a window, docked back, ...).
   */
  drafts: Record<string, string>;
  setDraft: (branchId: string, text: string) => void;
  noteCapture: NoteCapture | null;
  setNoteCapture: (c: NoteCapture | null) => void;
  /** When true, NotebookEditor should place the caret after the latest capture. */
  pendingNoteCaret: boolean;
  requestNoteCaret: () => void;
  clearNoteCaret: () => void;
  /**
   * Developer Mode: exposes diagnostic UI (StatsBar, ContextInspector).
   * All underlying metrics keep being computed/stored regardless — this flag
   * only gates rendering. Persisted; flip via localStorage("subchat-dev-mode")
   * until a settings toggle ships.
   */
  devMode: boolean;
  setDevMode: (on: boolean) => void;
}

const DEV_MODE_KEY = "subchat-dev-mode";

export const useUiStore = create<UiStore>((set) => ({
  activeBranchId: null,
  setActiveBranch: (activeBranchId) => set({ activeBranchId }),

  selectionAskBranchId: null,
  setSelectionAskBranch: (selectionAskBranchId) => set({ selectionAskBranchId }),

  drafts: {},
  setDraft: (branchId, text) =>
    set((s) => {
      const drafts = { ...s.drafts };
      if (text) drafts[branchId] = text;
      else delete drafts[branchId];
      return { drafts };
    }),

  noteCapture: null,
  setNoteCapture: (noteCapture) => set({ noteCapture }),

  pendingNoteCaret: false,
  requestNoteCaret: () => set({ pendingNoteCaret: true }),
  clearNoteCaret: () => set({ pendingNoteCaret: false }),

  devMode: localStorage.getItem(DEV_MODE_KEY) === "1",
  setDevMode: (devMode) => {
    localStorage.setItem(DEV_MODE_KEY, devMode ? "1" : "0");
    set({ devMode });
  },
}));
