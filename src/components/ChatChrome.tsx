import { useEffect, useState } from "react";
import { StatsBar } from "./StatsBar";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

/**
 * In-paper chrome: editable Ask title + session stats.
 * Chat / Notebook switching lives in the top ChatNotebookToggle.
 */
export function ChatChrome() {
  const devMode = useUiStore((s) => s.devMode);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const renameConversation = useWorkspaceStore((s) => s.renameConversation);
  const active = conversations.find((c) => c.id === conversationId);
  const title = active?.title?.trim() || "Ask";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!conversationId || !next || next === title) return;
    void renameConversation(conversationId, next);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="max-w-[240px] truncate rounded-full border border-ivory-300 bg-card px-3 py-1 text-xs font-medium text-ink-800 outline-none focus:border-clay-500"
            aria-label="Rename Ask"
          />
        ) : (
          <button
            type="button"
            title="Rename Ask"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            className="max-w-[240px] truncate rounded-full border border-ivory-300 bg-card px-3 py-1 text-xs font-medium text-ink-700 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600"
          >
            {title}
          </button>
        )}
        {/* Stats live behind Developer Mode; metrics are still collected. */}
        {devMode && <StatsBar />}
      </div>
    </div>
  );
}
