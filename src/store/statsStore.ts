import { create } from "zustand";
import type { UsageUpdate } from "../lib/streamChat";

/** Everything we know about the most recent (or in-flight) response. */
export interface ResponseStats extends UsageUpdate {
  /** Messages assembled and sent upstream for this request. */
  contextMessages?: number;
  /** Total characters of that assembled context. */
  contextChars?: number;
}

export interface SessionTotals {
  responses: number;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  codeRuns: number;
}

interface StatsStore {
  last: ResponseStats | null;
  session: SessionTotals;
  beginRequest: (contextMessages: number, contextChars: number) => void;
  updateLast: (patch: UsageUpdate) => void;
  /** Fold the finished response into the session totals. */
  finishResponse: () => void;
}

const emptySession: SessionTotals = {
  responses: 0,
  inputTokens: 0,
  outputTokens: 0,
  searches: 0,
  codeRuns: 0,
};

/** Ephemeral per-session stats for the dev stats bar. Not persisted. */
export const useStatsStore = create<StatsStore>()((set) => ({
  last: null,
  session: { ...emptySession },

  beginRequest: (contextMessages, contextChars) =>
    set({ last: { contextMessages, contextChars } }),

  updateLast: (patch) =>
    set((s) => ({ last: { ...s.last, ...patch } })),

  finishResponse: () =>
    set((s) => ({
      session: {
        responses: s.session.responses + 1,
        inputTokens: s.session.inputTokens + (s.last?.inputTokens ?? 0),
        outputTokens: s.session.outputTokens + (s.last?.outputTokens ?? 0),
        searches: s.session.searches + (s.last?.searches ?? 0),
        codeRuns: s.session.codeRuns + (s.last?.codeRuns ?? 0),
      },
    })),
}));
