/** Heading outline entry for Docs-style left rail. */
export interface NoteHeadingOutlineItem {
  id: string;
  level: 1 | 2;
  text: string;
}

/** Scan note HTML for h1/h2; assign stable data-heading-id when missing. */
export function extractNoteHeadings(html: string): {
  items: NoteHeadingOutlineItem[];
  html: string;
} {
  if (typeof document === "undefined") {
    return { items: [], html };
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const items: NoteHeadingOutlineItem[] = [];
  let i = 0;
  for (const el of template.content.querySelectorAll("h1, h2")) {
    const level = el.tagName === "H1" ? (1 as const) : (2 as const);
    let id = el.getAttribute("data-heading-id")?.trim() ?? "";
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      id = `h-${++i}`;
      el.setAttribute("data-heading-id", id);
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim() || "Untitled";
    items.push({ id, level, text });
  }
  return { items, html: template.innerHTML };
}
