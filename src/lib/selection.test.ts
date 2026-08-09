import { describe, it, expect } from "vitest";
import { rangeToOffsets, sanitizeQuotedHtml, segmentContent } from "./selection";
import type { Anchor } from "../types";

function anchor(startOffset: number, endOffset: number, text = ""): Anchor {
  return { sourceMessageId: "m1", quotedText: text, startOffset, endOffset };
}

describe("segmentContent", () => {
  const content = "The quick brown fox jumps";

  it("returns one plain segment when there are no anchors", () => {
    expect(segmentContent(content, [])).toEqual([
      { text: content, start: 0, end: content.length, branchIds: [] },
    ]);
  });

  it("splits around a single anchor", () => {
    const segs = segmentContent(content, [{ branchId: "b1", anchor: anchor(4, 9, "quick") }]);
    expect(segs.map((s) => s.text)).toEqual(["The ", "quick", " brown fox jumps"]);
    expect(segs[1].branchIds).toEqual(["b1"]);
    expect(segs[0].branchIds).toEqual([]);
    expect(segs[2].branchIds).toEqual([]);
  });

  it("handles overlapping anchors with stacked branchIds", () => {
    const segs = segmentContent(content, [
      { branchId: "b1", anchor: anchor(4, 15) }, // "quick brown"
      { branchId: "b2", anchor: anchor(10, 19) }, // "brown fox"
    ]);
    const overlap = segs.find((s) => s.text === "brown");
    expect(overlap?.branchIds.sort()).toEqual(["b1", "b2"]);
    expect(segs.find((s) => s.text === "quick ")?.branchIds).toEqual(["b1"]);
    expect(segs.find((s) => s.text === " fox")?.branchIds).toEqual(["b2"]);
  });

  it("clamps out-of-range offsets", () => {
    const segs = segmentContent("abc", [{ branchId: "b1", anchor: anchor(1, 999) }]);
    expect(segs.map((s) => s.text)).toEqual(["a", "bc"]);
    expect(segs[1].branchIds).toEqual(["b1"]);
  });

  it("reconstructs the full content from segments", () => {
    const segs = segmentContent(content, [
      { branchId: "b1", anchor: anchor(0, 3) },
      { branchId: "b2", anchor: anchor(16, 25) },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(content);
  });
});

describe("rangeToOffsets", () => {
  it("computes offsets across mark boundaries", () => {
    const div = document.createElement("div");
    // Simulates a message already containing a highlight: "The <mark>quick</mark> brown fox"
    div.innerHTML = "The <mark>quick</mark> brown fox";
    document.body.appendChild(div);

    const textBefore = div.firstChild as Text; // "The "
    const markText = div.querySelector("mark")!.firstChild as Text; // "quick"
    const textAfter = div.lastChild as Text; // " brown fox"

    // Select from inside "The " (offset 2) to inside " brown fox" (offset 3),
    // spanning the <mark>: "e quick br" = plain-text offsets 2..12.
    const range = document.createRange();
    range.setStart(textBefore, 2);
    range.setEnd(textAfter, 3);

    expect(rangeToOffsets(div, range)).toEqual({ startOffset: 2, endOffset: 12 });

    // Selection entirely within the mark.
    const inner = document.createRange();
    inner.setStart(markText, 1);
    inner.setEnd(markText, 4);
    expect(rangeToOffsets(div, inner)).toEqual({ startOffset: 5, endOffset: 8 });

    div.remove();
  });

  it("returns null for collapsed or outside ranges", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    const other = document.createElement("div");
    other.textContent = "elsewhere";
    document.body.append(div, other);

    const collapsed = document.createRange();
    collapsed.setStart(div.firstChild!, 2);
    collapsed.setEnd(div.firstChild!, 2);
    expect(rangeToOffsets(div, collapsed)).toBeNull();

    const outside = document.createRange();
    outside.setStart(other.firstChild!, 0);
    outside.setEnd(other.firstChild!, 3);
    expect(rangeToOffsets(div, outside)).toBeNull();

    div.remove();
    other.remove();
  });
});

describe("sanitizeQuotedHtml", () => {
  it("keeps formatting tags and strips scripts/buttons/marks", () => {
    const html = sanitizeQuotedHtml(
      `<p>Hello <strong>world</strong></p><script>alert(1)</script><button>x</button><mark>hi</mark>`,
    );
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<p>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("button");
    expect(html).not.toContain("<mark");
    expect(html).toContain("hi");
  });

  it("keeps safe http links and unwraps unsafe ones", () => {
    const safe = sanitizeQuotedHtml(`<a href="https://example.com" onclick="x">go</a>`);
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('rel="noopener noreferrer"');
    expect(safe).not.toContain("onclick");

    const unsafe = sanitizeQuotedHtml(`<a href="javascript:alert(1)">bad</a>`);
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).toContain("bad");
  });

  it("preserves tables and cell layout attrs", () => {
    const html = sanitizeQuotedHtml(
      `<table onclick="x"><thead><tr><th colspan="2">A</th></tr></thead><tbody><tr><td rowspan="1">1</td><td>2</td></tr></tbody></table>`,
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="1"');
    expect(html).not.toContain("onclick");
  });

  it("preserves headings and blockquotes", () => {
    const html = sanitizeQuotedHtml(`<h2>Title</h2><blockquote>quote</blockquote>`);
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<blockquote>quote</blockquote>");
  });
});
