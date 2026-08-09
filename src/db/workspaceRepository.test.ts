import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceDb } from "./schema";
import {
  appendMessage,
  appendToNotebook,
  createChat,
  createNotebook,
  createSubBranch,
  deleteConversation,
  ensureDefaultNotebook,
  ensureWorkspaceReady,
  getLastUsedNotebookId,
  linkBranch,
  listConversations,
  listNotebooks,
  loadConversationBranches,
  loadNotebooks,
  wipeAll,
} from "./workspaceRepository";

beforeEach(async () => {
  await resetWorkspaceDb(`test-${Math.random().toString(36).slice(2)}`);
});

describe("workspaceRepository", () => {
  it("creates a top-level chat with a single root branch", async () => {
    const chat = await createChat({ title: "Hello" });
    const loaded = await loadConversationBranches(chat.id);
    expect(loaded.rootBranchId).toBe(chat.rootBranchId);
    expect(Object.keys(loaded.branches)).toHaveLength(1);
    expect(loaded.branches[chat.rootBranchId]?.messages).toEqual([]);
    expect(loaded.branches[chat.rootBranchId]?.anchor).toBeNull();
  });

  it("creates a chat from a notebook selection with an anchored root", async () => {
    const nb = await createNotebook("Physics");
    const chat = await createChat({
      rootAnchor: {
        sourceMessageId: `note:${nb.id}`,
        quotedText: "quantum tunnelling",
        startOffset: 0,
        endOffset: 18,
      },
    });
    const loaded = await loadConversationBranches(chat.id);
    expect(loaded.branches[chat.rootBranchId]?.anchor?.quotedText).toBe("quantum tunnelling");
  });

  it("appends messages and hydrates them on the branch", async () => {
    const chat = await createChat();
    const mid = await appendMessage({
      conversationId: chat.id,
      branchId: chat.rootBranchId,
      role: "user",
      content: "hi there",
    });
    const loaded = await loadConversationBranches(chat.id);
    expect(loaded.branches[chat.rootBranchId].messages).toHaveLength(1);
    expect(loaded.branches[chat.rootBranchId].messages[0].id).toBe(mid);
    expect(loaded.branches[chat.rootBranchId].messages[0].content).toBe("hi there");
  });

  it("appends user then assistant with stable chronological order", async () => {
    const chat = await createChat();
    const u = await appendMessage({
      conversationId: chat.id,
      branchId: chat.rootBranchId,
      role: "user",
      content: "q",
      createdAt: 2_000,
    });
    const a = await appendMessage({
      conversationId: chat.id,
      branchId: chat.rootBranchId,
      role: "assistant",
      content: "a",
      createdAt: 2_000,
    });
    const loaded = await loadConversationBranches(chat.id);
    const msgs = loaded.branches[chat.rootBranchId].messages;
    expect(msgs.map((m) => m.id)).toEqual([u, a]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].createdAt).toBeLessThan(msgs[1].createdAt);
  });

  it("creates a sub-branch under the message's parent", async () => {
    const chat = await createChat();
    const msgId = await appendMessage({
      conversationId: chat.id,
      branchId: chat.rootBranchId,
      role: "assistant",
      content: "answer text",
    });
    const subId = await createSubBranch({
      conversationId: chat.id,
      anchor: {
        sourceMessageId: msgId,
        quotedText: "answer",
        startOffset: 0,
        endOffset: 6,
      },
      spawnPosition: { x: 10, y: 10 },
    });
    const loaded = await loadConversationBranches(chat.id);
    expect(loaded.branches[subId].parentBranchId).toBe(chat.rootBranchId);
    expect(loaded.branches[subId].window?.mode).toBe("bubble");
  });

  it("appends capture HTML into a notebook and tracks last-used", async () => {
    const nb = await createNotebook("Research");
    await appendToNotebook({ notebookId: nb.id, htmlFragment: "<p>thought</p>" });
    const notebooks = await loadNotebooks();
    expect(notebooks[nb.id]?.body).toContain("thought");
    expect(await getLastUsedNotebookId()).toBe(nb.id);
  });

  it("ensureDefaultNotebook creates one on demand, then reuses it", async () => {
    const first = await ensureDefaultNotebook();
    const again = await ensureDefaultNotebook();
    expect(again.id).toBe(first.id);
    expect(await listNotebooks()).toHaveLength(1);
  });

  it("deletes a chat and its branches", async () => {
    const a = await createChat({ title: "A" });
    const b = await createChat({ title: "B" });
    await deleteConversation(a.id);
    const chats = await listConversations();
    expect(chats.some((c) => c.id === a.id)).toBe(false);
    expect(chats.some((c) => c.id === b.id)).toBe(true);
  });

  it("links a branch to a notebook", async () => {
    const nb = await createNotebook();
    await linkBranch(nb.id, "branch-1");
    const notebooks = await loadNotebooks();
    expect(notebooks[nb.id]?.linkedBranchIds).toContain("branch-1");
  });

  it("wipeAll recreates a default chat", async () => {
    await ensureWorkspaceReady();
    await createChat({ title: "extra" });
    const { conversationId } = await wipeAll();
    expect(conversationId).toBeTruthy();
    expect(await listConversations()).toHaveLength(1);
    expect(await listNotebooks()).toHaveLength(0);
  });
});
