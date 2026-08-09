/**
 * Phase 5 navigation: when the user closes / minimizes / backs out of a
 * sub-chat, smoothly scroll the page back to the highlight it was spawned
 * from and pulse it briefly.
 */
export function scrollToBranchHighlight(branchId: string): boolean {
  if (typeof document === "undefined") return false;
  const mark = document.querySelector<HTMLElement>(
    `mark[data-branch-id="${CSS.escape(branchId)}"]`,
  );
  if (!mark) return false;
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  mark.classList.add("message-flash");
  setTimeout(() => mark.classList.remove("message-flash"), 1600);
  return true;
}

/** Fallback: scroll to the source message when the highlight itself is gone. */
export function scrollToSourceMessage(messageId: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("message-flash");
  setTimeout(() => el.classList.remove("message-flash"), 1600);
  return true;
}

/** Scroll back to a branch's origin: its highlight, else its source message. */
export function scrollBackToOrigin(branchId: string, sourceMessageId?: string | null): void {
  // Defer one frame so mark updates (e.g. minimized badge) land first.
  requestAnimationFrame(() => {
    if (scrollToBranchHighlight(branchId)) return;
    if (sourceMessageId) scrollToSourceMessage(sourceMessageId);
  });
}
