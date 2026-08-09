import { describe, expect, it } from "vitest";
import { noteTitleFromHtml } from "./noteTitle";

describe("noteTitleFromHtml", () => {
  it("reads the first h1", () => {
    expect(noteTitleFromHtml("<h1>Hello</h1><p>body</p>")).toBe("Hello");
  });

  it("falls back to Untitled when missing", () => {
    expect(noteTitleFromHtml("<p>no heading</p>")).toBe("Untitled");
  });
});
