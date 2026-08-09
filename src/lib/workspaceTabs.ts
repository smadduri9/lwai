/**
 * Cross-tab open-or-focus for Ask / Note / Branch pages.
 * Browsers cannot enumerate tabs; we use BroadcastChannel so a live tab
 * with a matching key can answer and call window.focus().
 *
 * Prefer {@link navigateInPage} for tree/map clicks. Only call
 * {@link openOrFocusWorkspaceTab} when the user explicitly wants a new tab
 * (e.g. SubChat "Tab" button).
 */

const CHANNEL = "nb-workspace-tabs";
const FOCUS_WAIT_MS = 100;

export type WorkspaceTabKey =
  | `ask:${string}`
  | `note:${string}`
  | `branch:${string}`;

type TabMessage =
  | { type: "focus"; key: string; requestId: string }
  | { type: "here"; key: string; requestId: string };

let channel: BroadcastChannel | null = null;
let registeredKey: string | null = null;
let listenerAttached = false;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

function ensureListener() {
  if (listenerAttached) return;
  const ch = getChannel();
  if (!ch) return;
  listenerAttached = true;
  ch.addEventListener("message", (ev: MessageEvent<TabMessage>) => {
    const msg = ev.data;
    if (!msg || msg.type !== "focus") return;
    if (!registeredKey || msg.key !== registeredKey) return;
    try {
      window.focus();
    } catch {
      // ignore
    }
    ch.postMessage({
      type: "here",
      key: msg.key,
      requestId: msg.requestId,
    } satisfies TabMessage);
  });
}

/** Register this window as the live tab for `key` (replaces any prior key). */
export function registerWorkspaceTab(key: WorkspaceTabKey | null) {
  ensureListener();
  registeredKey = key;
}

export function unregisterWorkspaceTab() {
  registeredKey = null;
}

export function askTabKey(conversationId: string): WorkspaceTabKey {
  return `ask:${conversationId}`;
}

export function noteTabKey(notebookId: string): WorkspaceTabKey {
  return `note:${notebookId}`;
}

export function branchTabKey(branchId: string): WorkspaceTabKey {
  return `branch:${branchId}`;
}

/**
 * Stay in the current tab: navigate to `url` via location assign.
 * Use for Brain Map / tree / scope nav — not for explicit "new tab".
 */
export function navigateInPage(url: string): void {
  const next = new URL(url, window.location.origin);
  if (
    window.location.pathname === next.pathname &&
    window.location.search === next.search
  ) {
    return;
  }
  window.location.assign(next.pathname + next.search + next.hash);
}

/**
 * Focus an existing tab for `key` if one answers; otherwise open `url` in a new tab.
 * If this window already owns `key`, just focus it.
 * Only use when the user explicitly clicks "new tab".
 */
export function openOrFocusWorkspaceTab(opts: {
  key: WorkspaceTabKey;
  url: string;
}): void {
  const { key, url } = opts;

  if (registeredKey === key) {
    try {
      window.focus();
    } catch {
      // ignore
    }
    return;
  }

  const ch = getChannel();
  if (!ch) {
    window.open(url, "_blank");
    return;
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let settled = false;

  const onMessage = (ev: MessageEvent<TabMessage>) => {
    const msg = ev.data;
    if (!msg || msg.type !== "here") return;
    if (msg.key !== key || msg.requestId !== requestId) return;
    settled = true;
    ch.removeEventListener("message", onMessage);
  };

  ch.addEventListener("message", onMessage);
  ch.postMessage({ type: "focus", key, requestId } satisfies TabMessage);

  window.setTimeout(() => {
    ch.removeEventListener("message", onMessage);
    if (!settled) {
      window.open(url, "_blank");
    }
  }, FOCUS_WAIT_MS);
}
