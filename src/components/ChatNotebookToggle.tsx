import { goNotebookBack, rememberNotebookReturn } from "../lib/notebookReturn";
import { chatUrl, notebookViewUrl } from "../lib/chatUrl";
import { isNotebookView } from "../lib/viewMode";
import { navigateInPage } from "../lib/workspaceTabs";
import { useNotebookStore } from "../store/notebookStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

/**
 * Top-center Chat | Notebook segmented control (ChatGPT-style).
 * Chat = active chat; Notebook = last-used notebook document.
 */
export function ChatNotebookToggle() {
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const lastUsedNotebookId = useNotebookStore((s) => s.lastUsedNotebookId);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const setSelectionAskBranch = useUiStore((s) => s.setSelectionAskBranch);
  const onNotebook = isNotebookView();

  const goChat = () => {
    if (!onNotebook) return;
    const fallback = chatUrl({ conversationId });
    goNotebookBack(fallback);
  };

  const goNotebook = () => {
    if (onNotebook) return;
    setActiveBranch(null);
    setSelectionAskBranch(null);
    rememberNotebookReturn();
    navigateInPage(notebookViewUrl({ notebookId: lastUsedNotebookId }));
  };

  return (
    <div
      className="chat-notebook-toggle"
      role="tablist"
      aria-label="Chat or Notebook"
    >
      <button
        type="button"
        role="tab"
        aria-selected={!onNotebook}
        className={`chat-notebook-toggle-seg${!onNotebook ? " is-active" : ""}`}
        onClick={goChat}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={onNotebook}
        className={`chat-notebook-toggle-seg${onNotebook ? " is-active" : ""}`}
        onClick={goNotebook}
      >
        Notebook
      </button>
    </div>
  );
}
