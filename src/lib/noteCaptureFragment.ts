/** Escape text for insertion into note HTML. */
export function escapeNoteHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CaptureFragmentOpts = {
  /** Same-app href for the “from this chat” link (e.g. `/?focusMessage=…`). */
  sourceHref?: string | null;
  /**
   * Pre-sanitized rich HTML of the selection (tables, KaTeX, code, mermaid
   * sources, images). When present it replaces the escaped plain-text quote
   * so captures render exactly like the chat.
   */
  richHtml?: string | null;
};

/**
 * Build the HTML fragment appended when capturing chat text into the notebook.
 *
 * Shape (quote + optional comment):
 *   <blockquote data-capture="1"><p>"quote" <a href="…">from this chat</a></p></blockquote>
 *   <p>comment or empty</p>
 *   <p><br></p>   ← caret target
 *
 * Thought-only (no quote): comment paragraph + trailing empty line.
 */
export function buildCaptureFragment(
  quote: string,
  thought: string,
  opts?: CaptureFragmentOpts,
): string {
  const q = quote.trim();
  const t = thought.trim();
  const rich = opts?.richHtml?.trim() ?? "";
  if (!q && !t && !rich) return "";

  const parts: string[] = [];

  if (q || rich) {
    const href = opts?.sourceHref?.trim() ?? "";
    const attribution = href
      ? `<a href="${escapeNoteHtml(href)}">from this chat</a>`
      : "from this chat";
    if (rich) {
      // Rich capture: keep the rendered HTML verbatim (sanitized downstream)
      // so tables/math/code/diagrams render exactly like the chat.
      parts.push(
        `<blockquote data-capture="1" data-captured-at="${Date.now()}"><div data-capture-html="1">${rich}</div><p>${attribution}</p></blockquote>`,
      );
    } else {
      parts.push(
        `<blockquote data-capture="1" data-captured-at="${Date.now()}"><p>"${escapeNoteHtml(q)}" ${attribution}</p></blockquote>`,
      );
    }
    parts.push(t ? `<p>${escapeNoteHtml(t)}</p>` : `<p><br></p>`);
  } else {
    parts.push(`<p>${escapeNoteHtml(t)}</p>`);
  }

  parts.push(`<p><br></p>`);
  return parts.join("");
}
