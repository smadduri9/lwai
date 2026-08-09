import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  addBranchToChat,
  askMoreOnBranch,
  stopAskOnBranch,
} from "../lib/subChatActions";
import { applyHighlights, isAnchorOrphaned } from "../lib/highlight";
import { navigateToQuoteOrigin } from "../lib/quoteNavigate";
import {
  ANCHOR_CONTEXT_CHARS,
  anchorText,
  anchorsForMessage,
  rangeToOffsets,
  rangeToQuotedHtml,
} from "../lib/selection";
import { isNotebookView } from "../lib/viewMode";
import { useChatStore } from "../store/chatStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";
import { AddToNotebookButton } from "./AddToNotebookButton";
import { ContextInspector } from "./ContextInspector";
import { MarkdownMessage } from "./MarkdownMessage";
import { SubChatMenu } from "./SubChatMenu";
import { ToolCallCard } from "./ToolCallCard";

const IDLE_H = 36;
const COMPACT_MAX = 96;

/**
 * Docs-style sub-chat card: centered quote, chat-format thread,
 * pill reply, Ask more / Add to note, and a ⋮ overflow menu.
 */
export function SubChatCard({
  branchId,
  side,
  variant,
  bodyHeight,
  dragHandleProps,
  autoFocusComposer = false,
  footer,
}: {
  branchId: string;
  side: "left" | "right";
  variant: "rail" | "float";
  /** Docked: fixed body scroll height when there are messages. Float: omit and use flex-1. */
  bodyHeight?: number;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  autoFocusComposer?: boolean;
  footer?: ReactNode;
}) {
  const branch = useChatStore((s) => s.branches[branchId]);
  const streaming = useChatStore((s) => Boolean(s.streamingBranches[branchId]));
  const text = useUiStore((s) => s.drafts[branchId] ?? "");
  const setDraft = useUiStore((s) => s.setDraft);
  const selectionAskBranchId = useUiStore((s) => s.selectionAskBranchId);
  const devMode = useUiStore((s) => s.devMode);
  const setPending = useSelectionStore((s) => s.setPending);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const messages = branch?.messages ?? [];
  const hasMessages = messages.length > 0;
  const quote = branch?.anchor?.quotedText?.trim() ?? "";
  const canAdd = Boolean(quote || text.trim()) && !busy;
  const showAddToNote = !isNotebookView();
  const empty = !hasMessages;

  /** Select text in a reply → floating Ask more | Add to note bubbles (not nested card). */
  const onThreadMouseUp = useCallback(() => {
    const thread = threadRef.current;
    const selection = window.getSelection();
    if (!thread || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!thread.contains(range.commonAncestorContainer)) return;

    const row = (range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
    )?.closest<HTMLElement>("[data-message-id]");
    const messageId = row?.dataset.messageId;
    if (!messageId) return;

    const msg = useChatStore.getState().branches[branchId]?.messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;

    const container = row;
    if (!container) return;
    const offsets = rangeToOffsets(container, range);
    if (!offsets) return;

    const textContent = anchorText(container);
    const quotedText = textContent.slice(offsets.startOffset, offsets.endOffset);
    if (!quotedText.trim()) return;

    // W3C TextQuoteSelector context.
    const prefix = textContent.slice(
      Math.max(0, offsets.startOffset - ANCHOR_CONTEXT_CHARS),
      offsets.startOffset,
    );
    const suffix = textContent.slice(
      offsets.endOffset,
      offsets.endOffset + ANCHOR_CONTEXT_CHARS,
    );

    const rect = range.getBoundingClientRect();
    setPending({
      kind: "chat",
      origin: variant,
      anchor: {
        sourceMessageId: messageId,
        quotedText,
        quotedHtml: rangeToQuotedHtml(range),
        prefix,
        suffix,
        ...offsets,
      },
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
    });
  }, [branchId, setPending, variant]);

  useEffect(() => {
    if (!autoFocusComposer && selectionAskBranchId !== branchId) return;
    const draft = (useUiStore.getState().drafts[branchId] ?? "").trim();
    const q =
      useChatStore.getState().branches[branchId]?.anchor?.quotedText?.trim() ?? "";
    if (draft && q && draft === q) {
      setDraft(branchId, "");
    }
    const id = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(id);
  }, [autoFocusComposer, selectionAskBranchId, branchId, setDraft]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const contentH = el.scrollHeight;
    const maxH = Math.min(COMPACT_MAX, Math.round(window.innerHeight * 0.18));
    const target = !text.trim() ? IDLE_H : Math.min(Math.max(contentH, IDLE_H), maxH);
    el.style.height = `${target}px`;
  }, [text]);

  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);
  useEffect(() => {
    if (userCount > prevUserCount.current) {
      const el = threadRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevUserCount.current = userCount;
  }, [userCount]);

  // Signature of nested-subchat anchors on this thread's messages (primitive
  // so Zustand 5 snapshots stay cached).
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const nestedSig = useChatStore((s) => {
    const own = s.branches[branchId]?.messages;
    if (!own?.length) return "";
    const ids = new Set(own.map((m) => m.id));
    return Object.values(s.branches)
      .filter((b) => b.anchor && ids.has(b.anchor.sourceMessageId))
      .map(
        (b) =>
          `${b.id}:${b.window?.mode === "minimized" ? 1 : 0}:${b.messages.length}:${b.anchor!.startOffset}-${b.anchor!.endOffset}`,
      )
      .join("|");
  });

  // Apply <mark> highlights for nested subchats anchored to replies in this
  // thread — same machinery as the main paper, so quote back-navigation can
  // always find its origin mark.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const branches = useChatStore.getState().branches;
    thread.querySelectorAll<HTMLElement>("[data-message-id]").forEach((row) => {
      const messageId = row.dataset.messageId;
      if (!messageId) return;
      const items = anchorsForMessage(branches, messageId).map(({ branchId: bid, anchor }) => ({
        branchId: bid,
        anchor,
        minimized: branches[bid]?.window?.mode === "minimized",
        active: bid === activeBranchId,
        messageCount: branches[bid]?.messages.length ?? 0,
      }));
      if (items.length || row.querySelector("mark[data-branch-id]")) {
        applyHighlights(row, items);
      }
    });
  }, [nestedSig, activeBranchId, messages]);

  if (!branch) return null;

  // Phase 2: flag anchors whose source text no longer contains the quote.
  const orphaned = (() => {
    const anchor = branch.anchor;
    if (!anchor || anchor.sourceMessageId.startsWith("note:")) return false;
    const all = useChatStore.getState().branches;
    for (const b of Object.values(all)) {
      const src = b.messages.find((m) => m.id === anchor.sourceMessageId);
      if (src) return isAnchorOrphaned(src.content, anchor);
    }
    return true;
  })();

  const askMore = () => {
    askMoreOnBranch(branchId);
  };

  /** Clicking a nested highlight/badge in a reply opens its subchat. */
  const onThreadClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "mark[data-branch-id], button.subchat-badge",
    );
    const bid = el?.dataset.branchId;
    if (!bid) return;
    e.stopPropagation();
    const chat = useChatStore.getState();
    const b = chat.branches[bid];
    if (!b?.window) return;
    if (b.window.mode === "minimized") {
      chat.setWindowMode(bid, b.window.restoreMode ?? "bubble");
    }
    chat.focusWindow(bid);
    useUiStore.getState().setActiveBranch(bid);
  };

  const addToChat = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      await addBranchToChat(branchId);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && streaming) {
      e.preventDefault();
      stopAskOnBranch(branchId);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) askMore();
    }
  };

  // Only apply fixed body height when there are messages (avoids 160–240px empty void).
  const effectiveBodyHeight = hasMessages ? bodyHeight : undefined;
  const bodyStyle =
    effectiveBodyHeight != null
      ? {
          height: effectiveBodyHeight,
          minHeight: effectiveBodyHeight,
          maxHeight: effectiveBodyHeight,
        }
      : undefined;

  return (
    <div
      data-subchat-card
      className="subchat-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        {...dragHandleProps}
        className={`subchat-card-header flex shrink-0 items-center justify-end gap-1 ${
          variant === "float"
            ? "cursor-grab touch-none select-none active:cursor-grabbing"
            : dragHandleProps
              ? "cursor-ns-resize touch-none select-none"
              : ""
        }`}
      >
        <SubChatMenu branchId={branchId} side={side} variant={variant} />
      </header>

      {quote ? (
        <div
          className={
            empty
              ? "subchat-quote-wrap subchat-quote-wrap--empty"
              : "subchat-quote-wrap shrink-0"
          }
        >
          <button
            type="button"
            aria-label="Quoted selection — go to the original highlight"
            title="Go back to the original highlighted text"
            onClick={() => navigateToQuoteOrigin(branchId)}
            className="subchat-quote-field subchat-quote-field--link"
          >
            {quote}
          </button>
          {orphaned && (
            <p className="px-2 pb-1 text-center text-[10px] text-amber-600 dark:text-amber-400">
              Original text changed — quote preserved
            </p>
          )}
        </div>
      ) : empty ? (
        <div className="subchat-quote-wrap subchat-quote-wrap--empty" aria-hidden />
      ) : null}

      {/* Diagnostic context payload — Developer Mode only; still computed in the send path. */}
      {devMode && branch.anchor ? <ContextInspector branchId={branchId} /> : null}

      {hasMessages ? (
        <div
          ref={threadRef}
          onMouseUp={onThreadMouseUp}
          onClick={onThreadClick}
          className={`subchat-card-thread min-h-0 min-w-0 overflow-y-auto ${
            effectiveBodyHeight != null ? "shrink-0" : "flex-1"
          }`}
          style={bodyStyle}
        >
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            if (m.role === "user") {
              return (
                <div
                  key={m.id}
                  data-message-id={m.id}
                  className="subchat-thread-row subchat-thread-row--user"
                >
                  <p className="subchat-thread-bubble">{m.content}</p>
                </div>
              );
            }
            return (
              <div
                key={m.id}
                data-message-id={m.id}
                className="group/subrow subchat-thread-row subchat-thread-row--assistant"
              >
                {m.artifacts?.map((a) =>
                  a.kind === "tool" ? <ToolCallCard key={a.id} artifact={a} /> : null,
                )}
                {m.content ? (
                  <MarkdownMessage content={m.content} />
                ) : streaming && isLast ? (
                  <p className="subchat-thread-text">…</p>
                ) : null}
                {streaming && isLast && m.content ? (
                  <span className="subchat-thread-streaming">…</span>
                ) : null}
                {m.content && !(streaming && isLast) ? (
                  <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover/subrow:opacity-100">
                    <AddToNotebookButton
                      compact
                      getAnchor={() => ({
                        sourceType: "chat",
                        sourceMessageId: m.id,
                        branchId,
                        quotedText: m.content,
                        startOffset: 0,
                        endOffset: m.content.length,
                      })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="subchat-card-footer shrink-0">
        <textarea
          ref={textareaRef}
          data-branch-id={branchId}
          data-branch-composer={branchId}
          value={text}
          onChange={(e) => setDraft(branchId, e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask a question…"
          className="subchat-reply-pill composer-plane composer-plane--subchat"
        />
        <div className="subchat-card-actions">
          {showAddToNote ? (
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => void addToChat()}
              title="Save the selection (and any note you typed) into the Notebook"
              className="subchat-footer-btn subchat-footer-btn--secondary"
            >
              {busy ? "Adding…" : "Add to Notebook"}
            </button>
          ) : null}
          {streaming ? (
            <button
              type="button"
              onClick={() => stopAskOnBranch(branchId)}
              title="Stop generating (Esc)"
              className="subchat-footer-btn subchat-footer-btn--stop"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={askMore}
              disabled={!text.trim()}
              className="subchat-footer-btn subchat-footer-btn--primary"
            >
              Ask more
            </button>
          )}
        </div>
      </div>
      {footer}
    </div>
  );
}
