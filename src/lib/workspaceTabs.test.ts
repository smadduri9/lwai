import { describe, expect, it, vi, beforeEach } from "vitest";

describe("workspaceTabs keys", () => {
  it("builds stable tab keys", async () => {
    const { askTabKey, noteTabKey, branchTabKey } = await import("./workspaceTabs");
    expect(askTabKey("s1")).toBe("ask:s1");
    expect(noteTabKey("s1")).toBe("note:s1");
    expect(branchTabKey("b1")).toBe("branch:b1");
  });
});

describe("openOrFocusWorkspaceTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a new tab when no peer answers", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { openOrFocusWorkspaceTab, askTabKey } = await import("./workspaceTabs");

    openOrFocusWorkspaceTab({ key: askTabKey("s1"), url: "/?s=s1" });

    await new Promise((r) => setTimeout(r, 130));
    expect(open).toHaveBeenCalledWith("/?s=s1", "_blank");
  });
});
