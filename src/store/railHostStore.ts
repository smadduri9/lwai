import { create } from "zustand";

type HostCounts = { page: number; compact: number };

/**
 * Tracks which branch ids currently have a mounted CommentRail surface.
 * Nested bubble children float only when their parent is absent from this set
 * (or a page rail is CSS-hidden at the current breakpoint).
 */
interface RailHostStore {
  hosts: Record<string, HostCounts>;
  register: (parentId: string, compact?: boolean) => void;
  unregister: (parentId: string, compact?: boolean) => void;
}

function bump(counts: HostCounts | undefined, compact: boolean, delta: number): HostCounts | null {
  const next: HostCounts = {
    page: counts?.page ?? 0,
    compact: counts?.compact ?? 0,
  };
  if (compact) next.compact = Math.max(0, next.compact + delta);
  else next.page = Math.max(0, next.page + delta);
  if (next.page === 0 && next.compact === 0) return null;
  return next;
}

export const useRailHostStore = create<RailHostStore>((set) => ({
  hosts: {},
  register: (parentId, compact = false) =>
    set((s) => {
      const next = bump(s.hosts[parentId], compact, 1)!;
      return { hosts: { ...s.hosts, [parentId]: next } };
    }),
  unregister: (parentId, compact = false) =>
    set((s) => {
      const next = bump(s.hosts[parentId], compact, -1);
      const hosts = { ...s.hosts };
      if (!next) delete hosts[parentId];
      else hosts[parentId] = next;
      return { hosts };
    }),
}));
