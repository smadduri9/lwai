import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { sourceChatUrl } from "./focusChat";
import { scrollToBranchHighlight, scrollToSourceMessage } from "./scrollToHighlight";

/**
 * Back-navigation from a subchat's quoted-reference block: close/minimize the
 * current view and smooth-scroll straight to the original highlighted text in
 * the parent chat. Works across every surface:
 *
 * - Same page (rail card, floating window): minimize the branch; the store's
 *   minimize path already scrolls back to the mark and pulses it.
 * - Different page (branch opened in its own tab, or a nested subchat whose
 *   source message isn't rendered here): navigate to the parent surface with
 *   `?focusMessage=` — App/BranchPage scroll+flash the origin on load.
 */
export function navigateToQuoteOrigin(branchId: string): void {
  const chat = useChatStore.getState();
  const branch = chat.branches[branchId];
  const anchor = branch?.anchor;
  if (!anchor) return;
  // Notebook-origin quotes have no chat highlight to return to.
  if (anchor.sourceMessageId.startsWith("note:")) return;

  const originInDom =
    document.querySelector(`mark[data-branch-id="${CSS.escape(branchId)}"]`) ??
    document.querySelector(
      `[data-message-id="${CSS.escape(anchor.sourceMessageId)}"]`,
    );

  if (originInDom) {
    // Minimizing triggers scrollBackToOrigin (smooth scroll + flash). If the
    // branch is somehow already minimized, scroll directly.
    if (branch.window?.mode === "minimized") {
      if (!scrollToBranchHighlight(branchId)) {
        scrollToSourceMessage(anchor.sourceMessageId);
      }
    } else {
      chat.setWindowMode(branchId, "minimized");
    }
    return;
  }

  // Origin lives on another page — find the branch that owns the source
  // message and navigate there with a focus param.
  let parentBranchId: string | null = null;
  for (const b of Object.values(chat.branches)) {
    if (b.messages.some((m) => m.id === anchor.sourceMessageId)) {
      parentBranchId = b.id;
      break;
    }
  }

  if (branch.window && branch.window.mode !== "minimized") {
    chat.setWindowMode(branchId, "minimized");
  }
  const url = sourceChatUrl({
    sourceMessageId: anchor.sourceMessageId,
    conversationId: useWorkspaceStore.getState().conversationId,
    branchId: parentBranchId,
    rootBranchId: chat.rootBranchId,
  });
  window.location.assign(url);
}
