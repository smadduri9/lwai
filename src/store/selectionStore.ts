import { create } from "zustand";
import type { Anchor, NoteAnchor } from "../types";

/** Ephemeral selection state driving the floating toolbar. */
export interface PendingSelection {
  /** Chat text, note-body text, or a clicked chat image. */
  kind: "chat" | "note" | "image";
  /** Present for chat/note text selections. */
  anchor?: Anchor | NoteAnchor;
  /** Present for image selections. */
  imageSrc?: string;
  imageAlt?: string;
  sourceMessageId?: string;
  /**
   * Surface the selection was made on. "rail" (docked side-rail subchat)
   * selections route "Ask more" into a new app tab instead of nesting a
   * floating box. Absent = main chat paper / branch tab.
   */
  origin?: "main" | "rail" | "float" | "tab";
  /** Viewport rect of the selection, for positioning the toolbar + panels. */
  rect: { left: number; top: number; bottom: number; width: number };
}

interface SelectionStore {
  pending: PendingSelection | null;
  setPending: (p: PendingSelection | null) => void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
