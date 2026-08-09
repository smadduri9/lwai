import { describe, expect, it } from "vitest";
import { findNotebooksForBranch } from "./noteLinks";
import type { NotebookEntry } from "../types";

function notebook(partial: Partial<NotebookEntry> & Pick<NotebookEntry, "id">): NotebookEntry {
  return {
    title: "Doc",
    body: "<h1>Doc</h1>",
    linkedBranchIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("findNotebooksForBranch", () => {
  it("returns notebooks that link the branch", () => {
    const notebooks = {
      a: notebook({ id: "a", linkedBranchIds: ["b1", "b2"] }),
      b: notebook({ id: "b", linkedBranchIds: ["b3"] }),
      c: notebook({ id: "c" }),
    };
    expect(findNotebooksForBranch(notebooks, "b1").map((n) => n.id)).toEqual(["a"]);
    expect(findNotebooksForBranch(notebooks, "b3").map((n) => n.id)).toEqual(["b"]);
    expect(findNotebooksForBranch(notebooks, "nope")).toEqual([]);
  });
});
