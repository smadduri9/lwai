import { create } from "zustand";

export interface DemoCursor {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
}

/**
 * Automated demo mode. While `active`, the send pipeline short-circuits to
 * scripted replies (dequeued FIFO) so the demo is deterministic and needs no
 * model/server; DemoRunner drives an artificial cursor + typing sequence.
 */
interface DemoStore {
  active: boolean;
  cursor: DemoCursor;
  /** Scripted assistant replies, consumed in order by streamAssistantReply. */
  queue: string[];
  start: (replies: string[]) => void;
  stop: () => void;
  dequeueReply: () => string | null;
  setCursor: (c: Partial<DemoCursor>) => void;
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  active: false,
  cursor: { x: -100, y: -100, visible: false, clicking: false },
  queue: [],

  start: (replies) =>
    set({
      active: true,
      queue: [...replies],
      cursor: { x: window.innerWidth / 2, y: -40, visible: true, clicking: false },
    }),

  stop: () =>
    set({
      active: false,
      queue: [],
      cursor: { x: -100, y: -100, visible: false, clicking: false },
    }),

  dequeueReply: () => {
    const [next, ...rest] = get().queue;
    if (next === undefined) return null;
    set({ queue: rest });
    return next;
  },

  setCursor: (c) => set((s) => ({ cursor: { ...s.cursor, ...c } })),
}));
