import { useEffect, useRef, useState, type ReactNode } from "react";
import { chatUrl, notebookViewUrl } from "../lib/chatUrl";
import { sortedNotebooks, useNotebookStore } from "../store/notebookStore";
import { useWorkspaceStore } from "../store/workspaceStore";

function truncate(title: string, max = 28): string {
  const t = title.trim() || "Untitled";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function Menu({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 min-w-[260px] rounded-lg border border-ivory-300 bg-card py-1.5 shadow-lg"
    >
      {children}
    </div>
  );
}

function Row({
  label,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <div
      className={`flex min-h-[36px] items-center gap-2 px-3 py-2.5 text-xs ${
        active ? "bg-sage-50 text-sage-700" : "text-ink-700 hover:bg-ivory-100"
      }`}
    >
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
        {label}
      </button>
      <button
        type="button"
        title="Rename"
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-400 hover:bg-ivory-200 hover:text-ink-700"
        onClick={onRename}
      >
        Rename
      </button>
      <button
        type="button"
        title="Delete"
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

/**
 * Header control: chat list + notebook list + New Chat / New Notebook + wipe.
 */
export function WorkspaceSwitcher() {
  const ready = useWorkspaceStore((s) => s.ready);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const newChat = useWorkspaceStore((s) => s.newChat);
  const renameConversation = useWorkspaceStore((s) => s.renameConversation);
  const deleteConversation = useWorkspaceStore((s) => s.deleteConversation);
  const wipeAll = useWorkspaceStore((s) => s.wipeAll);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const lastUsedNotebookId = useNotebookStore((s) => s.lastUsedNotebookId);
  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const renameNotebook = useNotebookStore((s) => s.renameNotebook);
  const deleteNotebook = useNotebookStore((s) => s.deleteNotebook);

  const [open, setOpen] = useState(false);

  if (!ready) return null;

  const activeChat = conversations.find((c) => c.id === conversationId);
  const notebookList = sortedNotebooks(notebooks);

  const askRename = async (current: string, apply: (title: string) => Promise<void>) => {
    const next = prompt("Rename", current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    await apply(title);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <button
          type="button"
          title="Chats and notebooks"
          onClick={() => setOpen((o) => !o)}
          className="max-w-[200px] truncate rounded-full border border-sage-300/70 bg-sage-50/80 px-2.5 py-1 text-xs font-medium text-sage-700 shadow-sm hover:border-sage-600/50"
        >
          {truncate(activeChat?.title ?? "Workspace", 18)}
        </button>
        <Menu open={open} onClose={() => setOpen(false)}>
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">
            Chats
          </div>
          {conversations.map((c) => (
            <Row
              key={c.id}
              label={truncate(c.title, 36)}
              active={c.id === conversationId}
              onSelect={() => {
                setOpen(false);
                if (c.id === conversationId) {
                  window.location.href = chatUrl({ conversationId: c.id });
                } else {
                  // Phase 5: other chats open in a new tab.
                  window.open(chatUrl({ conversationId: c.id }), "_blank");
                }
              }}
              onRename={() => void askRename(c.title, (t) => renameConversation(c.id, t))}
              onDelete={() => {
                if (confirm(`Delete chat “${c.title}”?`)) {
                  void deleteConversation(c.id).then(() => setOpen(false));
                }
              }}
            />
          ))}
          <button
            type="button"
            className="mt-1 w-full border-t border-ivory-200 px-3 py-1.5 text-left text-xs font-medium text-clay-600 hover:bg-ivory-50"
            onClick={() => {
              void newChat().then((id) => {
                setOpen(false);
                window.location.href = chatUrl({ conversationId: id });
              });
            }}
          >
            + New Chat
          </button>

          <div className="mt-1 border-t border-ivory-200 px-3 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">
            Notebooks
          </div>
          {notebookList.map((nb) => (
            <Row
              key={nb.id}
              label={truncate(nb.title, 36)}
              active={nb.id === lastUsedNotebookId}
              onSelect={() => {
                setOpen(false);
                window.location.href = notebookViewUrl({ notebookId: nb.id });
              }}
              onRename={() => void askRename(nb.title, (t) => renameNotebook(nb.id, t))}
              onDelete={() => {
                if (confirm(`Delete notebook “${nb.title}”?`)) {
                  void deleteNotebook(nb.id).then(() => setOpen(false));
                }
              }}
            />
          ))}
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-xs font-medium text-ink-700 hover:bg-ivory-50"
            onClick={() => {
              const title = prompt("New notebook name", "Notebook");
              if (title == null) return;
              void createNotebook(title).then((id) => {
                setOpen(false);
                window.location.href = notebookViewUrl({ notebookId: id });
              });
            }}
          >
            + New Notebook
          </button>

          <button
            type="button"
            className="mt-1 w-full border-t border-ivory-200 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            onClick={() => {
              if (confirm("Wipe ALL local data (every chat and notebook)? This cannot be undone.")) {
                void wipeAll().then(() => {
                  setOpen(false);
                  window.location.href = "/";
                });
              }
            }}
          >
            Wipe all local data…
          </button>
        </Menu>
      </div>
    </div>
  );
}
