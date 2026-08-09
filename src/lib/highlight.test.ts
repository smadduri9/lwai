import { describe, it, expect } from "vitest";
import {
  applyHighlights,
  isAnchorOrphaned,
  repairAnchorRange,
  type HighlightItem,
} from "./highlight";
import { anchorText } from "./selection";
import type { Anchor } from "../types";

function anchor(startOffset: number, endOffset: number, quotedText: string): Anchor {
  return { sourceMessageId: "m1", quotedText, startOffset, endOffset };
}

function item(branchId: string, a: Anchor, overrides: Partial<HighlightItem> = {}): HighlightItem {
  return { branchId, anchor: a, minimized: false, active: false, messageCount: 0, ...overrides };
}

describe("repairAnchorRange", () => {
  const text = "The quick brown fox jumps over the lazy dog";

  it("keeps offsets that still match the quote", () => {
    expect(repairAnchorRange(text, anchor(4, 9, "quick"))).toEqual({ start: 4, end: 9 });
  });

  it("falls back to searching when offsets drifted (markdown migration)", () => {
    // Offsets point at the wrong place but the quote still exists in the text.
    expect(repairAnchorRange(text, anchor(0, 5, "brown fox"))).toEqual({ start: 10, end: 19 });
  });

  it("returns null when the quote no longer exists", () => {
    expect(repairAnchorRange(text, anchor(0, 5, "vanished"))).toBeNull();
  });

  it("handles offsets beyond the text length via search", () => {
    expect(repairAnchorRange("short", anchor(100, 105, "short"))).toEqual({ start: 0, end: 5 });
  });

  it("scores repeated quotes by prefix/suffix context (TextQuoteSelector)", () => {
    const repeated = "the cat sat. later, the cat ran away fast.";
    // Two occurrences of "the cat" (0 and 21). Context says the second one.
    const a: Anchor = {
      sourceMessageId: "m1",
      quotedText: "the cat",
      startOffset: 5, // drifted
      endOffset: 12,
      prefix: "later, ",
      suffix: " ran away",
    };
    expect(repairAnchorRange(repeated, a)).toEqual({ start: 20, end: 27 });
  });

  it("prefers the occurrence nearest the stored offset when context ties", () => {
    const repeated = "abc word abc word abc";
    const a: Anchor = {
      sourceMessageId: "m1",
      quotedText: "abc",
      startOffset: 17, // near the third occurrence (18)
      endOffset: 20,
    };
    expect(repairAnchorRange(repeated, a)).toEqual({ start: 18, end: 21 });
  });
});

describe("isAnchorOrphaned", () => {
  it("is false when the quote exists verbatim", () => {
    expect(isAnchorOrphaned("hello brave world", anchor(6, 11, "brave"))).toBe(false);
  });

  it("is false when the quote matches modulo whitespace", () => {
    expect(isAnchorOrphaned("hello  brave\nworld", anchor(0, 0, "brave world"))).toBe(false);
  });

  it("is true when the quote is gone", () => {
    expect(isAnchorOrphaned("entirely different text", anchor(0, 5, "vanished quote"))).toBe(true);
  });
});

describe("anchorText (opaque subtree walk)", () => {
  it("skips KaTeX MathML duplicates so offsets stay stable", () => {
    const div = document.createElement("div");
    div.innerHTML =
      "<p>before <span class='katex'>" +
      "<span class='katex-mathml'>duplicate math</span>" +
      "<span class='katex-html'>E=mc2</span>" +
      "</span> after</p>";
    document.body.appendChild(div);
    expect(anchorText(div)).toBe("before E=mc2 after");
    div.remove();
  });

  it("skips [data-anchor-skip] subtrees (diagrams, decorations)", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>alpha <span data-anchor-skip>DIAGRAM TEXT</span>beta</p>";
    document.body.appendChild(div);
    expect(anchorText(div)).toBe("alpha beta");
    div.remove();
  });
});

describe("applyHighlights", () => {
  it("wraps a range across markdown element boundaries", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>The <strong>quick</strong> brown fox</p>";
    document.body.appendChild(div);

    // "quick brown" spans out of the <strong>.
    applyHighlights(div, [item("b1", anchor(4, 15, "quick brown"))]);

    const marks = [...div.querySelectorAll('mark[data-branch-id="b1"]')];
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks.map((m) => m.textContent).join("")).toBe("quick brown");
    // textContent unchanged by wrapping.
    expect(div.textContent).toBe("The quick brown fox");
    div.remove();
  });

  it("is idempotent: re-applying replaces old marks instead of nesting them", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>hello wonderful world</p>";
    document.body.appendChild(div);

    applyHighlights(div, [item("b1", anchor(6, 15, "wonderful"))]);
    applyHighlights(div, [item("b1", anchor(6, 15, "wonderful"))]);

    expect(div.querySelectorAll("mark").length).toBe(1);
    expect(div.querySelector("mark")!.textContent).toBe("wonderful");
    div.remove();
  });

  it("adds a badge after the highlight for minimized branches", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>some anchored text here</p>";
    document.body.appendChild(div);

    applyHighlights(div, [
      item("b1", anchor(5, 13, "anchored"), { minimized: true, messageCount: 4 }),
    ]);

    const badge = div.querySelector<HTMLButtonElement>("button.subchat-badge");
    expect(badge).not.toBeNull();
    expect(badge!.dataset.branchId).toBe("b1");
    expect(badge!.textContent).toContain("4");
    expect(div.querySelector("mark")!.dataset.minimized).toBe("true");
    div.remove();
  });

  it("nests overlapping anchors and marks depth", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>alpha beta gamma delta</p>";
    document.body.appendChild(div);

    applyHighlights(div, [
      item("outer", anchor(0, 16, "alpha beta gamma")),
      item("inner", anchor(6, 10, "beta")),
    ]);

    const inner = div.querySelector<HTMLElement>('mark[data-branch-id="inner"]');
    expect(inner).not.toBeNull();
    expect(inner!.dataset.depth).toBe("2");
    expect(inner!.closest('mark[data-branch-id="outer"]')).not.toBeNull();
    expect(div.textContent).toBe("alpha beta gamma delta");
    div.remove();
  });

  it("never wraps marks inside KaTeX subtrees", () => {
    const div = document.createElement("div");
    div.innerHTML =
      "<p>see <span class='katex'><span class='katex-html'>x+y</span></span> here</p>";
    document.body.appendChild(div);

    // Range covers "see x+y here" — the katex glyphs must stay unwrapped.
    applyHighlights(div, [item("b1", anchor(0, 12, "see x+y here"))]);
    const marks = [...div.querySelectorAll("mark")];
    expect(marks.length).toBeGreaterThan(0);
    expect(div.querySelector(".katex mark")).toBeNull();
    div.remove();
  });

  it("skips text inside notebook capture blockquotes", () => {
    const div = document.createElement("div");
    div.innerHTML =
      `<blockquote data-capture="1"><p>"Ocean's Rhythm" from this chat</p></blockquote>` +
      `<p>my note</p>`;
    document.body.appendChild(div);

    applyHighlights(div, [item("b1", anchor(1, 16, "Ocean's Rhythm"))]);

    expect(div.querySelectorAll("mark").length).toBe(0);
    expect(div.querySelector("[data-capture]")!.textContent).toContain("Ocean's Rhythm");
    div.remove();
  });
});
