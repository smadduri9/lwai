import { useEffect, useLayoutEffect, useRef } from "react";
import { useChatStore } from "./store/chatStore";
import { useUiStore } from "./store/uiStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { MessageBubble } from "./components/MessageBubble";
import { Composer } from "./components/Composer";
import { DemoRunner } from "./components/DemoRunner";
import { HeroTypewriter } from "./components/HeroTypewriter";
import { BranchPage } from "./components/BranchPage";
import { CommentRail } from "./components/CommentRail";
import { BackgroundEffect } from "./components/BackgroundEffect";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatChrome } from "./components/ChatChrome";
import { NoteCapturePanel } from "./components/NoteCapturePanel";
import { NotebookPage } from "./components/NotebookPage";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { ToastLayer } from "./components/ToastLayer";
import { WindowLayer } from "./components/WindowLayer";
import { ThemeToggle } from "./components/ThemeToggle";
import { clearFocusParams, focusChatHighlight } from "./lib/focusChat";
import { restoreScrollIfNeeded } from "./lib/notebookReturn";
import { chatUrl } from "./lib/chatUrl";
import { isNotebookView } from "./lib/viewMode";
import { useWorkspaceTabRegistration } from "./lib/useWorkspaceTabRegistration";
import { useSubchatClickAway } from "./hooks/useSubchatClickAway";
import { askTabKey } from "./lib/workspaceTabs";
import { ChatNotebookToggle } from "./components/ChatNotebookToggle";

const params = new URLSearchParams(window.location.search);
/** Conversation id from /?c=<id>. */
const conversationParam = params.get("c");
/** Sub-ask id from /?branch=<id> (focused new-tab view); null on the main page. */
const branchParam = params.get("branch");
/** Notebook view: /?view=note&nb=<id>. */
const notebookIdParam = params.get("nb");
const isNoteView = isNotebookView(window.location.search);
/** Scroll-to-message when returning from a note's "Go to source". */
const focusMessageId = params.get("focusMessage");
/** Prefer scrolling to this note's highlight mark when present. */
const focusNoteId = params.get("focusNote");

