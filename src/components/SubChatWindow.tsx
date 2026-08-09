import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { useDragResize } from "../hooks/useDragResize";
import { SubChatShell } from "./SubChatShell";

/**
 * Floating Ask window: draggable by the title bar, resizable by the
 * corner handle. Used for popped-out cards and when no parent rail is visible.
 */
export function SubChatWindow({ branchId }: { branchId: string }) {
  const focusWindow = useChatStore((s) => s.focusWindow);
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const rootRef = useRef<HTMLElement>(null);
  const sage = false;
  const [popIn, setPopIn] = useState(false);

  const shell = useChatStore(
    useShallow((s) => {
      const b = s.branches[branchId];
      if (!b?.window) return null;
      return {
        x: b.window.position.x,
        y: b.window.position.y,
        width: b.window.size.width,
        height: b.window.size.height,
        zIndex: b.window.zIndex,
        railSide: b.window.railSide ?? "right",
      };
    }),
  );

  const { dragHandleProps, resizeHandleProps } = useDragResize(branchId);

  useEffect(() => {
    const pending = document.documentElement.dataset.pendingFloatCenter;
    if (pending !== branchId) return;
    delete document.documentElement.dataset.pendingFloatCenter;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    setPopIn(true);
    const id = window.setTimeout(() => setPopIn(false), 300);
    return () => window.clearTimeout(id);
  }, [branchId]);

  if (!shell) return null;

  return (
    <section
      ref={rootRef}
      data-subchat-window
      data-float-origin={popIn ? "center" : undefined}
      style={{
        position: "fixed",
        left: shell.x,
        top: shell.y,
        width: shell.width,
        height: shell.height,
        zIndex: shell.zIndex,
      }}
      onPointerDown={() => {
        focusWindow(branchId);
        if (activeBranchId !== branchId) setActiveBranch(branchId);
      }}
      className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-ink-900/20 ${
        sage ? "border-sage-300" : "border-ivory-300"
      }${popIn ? " subchat-pop-in" : ""}`}
    >
      <SubChatShell
        branchId={branchId}
        side={shell.railSide}
        variant="float"
        dragHandleProps={dragHandleProps}
        footer={
          <div
            {...resizeHandleProps}
            title="Resize"
            className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none"
          >
            <div className="absolute right-1 bottom-1 size-2 border-r-2 border-b-2 border-ivory-400" />
          </div>
        }
      />
    </section>
  );
}
