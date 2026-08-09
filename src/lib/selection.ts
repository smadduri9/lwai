import type { Anchor, Branch } from "../types";

/** Tags kept when capturing a selection as HTML for notebook quotes. */
const ALLOWED_TAGS = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "CODE",
  "A",
  "P",
  "UL",
  "OL",
  "LI",
  "BR",
  "PRE",
  "SPAN",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "H1",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
  "HR",
  "IMG",
]);

/** Harmless layout attrs kept on table cells. */
const KEEP_ATTRS = new Set(["colspan", "rowspan", "scope"]);

/**
 * Clone a DOM Range into a sanitized HTML string suitable for notebook quotes.
 * Strips scripts/styles/marks/badges and keeps a small formatting tag set.
 */
export function rangeToQuotedHtml(range: Range): string {
  const frag = range.cloneContents();
  const wrap = document.createElement("div");
  wrap.appendChild(frag);
  sanitizeQuoteNode(wrap);
  return wrap.innerHTML.trim();
}

/** Sanitize an HTML string the same way as a live Range clone (for tests). */
export function sanitizeQuotedHtml(html: string): string {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  sanitizeQuoteNode(wrap);
  return wrap.innerHTML.trim();
}

/** Classes preserved outside a KaTeX subtree (rendering-critical hooks). */
const KEEP_CLASS_RE = /^(katex|hljs|language-)/;

/** True when unsafe CSS could sneak through an inline style. */
function isUnsafeStyle(style: string): boolean {
  return /url\s*\(|expression|@import|position\s*:\s*(fixed|absolute)/i.test(style);
}

/**
 * Strip all attributes except rendering-critical presentation:
 * - class: kept whole inside a `.katex` subtree, otherwise filtered to
 *   katex/hljs/language- prefixes (KaTeX + highlight.js CSS hooks).
 * - style: kept only inside `.katex` (KaTeX spacing depends on it), scrubbed.
 * Returns true when the element retains presentation value.
 */
function keepPresentationAttrs(el: Element): boolean {
  const insideKatex = Boolean(el.closest(".katex"));
  const cls = el.getAttribute("class") ?? "";
  const style = el.getAttribute("style") ?? "";
  for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
  const keptCls = insideKatex
    ? cls.trim()
    : cls
        .split(/\s+/)
        .filter((c) => KEEP_CLASS_RE.test(c))
        .join(" ");
  if (keptCls) el.setAttribute("class", keptCls);
  if (insideKatex && style && !isUnsafeStyle(style)) {
    el.setAttribute("style", style);
  }
  return insideKatex || keptCls.length > 0;
}

function sanitizeQuoteNode(root: HTMLElement): void {
  // Rendered mermaid diagrams: swap the whole widget for its source so the
  // notebook can re-render it with the exact same MermaidDiagram pipeline.
  for (const el of [...root.querySelectorAll("[data-mermaid-source]")]) {
    const source = el.getAttribute("data-mermaid-source") ?? "";
    const pre = document.createElement("pre");
    pre.setAttribute("data-mermaid-source", "1");
    pre.textContent = source;
    el.replaceWith(pre);
  }
  // Any remaining inline SVG (icons, charts) cannot round-trip — drop it.
  for (const el of [...root.querySelectorAll("svg")]) el.remove();
  // KaTeX's hidden MathML duplicate would double the text content.
  for (const el of [...root.querySelectorAll(".katex-mathml")]) el.remove();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];
  const toUnwrap: Element[] = [];
  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "BUTTON") {
      toRemove.push(node);
    } else if (tag === "MARK" || !ALLOWED_TAGS.has(tag)) {
      toUnwrap.push(node);
    } else if (tag === "IMG") {
      const src =
        (node as HTMLImageElement).getAttribute("src") ||
        (node as HTMLImageElement).getAttribute("data-src") ||
        "";
      const alt = (node.getAttribute("alt") ?? "").slice(0, 200);
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
      if (src && (src.startsWith("http") || src.startsWith("blob:") || src.startsWith("data:"))) {
        node.setAttribute("src", src);
        node.setAttribute("data-chat-image", "1");
        if (alt) node.setAttribute("alt", alt);
      } else {
        toRemove.push(node);
      }
    } else if (tag === "A") {
      const href = node.getAttribute("href");
      // Keep only safe http(s) links; drop other attributes.
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
      if (href && /^https?:\/\//i.test(href)) {
        node.setAttribute("href", href);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        toUnwrap.push(node);
      }
    } else if (tag === "SPAN") {
      // KaTeX/highlight.js spans keep their classes; plain markdown wrapper
      // spans are unwrapped, keeping children.
      if (!keepPresentationAttrs(node)) toUnwrap.push(node);
    } else if (tag === "PRE") {
      const isMermaid = node.hasAttribute("data-mermaid-source");
      keepPresentationAttrs(node);
      if (isMermaid) node.setAttribute("data-mermaid-source", "1");
    } else if (tag === "TH" || tag === "TD") {
      const kept: Array<[string, string]> = [];
      for (const attr of [...node.attributes]) {
        if (KEEP_ATTRS.has(attr.name.toLowerCase())) {
          kept.push([attr.name, attr.value]);
        }
        node.removeAttribute(attr.name);
      }
      for (const [name, value] of kept) node.setAttribute(name, value);
    } else {
      // Formatting tags: drop attributes, keeping presentation classes only.
      keepPresentationAttrs(node);
    }
    node = walker.nextNode() as Element | null;
  }
  for (const el of toRemove) el.remove();
  for (const el of toUnwrap) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

