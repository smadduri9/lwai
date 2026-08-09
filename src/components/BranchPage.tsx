import { useEffect, useMemo, useRef } from "react";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { branchChain } from "../lib/context";
import { clearFocusParams, focusChatHighlight } from "../lib/focusChat";
import { isAnchorOrphaned } from "../lib/highlight";
import { restoreScrollIfNeeded } from "../lib/notebookReturn";
import { chatUrl } from "../lib/chatUrl";
import { quoteLabel } from "../lib/quoteLabel";
import { navigateToQuoteOrigin } from "../lib/quoteNavigate";
import { useWorkspaceTabRegistration } from "../lib/useWorkspaceTabRegistration";
import { useSubchatClickAway } from "../hooks/useSubchatClickAway";
import { branchTabKey } from "../lib/workspaceTabs";
import { ChatThread } from "./ChatThread";
import { BackgroundEffect } from "./BackgroundEffect";
import { ChatSidebar } from "./ChatSidebar";
import { ChatChrome } from "./ChatChrome";
import { ChatNotebookToggle } from "./ChatNotebookToggle";
import { CommentRail } from "./CommentRail";
import { ContextInspector } from "./ContextInspector";
import { NoteCapturePanel } from "./NoteCapturePanel";
import { SelectionToolbar } from "./SelectionToolbar";
import { SubChatComposer } from "./SubChatComposer";
import { ToastLayer } from "./ToastLayer";
import { ThemeToggle } from "./ThemeToggle";
import { WindowLayer } from "./WindowLayer";

const focusParams = new URLSearchParams(window.location.search);
const focusMessageId = focusParams.get("focusMessage");
const focusNoteId = focusParams.get("focusNote");

/**
 * Focused full-page view of a single Ask branch, opened in its own tab via
 * /?branch=<id>. Layout matches main filled ask (paper + footer composer).
 * The focused branch is the big paper — never also floated as a small window.
 */
export function BranchPage({ branchId }: { branchId: string }) {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const branch = useChatStore((s) => s.branches[branchId]);
  const branches = useChatStore((s) => s.branches);
  const messageCount = useChatStore((s) => s.branches[branchId]?.messages.length ?? 0);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const devMode = useUiStore((s) => s.devMode);
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useWorkspaceTabRegistration(ready ? branchTabKey(branchId) : null);

  // True click-away for nested subchats; the page's own branch stays active.
  useSubchatClickAway(branchId);

  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);

  useEffect(() => {
    setActiveBranch(branchId);
  }, [branchId, setActiveBranch]);

  useEffect(() => {
    if (!focusMessageId && !focusNoteId) return;
    const t = setTimeout(() => {
      if (focusChatHighlight({ focusNoteId, focusMessageId })) {
        clearFocusParams();
      }
    }, 100);
    return () => clearTimeout(t);
  }, [branchId, messageCount]);

  useEffect(() => {
    if (!ready) return;
    restoreScrollIfNeeded();
  }, [ready, branchId]);

  const label = quoteLabel(branch?.anchor?.quotedText);
  useEffect(() => {
    const prev = document.title;
    document.title = `Ask · ${label}`;
    return () => {
      document.title = prev;
    };
  }, [label]);

  // Phase 2: orphaned anchor — original text was edited away; keep the card.
  const orphaned = useMemo(() => {
    const anchor = branch?.anchor;
    if (!anchor || anchor.sourceMessageId.startsWith("note:")) return false;
    for (const b of Object.values(branches)) {
      const src = b.messages.find((m) => m.id === anchor.sourceMessageId);
      if (src) return isAnchorOrphaned(src.content, anchor);
    }
    return true;
  }, [branch?.anchor, branches]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading workspace…
      </div>
    );
  }

  if (!branch) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="font-serif text-lg text-ink-700">Ask not found</p>
        <p className="text-sm text-ink-400">It may have been deleted in another tab.</p>
        <a
          href={chatUrl({ conversationId })}
          className="mt-2 rounded-full border border-ivory-300 bg-card px-4 py-1.5 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600"
        >
          Back to the main chat
        </a>
      </div>
    );
  }

  const chain = branchChain(branches, branchId);
  const crumbs = chain.slice(0, -1);

  return (
    <div className="relative flex h-full flex-col">
      <BackgroundEffect />
      <div className="pointer-events-none fixed inset-x-0 top-3 z-30 flex items-center justify-center">
        <div className="pointer-events-auto">
          <ChatNotebookToggle />
        </div>
      </div>
      <div className="fixed top-3 right-3 z-30 flex items-center gap-1.5">
        <ThemeToggle />
      </div>

      <ChatSidebar />

      <div className="relative z-10 min-h-0 flex-1">
        <div className="main-chat-scroller h-full overflow-y-auto">
          <div
            ref={contentRef}
            className="relative flex w-full items-start justify-center gap-5 px-4 py-6 pb-40"
          >
            <CommentRail side="left" contentRef={contentRef} dockParentId={branchId} />

            <main
              ref={mainRef}
              className="relative z-0 w-full max-w-3xl shrink-0 rounded-xl border-x border-t border-ivory-200 bg-ivory-50 px-8 py-7 shadow-sm sm:px-10 lg:px-12"
            >
              <div className="mb-5">
                <ChatChrome />
              </div>
              <nav className="mb-3 truncate text-[12px] text-ink-500">
                {crumbs.map((b) => (
                  <span key={b.id}>
                    {b.parentBranchId === null ? (
                      <a
                        href={chatUrl({ conversationId })}
                        className="transition-colors hover:text-clay-600"
                      >
                        Main chat
                      </a>
                    ) : (
                      <a
                        href={chatUrl({ conversationId, branchId: b.id })}
                        className="transition-colors hover:text-clay-600"
                      >
                        {quoteLabel(b.anchor?.quotedText)}
                      </a>
                    )}
                    <span className="mx-1.5 text-ink-300">›</span>
                  </span>
                ))}
                <span className="font-medium text-ink-700">This thread</span>
              </nav>
              {branch.anchor && (
                <button
                  type="button"
                  title="Go back to the original highlighted text"
                  onClick={() => navigateToQuoteOrigin(branchId)}
                  className="mb-2 block max-w-full truncate text-left text-sm text-ink-600 transition-colors hover:text-clay-600 hover:underline"
                >
                  “{quoteLabel(branch.anchor.quotedText, 72)}”
                </button>
              )}
              {orphaned && (
                <p className="mb-3 w-fit rounded-full border border-amber-300/60 bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  Original text changed — this thread keeps its quoted excerpt
                </p>
              )}
              {devMode && branch.anchor && (
                <div className="mb-5 overflow-hidden rounded-lg border border-ivory-200">
                  <ContextInspector branchId={branchId} />
                </div>
              )}
              <ChatThread branchId={branchId} />
            </main>

            <CommentRail side="right" contentRef={contentRef} dockParentId={branchId} />
          </div>
        </div>
      </div>

      <div className="composer-footer-fade pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 pt-16">
        <div className="pointer-events-none flex w-full items-end justify-center gap-5">
          <div className="pointer-events-none hidden min-w-0 flex-1 xl:block" aria-hidden />
          <div className="pointer-events-auto w-full max-w-3xl shrink-0">
            <SubChatComposer
              branchId={branchId}
              autoFocus
              bare={false}
              placeholder="Ask a question…"
            />
          </div>
          <div className="pointer-events-none hidden min-w-0 flex-1 lg:block" aria-hidden />
        </div>
      </div>

      <SelectionToolbar />
      <NoteCapturePanel />
      <WindowLayer hideBranchId={branchId} />
      <ToastLayer />
    </div>
  );
}
