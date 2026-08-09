import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useChatStore } from "../store/chatStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";
import { applyHighlights, type HighlightItem } from "../lib/highlight";
import {
  ANCHOR_CONTEXT_CHARS,
  anchorText,
  anchorsForMessage,
  rangeToOffsets,
  rangeToQuotedHtml,
} from "../lib/selection";
import { pendingFromChatImage } from "../lib/chatImageSelect";
import { MarkdownMessage } from "./MarkdownMessage";
import type { Message } from "../types";

type AnchorMeta = {
  branchId: string;
  startOffset: number;
  endOffset: number;
  minimized: boolean;
  messageCount: number;
};

function metaSignature(
  branches: ReturnType<typeof useChatStore.getState>["branches"],
  messageId: string,
): string {
  return anchorsForMessage(branches, messageId)
    .map(({ branchId, anchor }) => {
      const branch = branches[branchId];
      return `${branchId}:${branch?.window?.mode === "minimized" ? 1 : 0}:${branch?.messages.length ?? 0}:${anchor.startOffset}-${anchor.endOffset}`;
    })
    .join("|");
}

/**
 * Renders assistant markdown and imperatively applies <mark> highlights for
 * every sub-branch anchored to this message. Selecting text arms the
 * selection toolbar; clicking a highlight/badge opens its sub-chat.
 */
export const AssistantMessage = memo(function AssistantMessage({
  message,
}: {
  message: Message;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeBranchId = useUiStore((s) => s.activeBranchId);

  // Primitive signatures — Zustand 5 requires getSnapshot to return a cached
  // value; mapped object arrays would infinite-loop.
  const metaSig = useChatStore((s) => metaSignature(s.branches, message.id));
  const metas: AnchorMeta[] = useMemo(() => {
    const branches = useChatStore.getState().branches;
    return anchorsForMessage(branches, message.id).map(({ branchId, anchor }) => {
      const branch = branches[branchId];
      return {
        branchId,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        minimized: branch?.window?.mode === "minimized",
        messageCount: branch?.messages.length ?? 0,
      };
    });
  }, [metaSig, message.id]);

  const items: HighlightItem[] = useMemo(
    () =>
      metas.map((m) => {
        const branch = useChatStore.getState().branches[m.branchId];
        return {
          branchId: m.branchId,
          anchor: branch!.anchor!,
          minimized: m.minimized,
          active: m.branchId === activeBranchId,
          messageCount: m.messageCount,
        };
      }),
    [metas, activeBranchId],
  );

  const setWindowMode = useChatStore((s) => s.setWindowMode);
  const focusWindow = useChatStore((s) => s.focusWindow);
  const setPending = useSelectionStore((s) => s.setPending);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);

  // Track whether marks were ever applied so we can skip the empty-list run
  // on first render but still unwrap stale <mark>s the instant the last
  // anchored subchat is deleted (no reload needed).
  const hadMarksRef = useRef(false);
  useEffect(() => {
    if (!containerRef.current) return;
    if (items.length === 0 && !hadMarksRef.current) return;
    applyHighlights(containerRef.current, items);
    hadMarksRef.current = items.length > 0;
  }, [items, message.content]);

  const handleMouseUp = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const offsets = rangeToOffsets(container, range);
    if (!offsets) return;

    const text = anchorText(container);
    const quotedText = text.slice(offsets.startOffset, offsets.endOffset);
    if (!quotedText.trim()) return;
    const quotedHtml = rangeToQuotedHtml(range);

    // W3C TextQuoteSelector context: 32 chars either side of the quote.
    const prefix = text.slice(
      Math.max(0, offsets.startOffset - ANCHOR_CONTEXT_CHARS),
      offsets.startOffset,
    );
    const suffix = text.slice(offsets.endOffset, offsets.endOffset + ANCHOR_CONTEXT_CHARS);

    const rect = range.getBoundingClientRect();
    const pending = {
      kind: "chat" as const,
      anchor: { sourceMessageId: message.id, quotedText, quotedHtml, prefix, suffix, ...offsets },
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
    };

    // Selection toolbar only fires in the main chat paper or a branch's own
    // dedicated tab. Inside docked rail cards / floating windows, selecting
    // text does nothing (no toolbar, no auto-spawned subchat).
    const inSideSubchat = Boolean(
      container.closest("[data-comment-card], [data-subchat-window]"),
    );
    if (inSideSubchat) return;
    setPending(pending);
  }, [message.id, setPending]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const img = (e.target as HTMLElement).closest<HTMLImageElement>("img[data-chat-image]");
      if (img) {
        e.preventDefault();
        e.stopPropagation();
        const pending = pendingFromChatImage(img, message.id);
        if (pending) setPending(pending);
        return;
      }

      const el = (e.target as HTMLElement).closest<HTMLElement>(
        "mark[data-branch-id], button.subchat-badge",
      );
      const branchId = el?.dataset.branchId;
      if (!branchId) return;
      e.stopPropagation();
      const branch = useChatStore.getState().branches[branchId];
      if (!branch?.window) return;
      if (branch.window.mode === "minimized") {
        setWindowMode(branchId, branch.window.restoreMode ?? "bubble");
      }
      focusWindow(branchId);
      setActiveBranch(branchId);
    },
    [message.id, setPending, setWindowMode, focusWindow, setActiveBranch],
  );

  return (
    <div
      ref={containerRef}
      data-message-id={message.id}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      className="text-[15px] leading-relaxed text-ink-800 select-text"
    >
      <MarkdownMessage content={message.content} />
    </div>
  );
});
