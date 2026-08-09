import { useChatStore } from "../store/chatStore";
import { useDemoStore } from "../store/demoStore";
import { useModelStore } from "../store/modelStore";
import { useStatsStore } from "../store/statsStore";
import { buildApiMessages, buildSystemContext, contextBudgetChars } from "./context";
import { streamChat } from "./streamChat";

/** Per-branch abort controllers for in-flight streams. */
const controllers = new Map<string, AbortController>();

/**
 * Abort an in-flight stream for this branch. Partial assistant text is kept.
 * Cleanup of streaming flag / stats happens in the stream's onDone, unless a
 * newer stream has already replaced this controller.
 */
export function stopMessage(branchId: string): void {
  const controller = controllers.get(branchId);
  if (controller) {
    controllers.delete(branchId);
    controller.abort();
  }
  useChatStore.getState().setStreaming(branchId, false);
}

/** Demo mode: stream a scripted reply chunk-by-chunk — no model, no server. */
async function streamScriptedReply(
  branchId: string,
  assistantMessageId: string,
  text: string,
): Promise<void> {
  const store = useChatStore.getState();
  store.setStreaming(branchId, true);
  const chunks = text.match(/[\s\S]{1,6}/g) ?? [];
  for (let i = 0; i < chunks.length; i++) {
    if (!useDemoStore.getState().active) {
      // Demo aborted — flush the remainder so the message isn't left cut off.
      useChatStore
        .getState()
        .appendStreamDelta(assistantMessageId, branchId, chunks.slice(i).join(""));
      break;
    }
    await new Promise((r) => setTimeout(r, 22));
    useChatStore.getState().appendStreamDelta(assistantMessageId, branchId, chunks[i]);
  }
  useChatStore.getState().setStreaming(branchId, false);
}

async function streamAssistantReply(branchId: string, assistantMessageId: string): Promise<void> {
  // Automated demo intercepts at the send level for deterministic timing.
  if (useDemoStore.getState().active) {
    const script = useDemoStore.getState().dequeueReply();
    if (script !== null) {
      await streamScriptedReply(branchId, assistantMessageId, script);
      return;
    }
  }

  const branches = useChatStore.getState().branches;
  const budgetChars = contextBudgetChars(useModelStore.getState().provider);
  const apiMessages = buildApiMessages(branches, branchId, { budgetChars });
  const system = buildSystemContext(branches, branchId);
  useStatsStore
    .getState()
    .beginRequest(
      apiMessages.length,
      apiMessages.reduce((n, m) => n + m.content.length, 0),
    );

  const controller = new AbortController();
  controllers.set(branchId, controller);
  useChatStore.getState().setStreaming(branchId, true);

  await streamChat(apiMessages, {
    signal: controller.signal,
    onDelta: (delta) => {
      useChatStore.getState().appendStreamDelta(assistantMessageId, branchId, delta);
    },
    onStatus: (phase, query) => {
      useChatStore.getState().setStreamStatus(branchId, phase, query);
    },
    onCitation: (citation) => {
      useChatStore.getState().addCitation(assistantMessageId, branchId, citation);
    },
    onArtifact: (artifact) => {
      useChatStore.getState().addArtifact(assistantMessageId, branchId, artifact);
    },
    onToolStart: (tool) => {
      useChatStore.getState().addArtifact(assistantMessageId, branchId, {
        kind: "tool",
        id: tool.id,
        name: tool.name,
        input: "",
        status: "running",
      });
    },
    onToolInput: (tool) => {
      useChatStore
        .getState()
        .updateToolArtifact(assistantMessageId, branchId, tool.id, { input: tool.input });
    },
    onToolResult: (tool) => {
      useChatStore.getState().updateToolArtifact(assistantMessageId, branchId, tool.id, {
        output: tool.output,
        status: tool.status,
      });
    },
    onUsage: (patch) => {
      useStatsStore.getState().updateLast(patch);
    },
    onDone: () => {
      const current = controllers.get(branchId);
      if (current === controller) {
        controllers.delete(branchId);
        useChatStore.getState().setStreaming(branchId, false);
        useStatsStore.getState().finishResponse();
      } else if (!current) {
        // Aborted via stopMessage with no replacement stream yet.
        useChatStore.getState().setStreaming(branchId, false);
        useStatsStore.getState().finishResponse();
      }
      // else: a newer stream owns this branch — leave it alone.
    },
    onError: (message) => {
      const current = controllers.get(branchId);
      if (current === controller) {
        controllers.delete(branchId);
        const s = useChatStore.getState();
        s.appendStreamDelta(assistantMessageId, branchId, `⚠ ${message}`);
        s.setStreaming(branchId, false);
        useStatsStore.getState().finishResponse();
      }
    },
  }, { system });
}

/**
 * Full send flow for any branch: append the user message, assemble ancestor
 * context, then stream the assistant reply (with live web search status and
 * citations) into a placeholder message.
 */
export async function sendMessage(branchId: string, text: string): Promise<void> {
  const store = useChatStore.getState();
  const trimmed = text.trim();
  if (!trimmed || store.streamingBranches[branchId]) return;

  store.appendMessage(branchId, "user", trimmed);
  const assistantMessageId = store.appendMessage(branchId, "assistant", "");
  await streamAssistantReply(branchId, assistantMessageId);
}

/**
 * Edit a past user message: stop any stream, truncate from that message,
 * write the new text, then stream a fresh assistant reply.
 */
export async function regenerateFromEdit(
  branchId: string,
  messageId: string,
  newContent: string,
): Promise<void> {
  const trimmed = newContent.trim();
  if (!trimmed) return;

  stopMessage(branchId);

  const store = useChatStore.getState();
  store.truncateBranchFromMessage(branchId, messageId);
  store.updateUserMessage(branchId, messageId, trimmed);

  const assistantMessageId = store.appendMessage(branchId, "assistant", "");
  await streamAssistantReply(branchId, assistantMessageId);
}
