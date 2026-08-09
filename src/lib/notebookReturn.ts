/**
 * Remember where the user was before opening the Notebook, so Back can
 * restore that page and scroll position.
 */

const KEY = "nb-notebook-return";

export type NotebookReturnPoint = {
  url: string;
  scrollY: number;
};

export function rememberNotebookReturn(): void {
  try {
    const scroller = document.querySelector<HTMLElement>(".overflow-y-auto");
    const scrollY =
      scroller && scroller.scrollHeight > scroller.clientHeight + 40
        ? scroller.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;
    const point: NotebookReturnPoint = {
      url: window.location.pathname + window.location.search + window.location.hash,
      scrollY,
    };
    // Don't overwrite with another note URL.
    if (isNotebookUrl(point.url)) return;
    sessionStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    // ignore quota / private mode
  }
}

export function peekNotebookReturn(): NotebookReturnPoint | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotebookReturnPoint;
    if (!parsed?.url || typeof parsed.scrollY !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearNotebookReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

import { isNotebookView } from "./viewMode";

function isNotebookUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return isNotebookView(u.search);
  } catch {
    return false;
  }
}

/** Navigate back to the remembered place and restore scroll after load. */
export function goNotebookBack(fallbackUrl: string): void {
  const point = peekNotebookReturn();
  clearNotebookReturn();
  const target = point?.url || fallbackUrl;
  if (point && point.scrollY > 0) {
    try {
      sessionStorage.setItem(
        "nb-restore-scroll",
        JSON.stringify({ url: target, scrollY: point.scrollY }),
      );
    } catch {
      // ignore
    }
  }
  window.location.assign(target);
}

/** Call on Ask / Branch pages after mount to restore scroll from notebook Back. */
export function restoreScrollIfNeeded(): void {
  try {
    const raw = sessionStorage.getItem("nb-restore-scroll");
    if (!raw) return;
    const parsed = JSON.parse(raw) as { url: string; scrollY: number };
    sessionStorage.removeItem("nb-restore-scroll");
    const here = window.location.pathname + window.location.search;
    const target = new URL(parsed.url, window.location.origin);
    const targetPath = target.pathname + target.search;
    if (here !== targetPath) return;
    const y = parsed.scrollY;
    const apply = () => {
      window.scrollTo({ top: y, behavior: "auto" });
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
      for (const el of document.querySelectorAll<HTMLElement>(".overflow-y-auto")) {
        if (el.scrollHeight > el.clientHeight + 40) {
          el.scrollTo({ top: y, behavior: "auto" });
        }
      }
    };
    requestAnimationFrame(() => {
      apply();
      // Second pass after layout (brain map / messages).
      setTimeout(apply, 80);
    });
  } catch {
    // ignore
  }
}
