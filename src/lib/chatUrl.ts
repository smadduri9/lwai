/** Build a chat URL (optionally focused on a branch tab). */
export function chatUrl(opts?: {
  conversationId?: string | null;
  branchId?: string | null;
}): string {
  const q = new URLSearchParams();
  if (opts?.conversationId) q.set("c", opts.conversationId);
  if (opts?.branchId) q.set("branch", opts.branchId);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

/** Build a Notebook view URL (falls back to the last-used notebook). */
export function notebookViewUrl(opts?: { notebookId?: string | null }): string {
  const q = new URLSearchParams();
  q.set("view", "note");
  if (opts?.notebookId) q.set("nb", opts.notebookId);
  return `/?${q.toString()}`;
}

/** @deprecated Use chatUrl. */
export const conversationUrl = chatUrl;
