import type { Branch } from "../types";

/** True when `id` is a strict descendant of `ancestorId` (not itself). */
export function isDescendantOf(
  branches: Record<string, Branch>,
  id: string,
  ancestorId: string,
): boolean {
  if (id === ancestorId) return false;
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = branches[cur]?.parentBranchId ?? null;
  }
  return false;
}

/**
 * True when this branch's root carries a notebook-selection anchor
 * (chat spawned from a notebook via "Ask more").
 */
export function isNotebookSpawnedLineage(
  branches: Record<string, Branch>,
  branchId: string,
): boolean {
  let id: string | null = branchId;
  const seen = new Set<string>();
  while (id) {
    const b: Branch | undefined = branches[id];
    if (!b) return false;
    if (b.parentBranchId === null) {
      return Boolean(b.anchor?.sourceMessageId.startsWith("note:"));
    }
    if (seen.has(id)) return false;
    seen.add(id);
    id = b.parentBranchId;
  }
  return false;
}
