import { create } from "zustand";
import type { ConversationRecord } from "../db/types";
import type { Anchor } from "../types";
import * as repo from "../db/workspaceRepository";

/**
 * Ownership rules (flat chat model):
 * - Chats are top-level entities; each owns a branch tree.
 * - Notebooks are standalone documents (see notebookStore).
 * - A chat spawned from a notebook selection carries the selection anchor on
 *   its root branch.
 */
interface WorkspaceStore {
  ready: boolean;
  conversationId: string | null;
  conversations: ConversationRecord[];
  hydrate: () => Promise<void>;
  refreshLists: () => Promise<void>;
  switchConversation: (id: string) => Promise<void>;
  /** Create a new empty chat. Returns conversation id. */
  newChat: (opts?: { rootAnchor?: Anchor; title?: string }) => Promise<string>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  wipeAll: () => Promise<void>;
}

async function reloadChat(conversationId: string) {
  const { useChatStore } = await import("./chatStore");
  const { useUiStore } = await import("./uiStore");
  const data = await repo.loadConversationBranches(conversationId);
  useChatStore.setState({
    conversationId,
    branches: data.branches,
    rootBranchId: data.rootBranchId,
    topZIndex: data.topZIndex,
    streamingBranches: {},
  });
  useUiStore.getState().setSelectionAskBranch(null);
  useUiStore.getState().setActiveBranch(null);
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ready: false,
  conversationId: null,
  conversations: [],

  hydrate: async () => {
    const { conversationId } = await repo.ensureWorkspaceReady();
    await reloadChat(conversationId);
    const { useNotebookStore } = await import("./notebookStore");
    await useNotebookStore.getState().hydrate();
    const conversations = await repo.listConversations();
    set({ ready: true, conversationId, conversations });
  },

  refreshLists: async () => {
    const conversations = await repo.listConversations();
    set({ conversations });
  },

  switchConversation: async (id) => {
    const conv = await repo.getConversation(id);
    if (!conv) return;
    await repo.setActiveConversation(id);
    await reloadChat(id);
    set({ conversationId: id });
    await get().refreshLists();
  },

  newChat: async (opts) => {
    const conversation = await repo.createChat({
      title: opts?.title,
      rootAnchor: opts?.rootAnchor ?? null,
    });
    await reloadChat(conversation.id);
    set({ conversationId: conversation.id });
    await get().refreshLists();
    return conversation.id;
  },

  renameConversation: async (id, title) => {
    await repo.renameConversation(id, title);
    await get().refreshLists();
  },

  deleteConversation: async (id) => {
    await repo.deleteConversation(id);
    const remaining = await repo.listConversations();
    if (remaining[0]) {
      await get().switchConversation(remaining[0].id);
    } else {
      const created = await repo.createChat({ title: "New chat" });
      await reloadChat(created.id);
      set({ conversationId: created.id });
    }
    await get().refreshLists();
  },

  wipeAll: async () => {
    const { conversationId } = await repo.wipeAll();
    await reloadChat(conversationId);
    const { useNotebookStore } = await import("./notebookStore");
    await useNotebookStore.getState().hydrate();
    set({ conversationId });
    await get().refreshLists();
  },
}));
