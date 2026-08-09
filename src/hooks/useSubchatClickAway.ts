import { useEffect } from "react";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";

/** Elements that must NOT deactivate the open subchat when clicked. */
const GUARD_SELECTOR = [
  "mark[data-branch-id]",
  "button.subchat-badge",
  "button.note-badge",
  "[data-comment-card]",
  "[data-subchat-window]",
  "[data-subchat-card]",
  "[data-selection-toolbar]",
  "[data-subchat-menu]",
].join(", ");

/**
 * True click-away listener for subchats: clicking anywhere in the document
 * outside the active subchat surface (card, window, rail, toolbar, menu,
 * highlight marks) deactivates it — not just clicks on the chat paper.
 *
 * @param exemptBranchId Branch that stays active even on click-away (the
 *   focused branch of a BranchPage tab — it *is* the page).
 */
export function useSubchatClickAway(exemptBranchId?: string) {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const ui = useUiStore.getState();
      const active = ui.activeBranchId;
      if (!active) return;
      if (active === useChatStore.getState().rootBranchId) return;
      if (exemptBranchId && active === exemptBranchId) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(GUARD_SELECTOR)) return;
      ui.setActiveBranch(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [exemptBranchId]);
}