export default function App() {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const switchConversation = useWorkspaceStore((s) => s.switchConversation);
  const conversationId = useWorkspaceStore((s) => s.conversationId);

  const rootBranchId = useChatStore((s) => s.rootBranchId);
  const rootBranch = useChatStore((s) => s.branches[s.rootBranchId]);
  const status = useChatStore((s) => s.streamingBranches[s.rootBranchId]);
  const draft = useUiStore((s) => s.drafts[rootBranchId] ?? "");

  // True click-away: clicking anywhere outside the active subchat closes it.
  useSubchatClickAway();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const heroCardRef = useRef<HTMLDivElement>(null);
  const heroComposerRef = useRef<HTMLDivElement>(null);
  const footerComposerRef = useRef<HTMLDivElement>(null);
  const heroRect = useRef<DOMRect | null>(null);

  const messages = rootBranch?.messages ?? [];
  const isEmpty = messages.length === 0;
  const hasDraft = isEmpty && draft.length > 0;
  const wasEmpty = useRef(isEmpty);

  useWorkspaceTabRegistration(
    ready && conversationId && !isNoteView && !branchParam
      ? askTabKey(conversationId)
      : null,
  );

  useEffect(() => {
    void hydrate().then(async () => {
      if (conversationParam) {
        await switchConversation(conversationParam);
      }
    });
  }, [hydrate, switchConversation]);

  // Back-navigation dock: arriving at (or refocusing) the main chat forces
  // every floating subchat back onto a rail — a window may only float
  // mid-screen when explicitly floated in this view.
  useEffect(() => {
    if (!ready || isNoteView || branchParam) return;
    const dock = () => useChatStore.getState().dockFloatingWindows();
    dock();
    const onVisible = () => {
      if (document.visibilityState === "visible") dock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, conversationId]);

  useLayoutEffect(() => {
    if (isEmpty) {
      heroRect.current = heroComposerRef.current?.getBoundingClientRect() ?? null;
    }
  });

  useLayoutEffect(() => {
    const flipped = wasEmpty.current && !isEmpty;
    wasEmpty.current = isEmpty;
    if (!flipped) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const from = heroRect.current;
    const composer = footerComposerRef.current;
    if (from && composer) {
      const to = composer.getBoundingClientRect();
      composer.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scaleX(${from.width / to.width})`,
            transformOrigin: "top left",
          },
          { transform: "translate(0, 0) scaleX(1)", transformOrigin: "top left" },
        ],
        { duration: 450, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
    mainRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 400, easing: "ease-out" },
    );
  }, [isEmpty]);

  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);
  useEffect(() => {
    if (userCount > prevUserCount.current) {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevUserCount.current = userCount;
  }, [userCount]);

  // Keep URL in sync with the active chat on the main page.
  useEffect(() => {
    if (!ready || !conversationId || isNoteView || branchParam) return;
    const url = chatUrl({ conversationId });
    if (window.location.search !== new URL(url, window.location.origin).search) {
      window.history.replaceState(null, "", url);
    }
  }, [ready, conversationId, isNoteView, branchParam]);

  useEffect(() => {
    if ((!focusMessageId && !focusNoteId) || isEmpty) return;
    const t = setTimeout(() => {
      if (focusChatHighlight({ focusNoteId, focusMessageId })) {
        clearFocusParams();
      }
    }, 80);
    return () => clearTimeout(t);
  }, [focusMessageId, focusNoteId, isEmpty, messages.length]);

  useEffect(() => {
    if (!ready || isNoteView || branchParam) return;
    restoreScrollIfNeeded();
  }, [ready, isNoteView, branchParam]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading workspace…
      </div>
    );
  }

  if (isNoteView) {
    return <NotebookPage notebookId={notebookIdParam} />;
  }

  if (branchParam) {
    return <BranchPage branchId={branchParam} />;
  }

  return (
    <div className="relative flex h-full flex-col">
      <BackgroundEffect
        orbitRef={isEmpty ? heroCardRef : undefined}
        hoverEnabled={!isEmpty}
        landing={isEmpty}
      />
      <div className="pointer-events-none fixed inset-x-0 top-3 z-30 flex items-center justify-center">
        <div className="pointer-events-auto">
          <ChatNotebookToggle />
        </div>
      </div>
      <div className="fixed top-3 right-3 z-30 flex items-center gap-1.5">
        <DemoRunner />
        <ThemeToggle />
      </div>

      <ChatSidebar />

      {isEmpty ? (
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-4">
          <div ref={heroCardRef} className="w-full max-w-3xl px-2">
            {/* Heading fades out instantly on first keystroke; layout space is
                preserved (opacity only) so the input never jumps. */}
            <div
              aria-hidden={hasDraft}
              className={`transition-opacity duration-150 ${
                hasDraft ? "opacity-0" : "opacity-100"
              }`}
            >
              <HeroTypewriter paused={hasDraft} />
            </div>
            <div ref={heroComposerRef}>
              <Composer branchId={rootBranchId} autoFocus showModel hero />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative z-10 min-h-0 flex-1">
            <div ref={scrollerRef} className="main-chat-scroller h-full overflow-y-auto">
              <div
                ref={contentRef}
                className="relative flex w-full items-start justify-center gap-5 px-4 py-6 pb-40"
              >
                <CommentRail side="left" contentRef={contentRef} />

                <main
                  ref={mainRef}
                  className="relative z-0 w-full max-w-3xl shrink-0 rounded-xl border-x border-t border-ivory-200 bg-ivory-50 px-8 py-7 shadow-sm sm:px-10 lg:px-12"
                >
                  <div className="chat-chrome-enter mb-5">
                    <ChatChrome />
                  </div>
                  <div className="flex flex-col gap-5">
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        status={i === messages.length - 1 ? status : undefined}
                      />
                    ))}
                  </div>
                </main>

                <CommentRail side="right" contentRef={contentRef} />
              </div>
            </div>
          </div>

          <div className="composer-footer-fade pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 pt-16">
            {/* Equal rail spacers so Send stays under the centered Docs paper. */}
            <div className="pointer-events-none flex w-full items-end justify-center gap-5">
              <div className="pointer-events-none hidden min-w-0 flex-1 xl:block" aria-hidden />
              <div
                ref={footerComposerRef}
                className="pointer-events-auto w-full max-w-3xl shrink-0"
              >
                <Composer branchId={rootBranchId} autoFocus />
              </div>
              <div className="pointer-events-none hidden min-w-0 flex-1 lg:block" aria-hidden />
            </div>
          </div>
        </>
      )}

      <SelectionToolbar />
      <NoteCapturePanel />
      <WindowLayer />
      <ToastLayer />
    </div>
  );
}
