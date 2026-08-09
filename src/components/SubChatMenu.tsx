import { useEffect, useRef, useState } from "react";
import { chatUrl } from "../lib/chatUrl";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

/**
 * ⋮ overflow menu for Docs-style sub-chat cards.
 * Float variant: Align right/left, Big window (new tab), Delete.
 * Rail variant: also includes Float in middle.
 */
export function SubChatMenu({
  branchId,
  side,
  variant,
}: {
  branchId: string;
  side: "left" | "right";
  variant: "rail" | "float";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const floatSubChatToCenter = useChatStore((s) => s.floatSubChatToCenter);
  const setWindowMode = useChatStore((s) => s.setWindowMode);
  const setRailSide = useChatStore((s) => s.setRailSide);
  const deleteBranch = useChatStore((s) => s.deleteBranch);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  // Re-layout actions are locked while this branch streams (prevents layout breakage).
  const streaming = useChatStore((s) => Boolean(s.streamingBranches[branchId]));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);

  const dockAndAlign = (next: "left" | "right") => {
    if (variant === "float") setWindowMode(branchId, "bubble");
    setRailSide(branchId, next);
    close();
  };

  type Item = {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void;
  };

  const items: Item[] = [];

  if (variant === "rail") {
    items.push({
      label: "Float in middle",
      disabled: streaming,
      onClick: () => {
        floatSubChatToCenter(branchId);
        close();
      },
    });
  }

  items.push(
    {
      label: "Align right",
      disabled: side === "right" || streaming,
      onClick: () => dockAndAlign("right"),
    },
    {
      label: "Align left",
      disabled: side === "left" || streaming,
      onClick: () => dockAndAlign("left"),
    },
    {
      // Phase 5: "big window" opens a dedicated tab; this page stays put.
      label: "Big window (new tab)",
      disabled: streaming,
      onClick: () => {
        window.open(chatUrl({ conversationId, branchId }), "_blank");
        close();
      },
    },
    {
      label: "Delete",
      danger: true,
      onClick: () => {
        deleteBranch(branchId);
        setActiveBranch(null);
        close();
      },
    },
  );

  return (
    <div ref={rootRef} className="relative shrink-0" data-subchat-menu>
      <button
        type="button"
        aria-label="Sub-chat options"
        aria-expanded={open}
        aria-haspopup="menu"
        className="subchat-menu-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="subchat-menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              className={`subchat-menu-item${item.danger ? " subchat-menu-item--danger" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
