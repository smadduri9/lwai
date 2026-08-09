import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  addBranchToChat,
  askMoreOnBranch,
  stopAskOnBranch,
} from "../lib/subChatActions";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { ModelPicker } from "./ModelPicker";

/**
 * Full-page branch footer composer (BranchPage).
 * Side cards use SubChatCard instead.
 * Fixed height (~3 lines); long drafts scroll internally.
 */
export function SubChatComposer({
  branchId,
  autoFocus = false,
  placeholder = "Ask a question…",
}: {
  branchId: string;
  autoFocus?: boolean;
  placeholder?: string;
  /** @deprecated Card UI no longer uses bare mode; kept for call-site compat. */
  bare?: boolean;
}) {
  const text = useUiStore((s) => s.drafts[branchId] ?? "");
  const setDraft = useUiStore((s) => s.setDraft);
  const setText = (value: string) => setDraft(branchId, value);
  const streaming = useChatStore((s) => Boolean(s.streamingBranches[branchId]));
  const branch = useChatStore((s) => s.branches[branchId]);
  const selectionAskBranchId = useUiStore((s) => s.selectionAskBranchId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!autoFocus && selectionAskBranchId !== branchId) return;
    const draft = (useUiStore.getState().drafts[branchId] ?? "").trim();
    const quote =
      useChatStore.getState().branches[branchId]?.anchor?.quotedText?.trim() ?? "";
    if (draft && quote && draft === quote) {
      setDraft(branchId, "");
    }
    const id = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(id);
  }, [autoFocus, selectionAskBranchId, branchId, setDraft]);

  const a = branch?.anchor;
  const canAddToChat = Boolean((a?.quotedText?.trim() || text.trim()) && !busy);

  const addToChat = async () => {
    if (!canAddToChat || busy) return;
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
      if (!streaming) askMoreOnBranch(branchId);
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-ivory-300 bg-card p-2 shadow-md shadow-ink-900/10"
      data-branch-composer={branchId}
    >
      <textarea
        ref={textareaRef}
        data-branch-id={branchId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={placeholder}
        className="composer-plane h-[84px] w-full min-w-0 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-3.5 py-2.5 text-[15px] leading-snug text-ink-800 placeholder-ink-400 outline-none"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ModelPicker compact={false} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={!canAddToChat}
            onClick={() => void addToChat()}
            title="Save the selection (and any note you typed) into the Notebook"
            className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add to note"}
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={() => stopAskOnBranch(branchId)}
              title="Stop generating (Esc)"
              className="composer-stop-btn shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium text-white shadow-sm"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => askMoreOnBranch(branchId)}
              disabled={!text.trim()}
              className="shrink-0 whitespace-nowrap rounded-full bg-clay-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-clay-600 disabled:cursor-not-allowed disabled:bg-ivory-300 disabled:text-ink-400"
            >
              Ask more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
