import { sendMessage, stopMessage } from "./send";
import { isNotebookView } from "./viewMode";
import { useChatStore } from "../store/chatStore";
import { useNotebookStore } from "../store/notebookStore";
import { useUiStore } from "../store/uiStore";

/** Send the current draft as an Ask-more reply (clears draft on send). */
export function askMoreOnBranch(branchId: string): boolean {
  const draft = (useUiStore.getState().drafts[branchId] ?? "").trim();
  if (!draft) return false;
  if (useChatStore.getState().streamingBranches[branchId]) return false;
  useUiStore.getState().setDraft(branchId, "");
  void sendMessage(branchId, draft);
  return true;
}

export function stopAskOnBranch(branchId: string): void {
  stopMessage(branchId);
}

/**
 * Capture the branch selection (and optional draft thought) into the
 * last-used Notebook. Returns true when a capture was saved.
 * No-op on Notebook view (user edits the notebook directly).
 */
export async function addBranchToChat(branchId: string): Promise<boolean> {
  if (isNotebookView()) return false;

  const branch = useChatStore.getState().branches[branchId];
  const a = branch?.anchor;
  const thought = (useUiStore.getState().drafts[branchId] ?? "").trim();
  const quote = a?.quotedText?.trim() ?? "";
  if (!(quote || thought)) return false;

  const notebookId = await useNotebookStore.getState().appendCapture(
    {
      sourceType: "chat",
      sourceMessageId: a?.sourceMessageId,
      branchId,
      quotedText: quote,
      quotedHtml: quote ? a?.quotedHtml : undefined,
      startOffset: a?.startOffset ?? 0,
      endOffset: a?.endOffset ?? quote.length,
    },
    thought,
  );
  if (thought) useUiStore.getState().setDraft(branchId, "");
  return Boolean(notebookId);
}

export function canAddBranchToChat(branchId: string): boolean {
  if (isNotebookView()) return false;
  const branch = useChatStore.getState().branches[branchId];
  const a = branch?.anchor;
  const thought = (useUiStore.getState().drafts[branchId] ?? "").trim();
  return Boolean(a?.quotedText?.trim() || thought);
}
