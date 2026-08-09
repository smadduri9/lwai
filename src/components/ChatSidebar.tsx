import { useEffect, useState } from "react";
import { chatUrl, notebookViewUrl } from "../lib/chatUrl";
import { askTabKey, navigateInPage, openOrFocusWorkspaceTab } from "../lib/workspaceTabs";
import { sortedNotebooks, useNotebookStore } from "../store/notebookStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const COLLAPSED_KEY = "subchat-sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
}

/** Compact "2m", "3h", "5d" style relative time. */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function PanelIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function SidebarRow({
  label,
  meta,
  active,
  onSelect,
  onDelete,
  deleteTitle,
}: {
  label: string;
  meta?: string;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  deleteTitle?: string;
}) {
  return (
    <div
      className={`group relative flex items-center rounded-lg text-[13px] transition-colors ${
        active ? "bg-sage-100/80 text-sage-800" : "text-ink-600 hover:bg-ivory-200/70"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta && (
          <span className="shrink-0 text-[10px] tabular-nums text-ink-400 group-hover:opacity-0">
            {meta}
          </span>
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          title={deleteTitle ?? "Delete"}
          className="absolute right-1.5 rounded p-1 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/40"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Claude-style collapsible left sidebar: New Chat, recent chats (hover
 * delete), and a Notebooks section. Collapsed by default to a slim toggle.
 * Overlay (fixed) so the centered Docs paper never reflows.
 */
export function ChatSidebar() {
  const ready = useWorkspaceStore((s) => s.ready);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const newChat = useWorkspaceStore((s) => s.newChat);
  const deleteConversation = useWorkspaceStore((s) => s.deleteConversation);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const lastUsedNotebookId = useNotebookStore((s) => s.lastUsedNotebookId);
  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const deleteNotebook = useNotebookStore((s) => s.deleteNotebook);

  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  if (!ready) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        title="Open sidebar"
        aria-label="Open sidebar"
        onClick={() => setCollapsed(false)}
        className="fixed top-3 left-3 z-40 rounded-lg border border-ivory-300 bg-ivory-50 p-2 text-ink-500 shadow-sm transition-colors hover:border-clay-500/40 hover:text-clay-600 dark:bg-neutral-900"
      >
        <PanelIcon className="h-4.5 w-4.5" />
      </button>
    );
  }

  const chats = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const notebookList = sortedNotebooks(notebooks);

  const openChat = (id: string) => {
    if (id === conversationId) {
      navigateInPage(chatUrl({ conversationId: id }));
    } else {
      // Phase 5 behavior: other chats open (or focus) their own tab.
      openOrFocusWorkspaceTab({ key: askTabKey(id), url: chatUrl({ conversationId: id }) });
    }
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ivory-200 bg-ivory-50/95 shadow-lg backdrop-blur-md dark:bg-neutral-900/95"
      data-chat-sidebar
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[11px] font-medium tracking-wide text-ink-400 uppercase">
          Chats
        </span>
        <button
          type="button"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={() => setCollapsed(true)}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ivory-200/70 hover:text-ink-700"
        >
          <PanelIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="px-2.5 pb-2">
        <button
          type="button"
          className="w-full rounded-lg border border-clay-500/40 bg-clay-500/10 px-3 py-1.5 text-left text-[13px] font-medium text-clay-600 transition-colors hover:bg-clay-500/20"
          onClick={() => {
            void newChat().then((id) => {
              navigateInPage(chatUrl({ conversationId: id }));
            });
          }}
        >
          + New Chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="flex flex-col gap-0.5">
          {chats.map((c) => (
            <SidebarRow
              key={c.id}
              label={c.title.trim() || "Untitled"}
              meta={relativeTime(c.updatedAt)}
              active={c.id === conversationId}
              onSelect={() => openChat(c.id)}
              deleteTitle="Delete chat"
              onDelete={() => {
                if (confirm(`Delete chat “${c.title}”?`)) {
                  void deleteConversation(c.id);
                }
              }}
            />
          ))}
          {chats.length === 0 && (
            <p className="px-2.5 py-1.5 text-xs text-ink-400">No chats yet.</p>
          )}
        </div>

        <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
          Notebooks
        </div>
        <div className="flex flex-col gap-0.5">
          {notebookList.map((nb) => (
            <SidebarRow
              key={nb.id}
              label={nb.title.trim() || "Untitled"}
              active={nb.id === lastUsedNotebookId}
              onSelect={() => navigateInPage(notebookViewUrl({ notebookId: nb.id }))}
              deleteTitle="Delete notebook"
              onDelete={() => {
                if (confirm(`Delete notebook “${nb.title}”?`)) {
                  void deleteNotebook(nb.id);
                }
              }}
            />
          ))}
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-ink-500 transition-colors hover:bg-ivory-200/70 hover:text-ink-700"
            onClick={() => {
              const title = prompt("New notebook name", "Notebook");
              if (title == null) return;
              void createNotebook(title).then((id) => {
                navigateInPage(notebookViewUrl({ notebookId: id }));
              });
            }}
          >
            + New Notebook
          </button>
        </div>
      </div>
    </aside>
  );
}
