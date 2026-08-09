import { describe, expect, it } from "vitest";
import { isDescendantOf } from "./branchLineage";
import type { Branch } from "../types";

function branch(
  id: string,
  parentBranchId: string | null,
): Branch {
  return {
    id,
    parentBranchId,
    anchor: null,
    messages: [],
    window: null,
  };
}

describe("isDescendantOf", () => {
  const branches: Record<string, Branch> = {
    root: branch("root", null),
    a: branch("a", "root"),
    b: branch("b", "root"),
    a1: branch("a1", "a"),
    a1x: branch("a1x", "a1"),
  };

  it("returns false for self", () => {
    expect(isDescendantOf(branches, "a", "a")).toBe(false);
  });

  it("returns true for direct child", () => {
    expect(isDescendantOf(branches, "a1", "a")).toBe(true);
  });

  it("returns true for nested descendant", () => {
    expect(isDescendantOf(branches, "a1x", "a")).toBe(true);
    expect(isDescendantOf(branches, "a1x", "root")).toBe(true);
  });

  it("returns false for siblings and ancestors", () => {
    expect(isDescendantOf(branches, "b", "a")).toBe(false);
    expect(isDescendantOf(branches, "a", "a1")).toBe(false);
    expect(isDescendantOf(branches, "root", "a")).toBe(false);
  });
});
