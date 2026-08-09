import type { NotebookEntry } from "../types";

/** Notebooks that list this branch in linkedBranchIds. */
export function findNotebooksForBranch(
  notebooks: Record<string, NotebookEntry>,
  branchId: string,
): NotebookEntry[] {
  return Object.values(notebooks).filter((n) => n.linkedBranchIds.includes(branchId));
}
