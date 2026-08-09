import { describe, expect, it } from "vitest";
import { extractNoteHeadings } from "./noteOutline";

describe("extractNoteHeadings", () => {
  it("lists h1/h2 with ids and assigns missing ids", () => {
    const { items, html } = extractNoteHeadings(
      `<h1>One</h1><p>x</p><h2 data-heading-id="keep">Two</h2>`,
    );
    expect(items).toHaveLength(2);
    expect(items[0].level).toBe(1);
    expect(items[0].text).toBe("One");
    expect(items[0].id).toMatch(/^h-/);
    expect(items[1].id).toBe("keep");
    expect(items[1].level).toBe(2);
    expect(html).toContain('data-heading-id="keep"');
    expect(html).toContain("data-heading-id=");
  });
});
