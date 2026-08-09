import { describe, expect, it } from "vitest";
import { plainTextToNoteHtml, sanitizeNoteHtml } from "./noteHtml";

describe("noteHtml", () => {
  it("wraps plain text paragraphs", () => {
    const html = plainTextToNoteHtml("hello\n\nworld");
    expect(html).toContain("<p>");
    expect(html).toContain("hello");
    expect(html).toContain("world");
  });

  it("strips script tags", () => {
    const dirty = `<p>ok</p><script>alert(1)</script><strong>bold</strong>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).toContain("ok");
    expect(clean.toLowerCase()).toContain("strong");
  });

  it("keeps attachment imgs and strips others", () => {
    const dirty = `<p>x</p><img data-attachment-id="att1" src="blob:evil" alt="pic"><img src="https://evil.example/x.png">`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).toContain('data-attachment-id="att1"');
    expect(clean).not.toContain("https://evil");
    expect(clean).not.toContain("blob:evil");
  });

  it("keeps h1/h2 and data-heading-id", () => {
    const dirty = `<h1 data-heading-id="h-1">Title</h1><h2 data-heading-id="h-2" style="color:red" onclick="x()">Sub</h2><h3>kept</h3>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean.toLowerCase()).toContain("<h1");
    expect(clean.toLowerCase()).toContain("<h2");
    expect(clean).toContain('data-heading-id="h-1"');
    expect(clean).toContain('data-heading-id="h-2"');
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("style=");
    expect(clean.toLowerCase()).toContain("<h3");
    expect(clean).toContain("Sub");
    expect(clean).toContain("kept");
  });

  it("keeps pre/code and blockquote", () => {
    const dirty = `<pre><code>def foo():\n  return 1</code></pre><blockquote><p>quote</p></blockquote><p>inline <code>x</code></p>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean.toLowerCase()).toContain("<pre");
    expect(clean.toLowerCase()).toContain("<code");
    expect(clean).toContain("def foo()");
    expect(clean.toLowerCase()).toContain("<blockquote");
    expect(clean).toContain("quote");
  });

  it("keeps safe http links and strips others", () => {
    const dirty = `<p><a href="https://example.com">ok</a><a href="javascript:alert(1)">bad</a></p>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).toContain('href="https://example.com"');
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("ok");
    expect(clean).toContain("bad");
  });

  it("keeps same-app relative focus links without target blank", () => {
    const href = "/?s=sess&focusMessage=m1&focusNote=n1";
    const dirty = `<blockquote data-capture="1"><p>"hi" <a href="${href}">from this chat</a></p></blockquote>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
    expect(clean).toContain("from this chat");
    expect(clean).not.toContain('target="_blank"');
  });

  it("strips protocol-relative and javascript hrefs", () => {
    const dirty = `<p><a href="//evil.example/x">a</a><a href="javascript:alert(1)">b</a></p>`;
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).not.toContain("//evil");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("a");
    expect(clean).toContain("b");
  });
});
