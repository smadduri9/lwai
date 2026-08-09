/** Allowed tags for note body HTML (Docs-style rich text + captured code). */
const ALLOWED = new Set([
  "P",
  "BR",
  "DIV",
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "IMG",
  "PRE",
  "CODE",
  "BLOCKQUOTE",
  "A",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "HR",
]);

const KEEP_ATTRS = new Set(["colspan", "rowspan", "scope"]);
const KEEP_DATA = new Set([
  "data-capture",
  "data-capture-html",
  "data-captured-at",
  "data-heading-id",
  "data-attachment-id",
  "data-mermaid-source",
]);

/** Classes preserved outside a KaTeX subtree (rendering-critical hooks). */
const KEEP_CLASS_RE = /^(katex|hljs|language-)/;

/** True when unsafe CSS could sneak through an inline style. */
function isUnsafeStyle(style: string): boolean {
  return /url\s*\(|expression|@import|position\s*:\s*(fixed|absolute)/i.test(style);
}
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4"]);

const ALLOWED_IMG_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const NOTE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const NOTE_IMAGE_MAX_PER_NOTE = 20;

/** Same-app relative path used for in-note chat deep links (e.g. `/?s=…&focusMessage=…`). */
export function isAppRelativeHref(href: string): boolean {
  const h = href.trim();
  if (!h.startsWith("/") || h.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false;
  return /^\/[a-zA-Z0-9._~/?#&=%+\-]*$/.test(h);
}

function stripUnsafeAttrs(el: HTMLElement, extraKeep: Set<string> = new Set()) {
  const insideKatex = Boolean(el.closest(".katex"));
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }
    // KaTeX spacing depends on inline styles; allow them (scrubbed) there only.
    if (name === "style") {
      if (!insideKatex || isUnsafeStyle(attr.value)) el.removeAttribute(attr.name);
      continue;
    }
    // Rendering-critical classes (KaTeX, highlight.js) survive round-trips.
    if (name === "class") {
      const kept = insideKatex
        ? attr.value.trim()
        : attr.value
            .split(/\s+/)
            .filter((c) => KEEP_CLASS_RE.test(c))
            .join(" ");
      if (kept) el.setAttribute("class", kept);
      else el.removeAttribute(attr.name);
      continue;
    }
    if (KEEP_ATTRS.has(name) || KEEP_DATA.has(name) || extraKeep.has(name)) continue;
    if (name === "href" || name === "target" || name === "rel" || name === "alt") continue;
    el.removeAttribute(attr.name);
  }
}

/** Strip scripts/styles and disallowed tags; keep formatting + attachment images. */
export function sanitizeNoteHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/on\w+=["'][^"']*["']/gi, "");
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  // Ephemeral mermaid render views never persist — only their source <pre>s.
  for (const el of [...template.content.querySelectorAll("[data-mermaid-view]")]) {
    el.remove();
  }
  // Inline SVG cannot round-trip through the editor; drop rather than unwrap.
  for (const el of [...template.content.querySelectorAll("svg")]) el.remove();
  const walk = (node: Node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      if (!ALLOWED.has(el.tagName)) {
        while (el.firstChild) node.insertBefore(el.firstChild, el);
        node.removeChild(el);
        continue;
      }
      if (el.tagName === "IMG") {
        const id = el.getAttribute("data-attachment-id")?.trim() ?? "";
        const alt = (el.getAttribute("alt") ?? "").slice(0, 200);
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
          node.removeChild(el);
          continue;
        }
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
        el.setAttribute("data-attachment-id", id);
        el.setAttribute("alt", alt);
        continue;
      }
      if (el.tagName === "A") {
        const href = el.getAttribute("href");
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
        if (href && /^https?:\/\//i.test(href)) {
          el.setAttribute("href", href);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
          walk(el);
        } else if (href && isAppRelativeHref(href)) {
          el.setAttribute("href", href);
          walk(el);
        } else {
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
        }
        continue;
      }
      if (el.tagName === "TH" || el.tagName === "TD") {
        const kept: Array<[string, string]> = [];
        for (const attr of [...el.attributes]) {
          if (KEEP_ATTRS.has(attr.name.toLowerCase())) {
            kept.push([attr.name, attr.value]);
          }
        }
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
        for (const [name, value] of kept) el.setAttribute(name, value);
        walk(el);
        continue;
      }
      if (HEADING_TAGS.has(el.tagName)) {
        const headingId = el.getAttribute("data-heading-id")?.trim() ?? "";
        stripUnsafeAttrs(el);
        if (headingId && /^[a-zA-Z0-9_-]+$/.test(headingId)) {
          el.setAttribute("data-heading-id", headingId);
        } else {
          el.removeAttribute("data-heading-id");
        }
        walk(el);
        continue;
      }
      stripUnsafeAttrs(el);
      walk(el);
    }
  };
  walk(template.content);
  return template.innerHTML;
}

export function isAllowedNoteImage(file: Blob): boolean {
  return ALLOWED_IMG_MIME.has(file.type) && file.size > 0 && file.size <= NOTE_IMAGE_MAX_BYTES;
}

/** Plain text → minimal HTML paragraphs for migrating old textarea bodies. */
export function plainTextToNoteHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return sanitizeNoteHtml(trimmed);
  return trimmed
    .split(/\n\n+/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function noteHtmlToPlain(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.innerText || d.textContent || "").trim();
}
