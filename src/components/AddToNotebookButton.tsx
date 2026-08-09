import { useEffect, useRef, useState } from "react";
import { sortedNotebooks, useNotebookStore } from "../store/notebookStore";
import type { NoteAnchor } from "../types";

/**
 * Universal "Add to Notebook" control: one-click save to the last-used
 * notebook plus a chevron dropdown to switch the destination (which updates
 * the global lastUsedNotebookId). Rendered on every assistant message and in
 * the selection toolbar, across all UI states.
 */
export function AddToNotebookButton({
  getAnchor,
  compact = false,
  onSaved,
}: {
  /** Capture payload builder — called at click time. */
  getAnchor: () => NoteAnchor | null;
  /** Compact = icon-ish pill for hover toolbars. */
  compact?: boolean;
  onSaved?: (notebookId: string) => void;
}) {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const lastUsedNotebookId = useNotebookStore((s) => s.lastUsedNotebookId);
  const appendCapture = useNotebookStore((s) => s.appendCapture);
  const setLastUsedNotebook = useNotebookStore((s) => s.setLastUsedNotebook);
  const createNotebook = useNotebookStore((s) => s.createNotebook);

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const list = sortedNotebooks(notebooks);
  const target = (lastUsedNotebookId && notebooks[lastUsedNotebookId]) || list[0] || null;

  const save = async (notebookId?: string) => {
    if (busy) return;
    const anchor = getAnchor();
    if (!anchor) return;
    setBusy(true);
    try {
      const id = await appendCapture(anchor, "", notebookId ? { notebookId } : undefined);
      if (id) onSaved?.(id);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const newNotebook = async () => {
    const title = prompt("New notebook name", "Notebook");
    if (title == null) return;
    const id = await createNotebook(title);
    await save(id);
  };

  return (
    <div ref={rootRef} data-add-to-notebook className="relative inline-flex items-stretch">
      <button
        type="button"
        disabled={busy}
        title={target ? `Add to ${target.title}` : "Add to Notebook"}
        onClick={() => void save()}
        onMouseDown={(e) => e.preventDefault()}
        className={`inline-flex items-center gap-1 rounded-l-full border border-r-0 border-ivory-300 bg-card text-ink-600 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600 ${
          compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
        }`}
      >
        {busy ? "Adding…" : compact ? "＋ Notebook" : `Add to ${target ? truncate(target.title, 16) : "Notebook"}`}
      </button>
      <button
        type="button"
        aria-label="Choose notebook"
        onClick={() => setMenuOpen((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        className={`inline-flex items-center rounded-r-full border border-ivory-300 bg-card text-ink-400 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600 ${
          compact ? "px-1 text-[10px]" : "px-1.5 text-xs"
        }`}
      >
        ▾
      </button>

      {menuOpen && (
        <div className="absolute top-full right-0 z-[100000] mt-1 max-h-64 min-w-[220px] overflow-y-auto rounded-lg border border-ivory-300 bg-card py-1 shadow-lg">
          {list.map((nb) => (
            <button
              key={nb.id}
              type="button"
              onClick={() => {
                setLastUsedNotebook(nb.id);
                void save(nb.id);
              }}
              className={`block w-full truncate px-3 py-1.5 text-left text-xs ${
                nb.id === target?.id
                  ? "bg-sage-50 font-medium text-sage-700"
                  : "text-ink-700 hover:bg-ivory-100"
              }`}
            >
              {nb.title}
            </button>
          ))}
          {list.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-ink-400">No notebooks yet</div>
          )}
          <button
            type="button"
            onClick={() => void newNotebook()}
            className="mt-1 block w-full border-t border-ivory-200 px-3 py-1.5 text-left text-xs font-medium text-clay-600 hover:bg-ivory-50"
          >
            + New notebook…
          </button>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  const t = s.trim() || "Untitled";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
