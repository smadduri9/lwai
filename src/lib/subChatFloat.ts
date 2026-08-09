import { clampSubChatSize } from "./subChatLayout";

export const SUBCHAT_CENTER_FLOAT = { width: 400, height: 440 };

/** Centered float rect for "Float in middle", clamped to the viewport. */
export function centerFloatRect(
  size = SUBCHAT_CENTER_FLOAT,
  viewport?: { width: number; height: number },
) {
  const vw =
    viewport?.width ??
    (typeof window !== "undefined" ? window.innerWidth : size.width + 24);
  const vh =
    viewport?.height ??
    (typeof window !== "undefined" ? window.innerHeight : size.height + 24);
  const clamped = clampSubChatSize(size, { width: vw, height: vh });
  return {
    position: {
      x: Math.max(12, Math.round((vw - clamped.width) / 2)),
      y: Math.max(12, Math.round((vh - clamped.height) / 2)),
    },
    size: clamped,
  };
}
