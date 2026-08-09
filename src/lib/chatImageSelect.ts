import type { PendingSelection } from "../store/selectionStore";

/** Select a chat image for “Add to Notebook”; returns pending payload or null. */
export function pendingFromChatImage(
  img: HTMLImageElement,
  sourceMessageId: string,
): PendingSelection | null {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  const r = img.getBoundingClientRect();
  return {
    kind: "image",
    imageSrc: src,
    imageAlt: img.alt || undefined,
    sourceMessageId,
    rect: {
      left: r.left,
      top: r.top,
      bottom: r.bottom,
      width: Math.max(r.width, 120),
    },
  };
}

/** Fetch an image URL as a Blob for note attachment storage. */
export async function fetchImageBlob(src: string): Promise<Blob | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) {
      return new Blob([blob], { type: "image/png" });
    }
    return blob;
  } catch {
    return null;
  }
}
