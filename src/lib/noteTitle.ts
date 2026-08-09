/** Note display name = first H1 in the body HTML; fallback "Untitled". */
export function noteTitleFromHtml(html: string, max = 48): string {
  if (typeof document === "undefined") {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const raw = (m?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!raw) return "Untitled";
    return raw.length > max ? raw.slice(0, max - 1) + "…" : raw;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const h1 = template.content.querySelector("h1");
  const text = (h1?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
