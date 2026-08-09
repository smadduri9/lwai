import { create } from "zustand";
import { newId } from "../lib/id";

export interface Toast {
  id: string;
  message: string;
  /** Optional action rendered as a link-style button. */
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, action?: Toast["action"]) => void;
  dismiss: (id: string) => void;
}

const TOAST_MS = 3200;

/** Lightweight global toast queue (used by Add to Notebook, tool errors, …). */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, action) => {
    const id = newId();
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
