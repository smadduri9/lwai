import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { notebookViewUrl } from "../lib/chatUrl";
import { useWorkspaceTabRegistration } from "../lib/useWorkspaceTabRegistration";
import { noteTabKey } from "../lib/workspaceTabs";
import { BackgroundEffect } from "./BackgroundEffect";
import { ChatNotebookToggle } from "./ChatNotebookToggle";
import { NotebookEditor } from "./NotebookEditor";
import { NotebookOutline } from "./NotebookOutline";
import { SelectionToolbar } from "./SelectionToolbar";
import { ToastLayer } from "./ToastLayer";
import { ThemeToggle } from "./ThemeToggle";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { sortedNotebooks, useNotebookStore } from "../store/notebookStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const XL_QUERY = "(min-width: 1280px)";

/**
 * Notebook view: outline + paper for one standalone notebook document.
 * Back returns to the previous chat/branch location with scroll restore.
 */
export function NotebookPage({ notebookId }: { notebookId: string | null }) {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const notebooks = useNotebookStore((s) => s.notebooks);
  const lastUsedNotebookId = useNotebookStore((s) => s.lastUsedNotebookId);
  const setLastUsedNotebook = useNotebookStore((s) => s.setLastUsedNotebook);
  const renameNotebook = useNotebookStore((s) => s.renameNotebook);
  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const setSelectionAskBranch = useUiStore((s) => s.setSelectionAskBranch);
  const contentRef = useRef<HTMLDivElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const isXl = useMediaQuery(XL_QUERY);

  const scopeId = notebookId ?? lastUsedNotebookId;
  const notebook = (scopeId && notebooks[scopeId]) || sortedNotebooks(notebooks)[0] || null;
  const title = notebook?.title?.trim() || "Notebook";

  useWorkspaceTabRegistration(ready && notebook ? noteTabKey(notebook.id) : null);

  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);

  // Viewing a notebook makes it the global capture target.
  useEffect(() => {
    if (!ready || !notebook) return;
    if (lastUsedNotebookId !== notebook.id) setLastUsedNotebook(notebook.id);
  }, [ready, notebook, lastUsedNotebookId, setLastUsedNotebook]);

  useEffect(() => {
    if (!ready || !notebook) return;
    const url = notebookViewUrl({ notebookId: notebook.id });
    if (window.location.search !== new URL(url, window.location.origin).search) {
      window.history.replaceState(null, "", url);
    }
  }, [ready, notebook]);

  useEffect(() => {
    setActiveBranch(null);
    setSelectionAskBranch(null);
  }, [setActiveBranch, setSelectionAskBranch]);

  const commitTitle = () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (!notebook || !next || next === title) return;
    void renameNotebook(notebook.id, next);
  };

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading workspace…
      </div>
    );
  }

  const outline = (
    <NotebookOutline
      notebook={notebook}
      className={isXl ? "min-h-0 flex-1" : "min-h-[12rem]"}
    />
  );

  return (
    <div className="relative flex h-full flex-col">
      <BackgroundEffect hoverEnabled />

      {/* Floating controls — no full-width header bar */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex min-w-0 max-w-[min(100%,28rem)] flex-wrap items-center gap-2">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="min-w-0 max-w-[12rem] truncate rounded-full border border-ivory-300 bg-card/95 px-3 py-1 font-serif text-sm text-ink-800 shadow-sm outline-none backdrop-blur focus:border-clay-500"
            />
          ) : (
            <button
              type="button"
              title="Rename notebook"
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
              className="min-w-0 max-w-[12rem] truncate rounded-full border border-ivory-300 bg-card/95 px-3 py-1 font-serif text-sm text-ink-800 shadow-sm backdrop-blur transition-colors hover:border-clay-500/50 hover:text-clay-600"
            >
              {title}
            </button>
          )}
        </div>
        <div className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2">
          <ChatNotebookToggle />
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <WorkspaceSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto pt-14">
        {!isXl && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-2">
            {outline}
          </div>
        )}

        <div
          ref={contentRef}
          className="relative flex w-full items-start justify-center gap-5 px-4 py-6"
        >
          {isXl && (
            <div className="sticky top-4 z-[2] flex min-h-[calc(100vh-8rem)] w-[280px] shrink-0 flex-col gap-3">
              {outline}
            </div>
          )}

          <main className="relative z-0 w-full max-w-4xl shrink-0 rounded-xl border border-ivory-200/80 bg-ivory-50 px-8 py-10 shadow-sm sm:px-10 lg:px-12">
            {!notebook ? (
              <div className="py-20 text-center text-sm leading-relaxed text-ink-400">
                <p>No notebook yet.</p>
                <button
                  type="button"
                  onClick={() => void createNotebook("My Notebook")}
                  className="mt-3 rounded-full border border-ivory-300 bg-card px-4 py-1.5 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600"
                >
                  Create a notebook
                </button>
              </div>
            ) : (
              <NotebookEditor notebook={notebook} />
            )}
          </main>
        </div>
      </div>

      <SelectionToolbar />
      <ToastLayer />
    </div>
  );
}
