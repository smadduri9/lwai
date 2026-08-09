/** Scroll to a highlighted mark or message and briefly flash it. */
export function focusChatHighlight(opts: {
  focusNoteId?: string | null;
  focusMessageId?: string | null;
}): boolean {
  const noteId = opts.focusNoteId?.trim();
  const messageId = opts.focusMessageId?.trim();

  let el: HTMLElement | null = null;
  if (noteId) {
    el = document.querySelector<HTMLElement>(`mark[data-note-id="${noteId}"]`);
  }
  if (!el && messageId) {
    el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  }
  if (!el) return false;

  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("message-flash");
  setTimeout(() => el?.classList.remove("message-flash"), 1600);
  return true;
}

/** Clear focus* query params without a navigation. */
export function clearFocusParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["focusMessage", "focusNote"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState(null, "", url.pathname + url.search);
  }
}

/**
 * URL that opens the chat (or branch tab) scrolled to a captured message.
 */
export function sourceChatUrl(opts: {
  sourceMessageId: string;
  conversationId?: string | null;
  branchId?: string | null;
  rootBranchId: string;
}): string {
  const url = new URL(window.location.origin + "/");
  if (opts.conversationId) url.searchParams.set("c", opts.conversationId);
  if (opts.branchId && opts.branchId !== opts.rootBranchId) {
    url.searchParams.set("branch", opts.branchId);
  }
  url.searchParams.set("focusMessage", opts.sourceMessageId);
  return url.pathname + url.search;
}
