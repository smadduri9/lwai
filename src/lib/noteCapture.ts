import * as repo from "../db/workspaceRepository";
import { fetchImageBlob } from "./chatImageSelect";
import { newId } from "./id";
import {
  isAllowedNoteImage,
  NOTE_IMAGE_MAX_PER_NOTE,
  sanitizeNoteHtml,
} from "./noteHtml";

/**
 * Replace chat `<img src>` markers in captured HTML with note attachment imgs.
 * Failed fetches are dropped. Caps at NOTE_IMAGE_MAX_PER_NOTE total per note.
 */
export async function materializeCaptureImages(
  html: string,
  notebookId: string,
): Promise<string> {
  if (typeof document === "undefined") return html;
  if (!html.includes("<img")) return html;

  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const imgs = [...wrap.querySelectorAll("img")];
  if (imgs.length === 0) return html;

  let count = await repo.countNoteAttachments(notebookId);

  for (const img of imgs) {
    const existingId = img.getAttribute("data-attachment-id")?.trim();
    if (existingId && /^[a-zA-Z0-9_-]+$/.test(existingId)) {
      const alt = (img.getAttribute("alt") ?? "").slice(0, 200);
      for (const attr of [...img.attributes]) img.removeAttribute(attr.name);
      img.setAttribute("data-attachment-id", existingId);
      img.setAttribute("alt", alt);
      continue;
    }

    const src = img.getAttribute("src")?.trim() ?? "";
    if (!src || count >= NOTE_IMAGE_MAX_PER_NOTE) {
      img.remove();
      continue;
    }

    const blob = await fetchImageBlob(src);
    if (!blob || !isAllowedNoteImage(blob)) {
      img.remove();
      continue;
    }

    const attId = newId();
    try {
      await repo.addNoteAttachment({
        id: attId,
        notebookId,
        mimeType: blob.type,
        blob,
      });
      count += 1;
      const alt = (img.getAttribute("alt") ?? "").slice(0, 200);
      for (const attr of [...img.attributes]) img.removeAttribute(attr.name);
      img.setAttribute("data-attachment-id", attId);
      img.setAttribute("alt", alt);
    } catch {
      img.remove();
    }
  }

  return sanitizeNoteHtml(wrap.innerHTML);
}
