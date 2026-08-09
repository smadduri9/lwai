/** Shared sub-chat sizing — keep docked cards and float windows composer-safe. */

export const SUBCHAT_MIN_WIDTH = 320;
export const SUBCHAT_MIN_HEIGHT = 360;

export const SUBCHAT_DEFAULT_BUBBLE = { width: 380, height: 440 };
export const SUBCHAT_DEFAULT_FULL = { width: 520, height: 480 };

export const SUBCHAT_DEFAULT_CARD_WIDTH = 320;
export const SUBCHAT_DEFAULT_BODY_HEIGHT = 160;
export const SUBCHAT_MIN_BODY_HEIGHT = 160;
export const SUBCHAT_MAX_BODY_HEIGHT = 720;

export const SUBCHAT_NESTED_RAIL_MAX_HEIGHT = 120;
export const SUBCHAT_COMPACT_RAIL_WIDTH_CLASS = "w-36";

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Clamp float window size to composer-safe minimums (and optional viewport max). */
export function clampSubChatSize(
  size: { width: number; height: number },
  viewport?: { width: number; height: number },
): { width: number; height: number } {
  const maxW = viewport?.width ?? Number.POSITIVE_INFINITY;
  const maxH = viewport?.height ?? Number.POSITIVE_INFINITY;
  return {
    width: clamp(size.width, SUBCHAT_MIN_WIDTH, maxW),
    height: clamp(size.height, SUBCHAT_MIN_HEIGHT, maxH),
  };
}

/** Clamp docked card width / body scroll height overrides. */
export function clampRailSize(size: {
  w?: number;
  h?: number;
}): { w?: number; h?: number } {
  const out: { w?: number; h?: number } = {};
  if (size.w != null) {
    const maxW =
      typeof window !== "undefined" ? Math.round(window.innerWidth * 0.7) : 2000;
    out.w = clamp(size.w, SUBCHAT_MIN_WIDTH, maxW);
  }
  if (size.h != null) {
    out.h = clamp(size.h, SUBCHAT_MIN_BODY_HEIGHT, SUBCHAT_MAX_BODY_HEIGHT);
  }
  return out;
}

/** Normalize a persisted WindowState size/railSize to current minimums. */
export function clampWindowStateSize<
  T extends {
    size: { width: number; height: number };
    railSize?: { w?: number; h?: number };
  },
>(win: T): T {
  const size = clampSubChatSize(win.size);
  const railSize =
    win.railSize == null
      ? undefined
      : (() => {
          const next = { ...win.railSize };
          if (next.w != null) next.w = Math.max(next.w, SUBCHAT_MIN_WIDTH);
          if (next.h != null) {
            next.h = clamp(next.h, SUBCHAT_MIN_BODY_HEIGHT, SUBCHAT_MAX_BODY_HEIGHT);
          }
          return next;
        })();
  if (
    size.width === win.size.width &&
    size.height === win.size.height &&
    railSize?.w === win.railSize?.w &&
    railSize?.h === win.railSize?.h
  ) {
    return win;
  }
  return { ...win, size, railSize };
}
