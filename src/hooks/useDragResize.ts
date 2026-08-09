import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SUBCHAT_MIN_HEIGHT, SUBCHAT_MIN_WIDTH, clampSubChatSize } from "../lib/subChatLayout";
import { useChatStore } from "../store/chatStore";

/**
 * Pointer-capture based drag (title bar) and resize (corner handle) for a
 * sub-chat window. Writes position/size to the store so they persist.
 * Store writes are rAF-coalesced to avoid per-move React churn.
 */
export function useDragResize(branchId: string) {
  const gesture = useRef<{
    kind: "drag" | "resize";
    startX: number;
    startY: number;
    origin: { x: number; y: number };
    size: { width: number; height: number };
  } | null>(null);
  const pending = useRef<{
    position?: { x: number; y: number };
    size?: { width: number; height: number };
  } | null>(null);
  const rafId = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafId.current = null;
    const patch = pending.current;
    pending.current = null;
    if (!patch) return;
    useChatStore.getState().setWindowRect(branchId, patch);
  }, [branchId]);

  const queue = useCallback(
    (patch: {
      position?: { x: number; y: number };
      size?: { width: number; height: number };
    }) => {
      pending.current = { ...pending.current, ...patch };
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const begin = useCallback(
    (kind: "drag" | "resize") => (e: ReactPointerEvent<HTMLElement>) => {
      const win = useChatStore.getState().branches[branchId]?.window;
      if (!win) return;
      e.preventDefault();
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is unavailable for synthetic events; drag still works
        // as long as the pointer stays over the handle.
      }
      gesture.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...win.position },
        size: { ...win.size },
      };
    },
    [branchId],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (g.kind === "drag") {
        queue({
          position: {
            x: clamp(g.origin.x + dx, 0, window.innerWidth - 80),
            y: clamp(g.origin.y + dy, 0, window.innerHeight - 48),
          },
        });
      } else {
        queue({
          size: clampSubChatSize(
            {
              width: g.size.width + dx,
              height: g.size.height + dy,
            },
            { width: window.innerWidth, height: window.innerHeight },
          ),
        });
      }
    },
    [queue],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      gesture.current = null;
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (pending.current) flush();
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // No capture to release.
      }
    },
    [flush],
  );

  return {
    dragHandleProps: {
      onPointerDown: begin("drag"),
      onPointerMove,
      onPointerUp,
    },
    resizeHandleProps: {
      onPointerDown: begin("resize"),
      onPointerMove,
      onPointerUp,
    },
    mins: { width: SUBCHAT_MIN_WIDTH, height: SUBCHAT_MIN_HEIGHT },
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