/**
 * Subtrees excluded from the anchor text model. KaTeX renders the math twice
 * (visible HTML + accessibility MathML); counting the MathML duplicate would
 * shift every offset after a formula, so it is skipped everywhere: offset
 * computation, highlight wrapping, and quoted-text extraction.
 */
const ANCHOR_SKIP_SELECTOR = ".katex-mathml, [data-anchor-skip]";

/** True when this text node is excluded from the anchor text model. */
export function isSkippedAnchorText(node: Node): boolean {
  const el = node.parentElement;
  return Boolean(el?.closest(ANCHOR_SKIP_SELECTOR));
}

/** Text nodes of `container` in document order, minus skipped subtrees. */
export function anchorTextNodes(container: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!isSkippedAnchorText(node)) out.push(node as Text);
    node = walker.nextNode();
  }
  return out;
}

/** The anchor text model: rendered plain text minus skipped subtrees. */
export function anchorText(container: Node): string {
  return anchorTextNodes(container)
    .map((t) => t.data)
    .join("");
}

/** Length of prefix/suffix context captured around a quote (W3C TextQuoteSelector). */
export const ANCHOR_CONTEXT_CHARS = 32;

/**
 * Compute character offsets of a DOM Range relative to the anchor text model
 * of `container`, by walking its text nodes in document order. Works across
 * `<mark>` boundaries because only text nodes are counted.
 * Returns null when the range does not fall inside the container.
 */
export function rangeToOffsets(
  container: Node,
  range: Range,
): { startOffset: number; endOffset: number } | null {
  let start = -1;
  let end = -1;
  let count = 0;

  for (const text of anchorTextNodes(container)) {
    if (text === range.startContainer) start = count + range.startOffset;
    if (text === range.endContainer) end = count + range.endOffset;
    count += text.data.length;
  }

  // Handle ranges whose boundaries are element nodes (e.g. triple-click).
  if (start === -1 && container.contains(range.startContainer)) {
    start = offsetOfBoundary(container, range.startContainer, range.startOffset);
  }
  if (end === -1 && container.contains(range.endContainer)) {
    end = offsetOfBoundary(container, range.endContainer, range.endOffset);
  }

  if (start === -1 || end === -1 || start >= end) return null;
  return { startOffset: start, endOffset: end };
}

function offsetOfBoundary(container: Node, boundaryNode: Node, boundaryOffset: number): number {
  // The boundary is (elementNode, childIndex): count text before that child.
  const before = document.createRange();
  before.selectNodeContents(container);
  try {
    before.setEnd(boundaryNode, boundaryOffset);
  } catch {
    return -1;
  }
  return before.toString().length;
}

export interface Segment {
  text: string;
  start: number;
  end: number;
  /** Branch ids of anchors covering this segment (empty = plain text). */
  branchIds: string[];
}

/**
 * Split `content` at every anchor boundary so each segment is either plain or
 * covered by a stable set of anchors. Used to render `<mark>` highlights.
 */
export function segmentContent(
  content: string,
  anchors: { branchId: string; anchor: Anchor }[],
): Segment[] {
  const boundaries = new Set<number>([0, content.length]);
  for (const { anchor } of anchors) {
    boundaries.add(clamp(anchor.startOffset, 0, content.length));
    boundaries.add(clamp(anchor.endOffset, 0, content.length));
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start === end) continue;
    const branchIds = anchors
      .filter(({ anchor }) => anchor.startOffset <= start && anchor.endOffset >= end)
      .map(({ branchId }) => branchId);
    segments.push({ text: content.slice(start, end), start, end, branchIds });
  }
  return segments;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** All sub-branches anchored to a given message. */
export function anchorsForMessage(
  branches: Record<string, Branch>,
  messageId: string,
): { branchId: string; anchor: Anchor }[] {
  const result: { branchId: string; anchor: Anchor }[] = [];
  for (const b of Object.values(branches)) {
    if (b.anchor && b.anchor.sourceMessageId === messageId) {
      result.push({ branchId: b.id, anchor: b.anchor });
    }
  }
  return result;
}
