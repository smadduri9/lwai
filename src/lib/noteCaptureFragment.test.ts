import { describe, expect, it } from "vitest";
import { buildCaptureFragment, escapeNoteHtml } from "./noteCaptureFragment";

describe("buildCaptureFragment", () => {
  it("builds quote + comment + trailing empty line with a capture timestamp", () => {
    const html = buildCaptureFragment("Hello broski", "broski?");
    expect(html).toMatch(
      /^<blockquote data-capture="1" data-captured-at="\d+"><p>"Hello broski" from this chat<\/p><\/blockquote><p>broski\?<\/p><p><br><\/p>$/,
    );
  });

  it("wraps from this chat in a link when sourceHref is set", () => {
    const href = "/?c=chat1&focusMessage=m1";
    const html = buildCaptureFragment("Hello broski", "broski?", { sourceHref: href });
    expect(html).toContain(
      `<p>"Hello broski" <a href="${escapeNoteHtml(href)}">from this chat</a></p></blockquote>`,
    );
    expect(html).toContain(`data-captured-at=`);
    expect(html).toContain(`<p>broski?</p>`);
    expect(html).toContain(`<p><br></p>`);
  });

  it("escapes href attributes", () => {
    const html = buildCaptureFragment("q", "", {
      sourceHref: `/?x="evil"&y=<z>`,
    });
    expect(html).toContain(`href="${escapeNoteHtml(`/?x="evil"&y=<z>`)}"`);
    expect(html).not.toContain(`href="/?x="evil"`);
  });

  it("builds quote + empty comment + trailing empty line when no thought", () => {
    const html = buildCaptureFragment("Hello broski", "");
    expect(html).toMatch(
      /^<blockquote data-capture="1" data-captured-at="\d+"><p>"Hello broski" from this chat<\/p><\/blockquote><p><br><\/p><p><br><\/p>$/,
    );
  });

  it("builds thought-only without a fake quote", () => {
    const html = buildCaptureFragment("", "just a thought");
    expect(html).toBe(`<p>just a thought</p><p><br></p>`);
    expect(html).not.toContain("data-capture");
    expect(html).not.toContain("from this chat");
  });

  it("returns empty when both are blank", () => {
    expect(buildCaptureFragment("", "")).toBe("");
    expect(buildCaptureFragment("  ", "\n")).toBe("");
  });

  it("escapes HTML in quote and thought", () => {
    const html = buildCaptureFragment(`<b>x</b> & "y"`, `<script>`);
    expect(html).toContain(escapeNoteHtml(`<b>x</b> & "y"`));
    expect(html).toContain(`<p>${escapeNoteHtml(`<script>`)}</p>`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("data-capture-html");
  });

  it("does not emit data-capture-html for plain text", () => {
    expect(buildCaptureFragment("hi", "there")).not.toContain("data-capture-html");
  });
});

describe("buildCaptureFragment richHtml", () => {
  it("embeds rich HTML verbatim inside the capture blockquote", () => {
    const rich = `<table><tbody><tr><td>1</td></tr></tbody></table>`;
    const html = buildCaptureFragment("1", "", { richHtml: rich });
    expect(html).toContain(`<div data-capture-html="1">${rich}</div>`);
    expect(html).toContain(`data-capture="1"`);
    expect(html).not.toContain(`"1" from this chat`);
  });

  it("keeps the source link with rich HTML captures", () => {
    const html = buildCaptureFragment("q", "note", {
      richHtml: "<p><strong>q</strong></p>",
      sourceHref: "/?c=c1&focusMessage=m1",
    });
    expect(html).toContain(`<a href="/?c=c1&amp;focusMessage=m1">from this chat</a>`);
    expect(html).toContain("<p>note</p>");
  });

  it("builds a fragment from rich HTML alone (e.g. image-only selections)", () => {
    const html = buildCaptureFragment("", "", { richHtml: `<img src="http://x/y.png">` });
    expect(html).toContain(`data-capture-html="1"`);
  });
});
