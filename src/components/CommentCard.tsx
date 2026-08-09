import { forwardRef, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { isAnchorOrphaned } from "../lib/highlight";
import {
  SUBCHAT_DEFAULT_BODY_HEIGHT,
  SUBCHAT_DEFAULT_CARD_WIDTH,
  SUBCHAT_MAX_BODY_HEIGHT,
  SUBCHAT_MIN_BODY_HEIGHT,
  SUBCHAT_MIN_WIDTH,
  clampRailSize,
} from "../lib/subChatLayout";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { SubChatShell } from "./SubChatShell";

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/**
 * A Docs-style comment card docked in a margin rail. Collapsed cards show only
 * the selection quote; the active card expands into a full chat thread.
 */
export const CommentCard = forwardRef<
  HTMLDivElement,
  { branchId: string; side: "left" | "right" }
>(function CommentCard({ branchId, side }, ref) {
  const branch = useChatStore((s) => s.branches[branchId]);
  const branches = useChatStore((s) => s.branches);
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const setRailSize = useChatStore((s) => s.setRailSize);
  const setRailOffsetY = useChatStore((s) => s.setRailOffsetY);

  const active = branchId === activeBranchId;
  const sage = false;
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Phase 2: orphaned anchor — the quoted text no longer exists in its source.
  const orphaned = useMemo(() => {
    const anchor = branch?.anchor;
    if (!anchor || anchor.sourceMessageId.startsWith("note:")) return false;
    for (const b of Object.values(branches)) {
      const src = b.messages.find((m) => m.id === anchor.sourceMessageId);
      if (src) return isAnchorOrphaned(src.content, anchor);
    }
    return true;
  }, [branch?.anchor, branches]);

  if (!branch) return null;

  const hasMessages = branch.messages.length > 0;
  const cardWidth = active
    ? Math.max(branch.window?.railSize?.w ?? SUBCHAT_DEFAULT_CARD_WIDTH, SUBCHAT_MIN_WIDTH)
    : undefined;
  // Only reserve thread height once there are replies (avoids empty 160–240px void).
  const bodyHeight = hasMessages
    ? (branch.window?.railSize?.h ?? SUBCHAT_DEFAULT_BODY_HEIGHT)
    : undefined;

  const activate = () => {
    if (!active) {
      setActiveBranch(branchId);
      const mark = document.querySelector<HTMLElement>(`mark[data-branch-id="${branchId}"]`);
      if (mark) {
        const r = mark.getBoundingClientRect();
        const offScreen = r.top < 56 || r.bottom > window.innerHeight - 56;
        if (offScreen) mark.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, axis: "w" | "h" | "both") => {
    e.preventDefault();
    e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = branch.window?.railSize?.h ?? SUBCHAT_DEFAULT_BODY_HEIGHT;
    const handle = e.target as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; window listeners still track moves.
    }

    const onMove = (ev: PointerEvent) => {
      const patch: { w?: number; h?: number } = {};
      if (axis !== "h") {
        const dx = side === "right" ? startX - ev.clientX : ev.clientX - startX;
        patch.w = clamp(startW + dx, SUBCHAT_MIN_WIDTH, Math.round(window.innerWidth * 0.7));
      }
      if (axis !== "w") {
        patch.h = clamp(
          startH + (ev.clientY - startY),
          SUBCHAT_MIN_BODY_HEIGHT,
          SUBCHAT_MAX_BODY_HEIGHT,
        );
      }
      setRailSize(branchId, clampRailSize(patch));
    };
    const onUp = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        // No capture to release.
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startVerticalSlide = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("[data-subchat-menu]")) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startOffset = branch.window?.railOffsetY ?? 0;
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Window listeners still track moves.
    }

    const onMove = (ev: PointerEvent) => {
      const next = startOffset + (ev.clientY - startY);
      const max = Math.round(window.innerHeight * 2);
      setRailOffsetY(branchId, clamp(next, -max, max));
    };
    const onUp = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        // No capture to release.
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const railDragHandleProps = {
    onPointerDown: startVerticalSlide,
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      setRailOffsetY(branchId, null);
    },
    title: "Drag to slide · double-click to reset",
  };

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      data-comment-card
      style={cardWidth ? { width: cardWidth, minWidth: SUBCHAT_MIN_WIDTH } : undefined}
      className={`pointer-events-auto relative w-full min-w-0 rounded-2xl border bg-card transition-[box-shadow,border-color] duration-200 ${
        active
          ? `${sage ? "border-sage-600/50" : "border-clay-500/40"} shadow-lg shadow-ink-900/10 ${side === "left" ? "translate-x-2" : "-translate-x-2"}`
          : sage
            ? "border-sage-300 shadow-sm hover:shadow-md"
            : "border-ivory-300 shadow-sm hover:shadow-md"
      }`}
    >
      {active ? (
        <SubChatShell
          branchId={branchId}
          side={side}
          variant="rail"
          bodyHeight={bodyHeight}
          autoFocusComposer
          dragHandleProps={railDragHandleProps}
          footer={
            <>
              <div
                onPointerDown={(e) => startResize(e, "w")}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRailSize(branchId, null);
                }}
                title="Drag to widen · double-click to reset"
                className={`group absolute top-2 bottom-8 w-2.5 cursor-ew-resize touch-none ${
                  side === "right" ? "-left-1" : "-right-1"
                }`}
              >
                <div className="mx-auto h-full w-1 rounded-full transition-colors group-hover:bg-clay-500/40" />
              </div>
              <div
                onPointerDown={(e) => startResize(e, "h")}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRailSize(branchId, null);
                }}
                title="Drag to grow the thread · double-click to reset"
                className="group absolute right-8 -bottom-1 left-8 h-2.5 cursor-ns-resize touch-none"
              >
                <div className="my-auto mt-1 h-1 w-full rounded-full transition-colors group-hover:bg-clay-500/40" />
              </div>
              <div
                onPointerDown={(e) => startResize(e, "both")}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRailSize(branchId, null);
                }}
                title="Drag to resize · double-click to reset"
                className={`absolute bottom-0 size-4 touch-none ${
                  side === "right" ? "left-0 cursor-nesw-resize" : "right-0 cursor-nwse-resize"
                }`}
              >
                <div
                  className={`absolute bottom-1 size-2 border-b-2 border-ivory-400 ${
                    side === "right" ? "left-1 border-l-2" : "right-1 border-r-2"
                  }`}
                />
              </div>
            </>
          }
        />
      ) : (
        <button
          type="button"
          onClick={activate}
          className="w-full cursor-pointer px-3 py-2.5 text-center"
        >
          {branch.anchor?.quotedText ? (
            <>
              <p className="truncate text-[13px] leading-snug text-ink-600">
                “{branch.anchor.quotedText}”
              </p>
              {orphaned && (
                <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                  Original text changed
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-ink-400 italic">Click to ask</p>
          )}
        </button>
      )}
    </div>
  );
});
