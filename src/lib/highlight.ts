import type { Anchor } from "../types";
import { ANCHOR_CONTEXT_CHARS, anchorText, anchorTextNodes } from "./selection";

/**
 * Anchor offsets are relative to the *rendered* anchor text of a message
 * (see selection.ts anchorText — textContent minus KaTeX duplicates), so they
 * keep working when messages render as markdown/math. These helpers repair
 * drifted anchors W3C TextQuoteSelector-style (prefix/suffix scoring) and
 * imperatively wrap the anchored ranges of a rendered DOM subtree in <mark>
 * elements. Anchors that cannot be located degrade to "orphaned" — never
 * deleted.
 */

export interface HighlightItem {
  branchId: string;
  anchor: Anchor;
  minimized: boolean;
  active: boolean;
  /** Shown in the minimized badge. */
  messageCount: number;
}

/** Length of the longest common suffix of a and b. */
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the longest common prefix of a and b. */
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Resolve an anchor to a concrete [start, end) range in `text`, following the
 * W3C TextQuoteSelector model:
 * 1. Fast path — stored offsets still match the exact quote.
 * 2. Otherwise score every occurrence of the quote by how well its actual
 *    surrounding text matches the stored prefix/suffix (proximity to the
 *    stored offset breaks ties).
 * 3. No occurrence at all → null (the anchor is orphaned; keep the card).
 */
export function repairAnchorRange(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  if (
    anchor.endOffset <= text.length &&
    text.slice(anchor.startOffset, anchor.endOffset) === anchor.quotedText
  ) {
    return { start: anchor.startOffset, end: anchor.endOffset };
  }

  const quote = anchor.quotedText;
  if (!quote) return null;

  let best: { start: number; end: number } | null = null;
  let bestScore = -Infinity;
  let idx = text.indexOf(quote);
  while (idx !== -1) {
    const before = text.slice(Math.max(0, idx - ANCHOR_CONTEXT_CHARS), idx);
    const after = text.slice(idx + quote.length, idx + quote.length + ANCHOR_CONTEXT_CHARS);
    let score = 0;
    if (anchor.prefix) score += commonSuffixLen(before, anchor.prefix);
    if (anchor.suffix) score += commonPrefixLen(after, anchor.suffix);
    // Proximity tiebreak: prefer the occurrence nearest the stored offset.
    score -= Math.abs(idx - anchor.startOffset) / Math.max(text.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = { start: idx, end: idx + quote.length };
    }
    idx = text.indexOf(quote, idx + 1);
  }
  return best;
}

/** Whitespace-insensitive orphan check against a message's raw content. */
export function isAnchorOrphaned(sourceContent: string, anchor: Anchor): boolean {
  const quote = anchor.quotedText.trim();
  if (!quote) return false;
  if (sourceContent.includes(quote)) return false;
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  return !squash(sourceContent).includes(squash(quote));
}

/**
 * Remove all previously applied highlight marks and badges, then re-wrap the
 * text ranges for `items`. Idempotent; safe to run after every render.
 * Anchors that cannot be located are skipped here (their cards render an
 * orphaned state instead).
 */
export function applyHighlights(container: HTMLElement, items: HighlightItem[]): void {
  // 1. Unwrap old marks and remove badges.
  for (const badge of container.querySelectorAll("button.subchat-badge")) {
    badge.remove();
  }
  for (const mark of container.querySelectorAll("mark[data-branch-id]")) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  container.normalize();

  const text = anchorText(container);

  // 2. Wrap each anchored range. Later (newer) anchors nest inside earlier
  // ones when they overlap; wrapping never changes the anchor text, so
  // offsets stay valid across iterations.
  for (const item of items) {
    const range = repairAnchorRange(text, item.anchor);
    if (!range) continue;
    const marks = wrapRange(container, range.start, range.end, item);
    if (item.minimized && marks.length > 0) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "subchat-badge";
      badge.dataset.branchId = item.branchId;
      badge.title = "Reopen sub-chat";
      badge.textContent = `Chat ${item.messageCount}`;
      const last = marks[marks.length - 1];
      last.parentNode?.insertBefore(badge, last.nextSibling);
    }
  }
}

function wrapRange(
  container: HTMLElement,
  start: number,
  end: number,
  item: HighlightItem,
): HTMLElement[] {
  // Collect target text nodes first: wrapping mutates the tree.
  const targets: { node: Text; s: number; e: number }[] = [];
  let pos = 0;
  for (const t of anchorTextNodes(container)) {
    const len = t.data.length;
    const s = Math.max(start - pos, 0);
    const e = Math.min(end - pos, len);
    if (s < e) targets.push({ node: t, s, e });
    pos += len;
  }

  const marks: HTMLElement[] = [];
  for (const { node, s, e } of targets) {
    // Captures styled as blockquotes and KaTeX internals — don't wrap marks there.
    if (node.parentElement?.closest("[data-capture], [data-capture-html], .katex")) continue;

    let target = node;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.data.length) target.splitText(e - s);

    // Depth = how many marks already wrap this text (overlapping anchors).
    let depth = 1;
    let p = target.parentElement;
    while (p && p !== container) {
      if (p.tagName === "MARK") depth++;
      p = p.parentElement;
    }

    const mark = document.createElement("mark");
    mark.dataset.branchId = item.branchId;
    mark.dataset.depth = String(Math.min(depth, 3));
    if (item.minimized) mark.dataset.minimized = "true";
    if (item.active) mark.dataset.active = "true";
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}
