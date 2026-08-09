import { newId } from "../lib/id";
import type {
  Anchor,
  Artifact,
  Branch,
  Citation,
  Message,
  NotebookEntry,
  WindowMode,
  WindowState,
} from "../types";
import { getWorkspaceDb, type WorkspaceDB } from "./schema";
import type {
  BranchRecord,
  ConversationRecord,
  MessageRecord,
  NotebookRecord,
} from "./types";
import { META_ACTIVE_CONVERSATION, META_LAST_NOTEBOOK, META_TOP_Z } from "./types";
import {
  SUBCHAT_DEFAULT_BUBBLE,
  SUBCHAT_DEFAULT_FULL,
  clampRailSize,
  clampSubChatSize,
  clampWindowStateSize,
} from "../lib/subChatLayout";

const BUBBLE_SIZE = { ...SUBCHAT_DEFAULT_BUBBLE };
const FULL_SIZE = { ...SUBCHAT_DEFAULT_FULL };
const DEFAULT_NOTEBOOK_TITLE = "My Notebook";
const DEFAULT_NOTEBOOK_BODY = "<h1>My Notebook</h1><p><br></p>";

function db(): WorkspaceDB {
  return getWorkspaceDb();
}

async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db().meta.get(key);
  return row ? (row.value as T) : fallback;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

function titleFromFirstUserMessage(content: string): string {
  const t = content.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? t.slice(0, 47) + "…" : t;
}

function branchFromRecords(branch: BranchRecord, messages: MessageRecord[]): Branch {
  return {
    id: branch.id,
    parentBranchId: branch.parentBranchId,
    anchor: branch.anchor,
    window: branch.window ? clampWindowStateSize(branch.window) : null,
    messages: messages
      .slice()
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        if (a.role !== b.role) return a.role === "user" ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .map(
        (m): Message => ({
          id: m.id,
          role: m.role,
          content: m.content,
          branchId: m.branchId,
          createdAt: m.createdAt,
          citations: m.citations,
          artifacts: m.artifacts,
        }),
      ),
  };
}

function notebookFromRecord(row: NotebookRecord, linkedBranchIds: string[]): NotebookEntry {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    linkedBranchIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function collectBranchSubtreeIds(
  conversationId: string,
  branchId: string,
): Promise<string[]> {
  const all = await db().branches.where("conversationId").equals(conversationId).toArray();
  const byParent = new Map<string | null, string[]>();
  for (const b of all) {
    const list = byParent.get(b.parentBranchId) ?? [];
    list.push(b.id);
    byParent.set(b.parentBranchId, list);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of byParent.get(id) ?? []) walk(child);
  };
  walk(branchId);
  return out;
}

/** Always dock as bubble; UI floats when the parent has no visible rail. */
function dockOrFloatWindow(
  dockedOnParent: BranchRecord[],
  spawnPosition: { x: number; y: number },
  zIndex: number,
): WindowState {
  const docked = dockedOnParent.filter((b) => b.window?.mode === "bubble");
  const leftCount = docked.filter((b) => (b.window?.railSide ?? "right") === "left").length;
  const railSide: "left" | "right" = leftCount < docked.length - leftCount ? "left" : "right";
  return { mode: "bubble", position: spawnPosition, size: { ...BUBBLE_SIZE }, zIndex, railSide };
}

// ---- Chats (top-level conversations) --------------------------------------

export async function listConversations(): Promise<ConversationRecord[]> {
  const rows = await db().conversations.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  return db().conversations.get(id);
}

export async function getActiveConversationId(): Promise<string | null> {
  return getMeta<string | null>(META_ACTIVE_CONVERSATION, null);
}

export async function setActiveConversation(id: string | null): Promise<void> {
  await setMeta(META_ACTIVE_CONVERSATION, id);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  await db().conversations.update(id, { title, updatedAt: Date.now() });
}

export async function touchConversation(id: string): Promise<void> {
  await db().conversations.update(id, { updatedAt: Date.now() });
}

/**
 * Create a new top-level chat. When `rootAnchor` is provided (chat spawned
 * from a notebook selection), the root branch carries that anchor so context
 * assembly injects the quoted excerpt.
 */
export async function createChat(opts?: {
  title?: string;
  rootAnchor?: Anchor | null;
  id?: string;
  rootBranchId?: string;
}): Promise<ConversationRecord> {
  const now = Date.now();
  const conversationId = opts?.id ?? newId();
  const rootId = opts?.rootBranchId ?? newId();
  const conversation: ConversationRecord = {
    id: conversationId,
    title: opts?.title ?? "New chat",
    rootBranchId: rootId,
    createdAt: now,
    updatedAt: now,
  };

  await db().transaction("rw", [db().conversations, db().branches, db().meta], async () => {
    await db().conversations.add(conversation);
    await db().branches.add({
      id: rootId,
      conversationId,
      parentBranchId: null,
      anchor: opts?.rootAnchor ?? null,
      window: null,
      createdAt: now,
      updatedAt: now,
    });
    await setMeta(META_ACTIVE_CONVERSATION, conversationId);
    const z = await getMeta(META_TOP_Z, 10);
    if (z < 10) await setMeta(META_TOP_Z, 10);
  });

  return conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await db().transaction(
    "rw",
    [db().conversations, db().branches, db().messages, db().notebookBranchLinks, db().meta],
    async () => {
      const branchIds = (
        await db().branches.where("conversationId").equals(id).primaryKeys()
      ) as string[];
      await db().messages.where("conversationId").equals(id).delete();
      await db().branches.where("conversationId").equals(id).delete();
      for (const branchId of branchIds) {
        await db().notebookBranchLinks.where("branchId").equals(branchId).delete();
      }
      await db().conversations.delete(id);

      const active = await getMeta<string | null>(META_ACTIVE_CONVERSATION, null);
      if (active === id) {
        const remaining = await db().conversations.toArray();
        remaining.sort((a, b) => b.updatedAt - a.updatedAt);
        await setMeta(META_ACTIVE_CONVERSATION, remaining[0]?.id ?? null);
      }
    },
  );
}

// ---- Hydration -----------------------------------------------------------

export async function loadConversationBranches(conversationId: string): Promise<{
  branches: Record<string, Branch>;
  rootBranchId: string;
  topZIndex: number;
}> {
  const conv = await db().conversations.get(conversationId);
  if (!conv) throw new Error(`Conversation not found: ${conversationId}`);
  const branchRows = await db().branches.where("conversationId").equals(conversationId).toArray();
  const messageRows = await db().messages.where("conversationId").equals(conversationId).toArray();
  const byBranch = new Map<string, MessageRecord[]>();
  for (const m of messageRows) {
    const list = byBranch.get(m.branchId) ?? [];
    list.push(m);
    byBranch.set(m.branchId, list);
  }
  const branches: Record<string, Branch> = {};
  for (const b of branchRows) {
    branches[b.id] = branchFromRecords(b, byBranch.get(b.id) ?? []);
  }
  const topZIndex = await getMeta(META_TOP_Z, 10);
  return { branches, rootBranchId: conv.rootBranchId, topZIndex };
}

// ---- Branch / message writes ---------------------------------------------

export async function createSubBranch(opts: {
  conversationId: string;
  anchor: Anchor;
  spawnPosition: { x: number; y: number };
  id?: string;
}): Promise<string> {
  const conv = await db().conversations.get(opts.conversationId);
  if (!conv) throw new Error("Conversation not found");
  const id = opts.id ?? newId();
  const now = Date.now();
  const zIndex = (await getMeta(META_TOP_Z, 10)) + 1;

  await db().transaction("rw", db().branches, db().messages, db().conversations, db().meta, async () => {
    const all = await db().branches.where("conversationId").equals(opts.conversationId).toArray();
    const msgs = await db().messages.where("conversationId").equals(opts.conversationId).toArray();
    const parentMsg = msgs.find((m) => m.id === opts.anchor.sourceMessageId);
    const parentId = parentMsg?.branchId ?? conv.rootBranchId;
    const siblings = all.filter((b) => b.parentBranchId === parentId);
    const window = dockOrFloatWindow(siblings, opts.spawnPosition, zIndex);
    await db().branches.add({
      id,
      conversationId: opts.conversationId,
      parentBranchId: parentId,
      anchor: opts.anchor,
      window,
      createdAt: now,
      updatedAt: now,
    });
    await setMeta(META_TOP_Z, zIndex);
    await db().conversations.update(opts.conversationId, { updatedAt: now });
  });
  return id;
}

export async function appendMessage(opts: {
  conversationId: string;
  branchId: string;
  role: Message["role"];
  content: string;
  id?: string;
  createdAt?: number;
}): Promise<string> {
  const id = opts.id ?? newId();
  let now = opts.createdAt ?? Date.now();
  await db().transaction("rw", db().messages, db().conversations, async () => {
    const existing = await db().messages.where("branchId").equals(opts.branchId).toArray();
    const maxAt = existing.reduce((m, row) => Math.max(m, row.createdAt), 0);
    if (now <= maxAt) now = maxAt + 1;
    await db().messages.add({
      id,
      conversationId: opts.conversationId,
      branchId: opts.branchId,
      role: opts.role,
      content: opts.content,
      createdAt: now,
    });
    const patch: Partial<ConversationRecord> = { updatedAt: now };
    if (opts.role === "user") {
      const conv = await db().conversations.get(opts.conversationId);
      if (conv && (conv.title === "Ask" || conv.title === "New chat" || !conv.title)) {
        patch.title = titleFromFirstUserMessage(opts.content);
      }
    }
    await db().conversations.update(opts.conversationId, patch);
  });
  return id;
}

export async function appendStreamDelta(messageId: string, text: string): Promise<void> {
  const msg = await db().messages.get(messageId);
  if (!msg) return;
  await db().messages.update(messageId, { content: msg.content + text });
}

export async function addCitation(messageId: string, citation: Citation): Promise<void> {
  const msg = await db().messages.get(messageId);
  if (!msg) return;
  const existing = msg.citations ?? [];
  if (existing.some((c) => c.url === citation.url)) return;
  await db().messages.update(messageId, { citations: [...existing, citation] });
}

export async function addArtifact(messageId: string, artifact: Artifact): Promise<void> {
  const msg = await db().messages.get(messageId);
  if (!msg) return;
  await db().messages.update(messageId, {
    artifacts: [...(msg.artifacts ?? []), artifact],
  });
}

/** Patch a tool artifact (matched by tool call id) with output/status. */
export async function updateToolArtifact(
  messageId: string,
  toolId: string,
  patch: { output?: string; status?: "running" | "done" | "error"; input?: string },
): Promise<void> {
  const msg = await db().messages.get(messageId);
  if (!msg) return;
  const artifacts = (msg.artifacts ?? []).map((a) =>
    a.kind === "tool" && a.id === toolId ? { ...a, ...patch } : a,
  );
  await db().messages.update(messageId, { artifacts });
}

export async function truncateBranchFromMessage(
  conversationId: string,
  branchId: string,
  messageId: string,
): Promise<void> {
  await db().transaction(
    "rw",
    db().messages,
    db().branches,
    db().notebookBranchLinks,
    db().conversations,
    async () => {
      const msgs = await db().messages.where("branchId").equals(branchId).sortBy("createdAt");
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const keepIds = new Set(msgs.slice(0, idx + 1).map((m) => m.id));
      const removedIds = msgs.slice(idx + 1).map((m) => m.id);
      for (const id of removedIds) {
        await db().messages.delete(id);
      }

      const allBranches = await db()
        .branches.where("conversationId")
        .equals(conversationId)
        .toArray();
      const orphanRoots = allBranches.filter(
        (b) => b.anchor?.sourceMessageId && removedIds.includes(b.anchor.sourceMessageId),
      );
      for (const orphan of orphanRoots) {
        const doomed = await collectBranchSubtreeIds(conversationId, orphan.id);
        for (const id of doomed) {
          await db().messages.where("branchId").equals(id).delete();
          await db().notebookBranchLinks.where("branchId").equals(id).delete();
          await db().branches.delete(id);
        }
      }

      const remaining = await db()
        .branches.where("conversationId")
        .equals(conversationId)
        .toArray();
      for (const b of remaining) {
        const src = b.anchor?.sourceMessageId;
        if (src && !keepIds.has(src) && !src.startsWith("note:")) {
          const still = await db().messages.get(src);
          if (!still) {
            const doomed = await collectBranchSubtreeIds(conversationId, b.id);
            for (const id of doomed) {
              await db().messages.where("branchId").equals(id).delete();
              await db().notebookBranchLinks.where("branchId").equals(id).delete();
              await db().branches.delete(id);
            }
          }
        }
      }

      await db().conversations.update(conversationId, { updatedAt: Date.now() });
    },
  );
}

export async function updateUserMessage(messageId: string, content: string): Promise<void> {
  const msg = await db().messages.get(messageId);
  if (!msg || msg.role !== "user") return;
  await db().messages.update(messageId, { content });
  await db().conversations.update(msg.conversationId, { updatedAt: Date.now() });
}

export async function updateBranchWindow(branchId: string, window: WindowState): Promise<void> {
  await db().branches.update(branchId, { window, updatedAt: Date.now() });
}

/** Persist updated selection context on a subchat (API context only; not shown in composer). */
export async function updateBranchAnchor(branchId: string, anchor: Anchor): Promise<void> {
  await db().branches.update(branchId, { anchor, updatedAt: Date.now() });
}

export async function focusWindow(branchId: string): Promise<number> {
  const zIndex = (await getMeta(META_TOP_Z, 10)) + 1;
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return zIndex - 1;
  if (branch.window.zIndex === zIndex - 1) return branch.window.zIndex;
  await db().transaction("rw", db().branches, db().meta, async () => {
    await db().branches.update(branchId, {
      window: { ...branch.window!, zIndex },
      updatedAt: Date.now(),
    });
    await setMeta(META_TOP_Z, zIndex);
  });
  return zIndex;
}

export async function setWindowMode(
  branchId: string,
  mode: WindowMode,
): Promise<WindowState | null> {
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return null;
  const prev = branch.window;
  let { size } = prev;
  if (mode === "full" && prev.mode === "bubble") {
    size = clampSubChatSize({
      width: Math.max(size.width, FULL_SIZE.width),
      height: Math.max(size.height, FULL_SIZE.height),
    });
  }
  const restoreMode =
    mode === "minimized"
      ? prev.mode === "minimized"
        ? prev.restoreMode
        : prev.mode
      : undefined;
  const next: WindowState = { ...prev, mode, size, restoreMode };
  await db().branches.update(branchId, { window: next, updatedAt: Date.now() });
  return next;
}

export async function setRailSide(branchId: string, side: "left" | "right"): Promise<void> {
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return;
  await db().branches.update(branchId, {
    window: { ...branch.window, railSide: side },
    updatedAt: Date.now(),
  });
}

export async function setRailSize(
  branchId: string,
  size: { w?: number; h?: number } | null,
): Promise<void> {
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return;
  const railSize =
    size === null ? undefined : clampRailSize({ ...branch.window.railSize, ...size });
  await db().branches.update(branchId, {
    window: { ...branch.window, railSize },
    updatedAt: Date.now(),
  });
}

export async function setRailOffsetY(branchId: string, offsetY: number | null): Promise<void> {
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return;
  const railOffsetY =
    offsetY == null || !Number.isFinite(offsetY) ? undefined : Math.round(offsetY);
  await db().branches.update(branchId, {
    window: { ...branch.window, railOffsetY },
    updatedAt: Date.now(),
  });
}

export async function setWindowRect(
  branchId: string,
  rect: Partial<{ position: { x: number; y: number }; size: { width: number; height: number } }>,
): Promise<void> {
  const branch = await db().branches.get(branchId);
  if (!branch?.window) return;
  const next = { ...branch.window, ...rect };
  if (rect.size) next.size = clampSubChatSize(rect.size);
  await db().branches.update(branchId, { window: next, updatedAt: Date.now() });
}

export async function deleteBranch(conversationId: string, branchId: string): Promise<string[]> {
  const conv = await db().conversations.get(conversationId);
  if (!conv) return [];
  if (branchId === conv.rootBranchId) return [];
  const doomed = await collectBranchSubtreeIds(conversationId, branchId);
  await db().transaction(
    "rw",
    db().branches,
    db().messages,
    db().notebookBranchLinks,
    db().conversations,
    async () => {
      for (const id of doomed) {
        await db().messages.where("branchId").equals(id).delete();
        await db().notebookBranchLinks.where("branchId").equals(id).delete();
        await db().branches.delete(id);
      }
      await db().conversations.update(conversationId, { updatedAt: Date.now() });
    },
  );
  return doomed;
}

// ---- Notebooks -------------------------------------------------------------

export async function listNotebooks(): Promise<NotebookRecord[]> {
  const rows = await db().notebooks.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id: string): Promise<NotebookRecord | undefined> {
  return db().notebooks.get(id);
}

export async function loadNotebooks(): Promise<Record<string, NotebookEntry>> {
  const rows = await db().notebooks.toArray();
  const entries: Record<string, NotebookEntry> = {};
  for (const n of rows) {
    const links = await db().notebookBranchLinks.where("notebookId").equals(n.id).toArray();
    entries[n.id] = notebookFromRecord(
      n,
      links.map((l) => l.branchId),
    );
  }
  return entries;
}

export async function createNotebook(
  title = DEFAULT_NOTEBOOK_TITLE,
  opts?: { id?: string; body?: string },
): Promise<NotebookRecord> {
  const now = Date.now();
  const record: NotebookRecord = {
    id: opts?.id ?? newId(),
    title,
    body: opts?.body ?? `<h1>${title.replace(/</g, "&lt;")}</h1><p><br></p>`,
    createdAt: now,
    updatedAt: now,
  };
  await db().transaction("rw", db().notebooks, db().meta, async () => {
    await db().notebooks.add(record);
    await setMeta(META_LAST_NOTEBOOK, record.id);
  });
  return record;
}

export async function renameNotebook(id: string, title: string): Promise<void> {
  await db().notebooks.update(id, { title, updatedAt: Date.now() });
}

export async function deleteNotebook(id: string): Promise<void> {
  await db().transaction(
    "rw",
    [db().notebooks, db().notebookBranchLinks, db().notebookAttachments, db().meta],
    async () => {
      await db().notebookBranchLinks.where("notebookId").equals(id).delete();
      await db().notebookAttachments.where("notebookId").equals(id).delete();
      await db().notebooks.delete(id);
      const last = await getMeta<string | null>(META_LAST_NOTEBOOK, null);
      if (last === id) {
        const remaining = await listNotebooks();
        await setMeta(META_LAST_NOTEBOOK, remaining[0]?.id ?? null);
      }
    },
  );
}

export async function updateNotebookBody(id: string, body: string): Promise<void> {
  await db().notebooks.update(id, { body, updatedAt: Date.now() });
}

export async function appendToNotebook(opts: {
  notebookId: string;
  htmlFragment: string;
}): Promise<void> {
  const notebook = await db().notebooks.get(opts.notebookId);
  if (!notebook) throw new Error(`Notebook not found: ${opts.notebookId}`);
  await db().notebooks.update(opts.notebookId, {
    body: `${notebook.body}${opts.htmlFragment}`,
    updatedAt: Date.now(),
  });
}

export async function getLastUsedNotebookId(): Promise<string | null> {
  return getMeta<string | null>(META_LAST_NOTEBOOK, null);
}

export async function setLastUsedNotebookId(id: string | null): Promise<void> {
  await setMeta(META_LAST_NOTEBOOK, id);
}

/** Resolve (or create) the capture target: last-used notebook or a fresh default. */
export async function ensureDefaultNotebook(): Promise<NotebookRecord> {
  const lastId = await getLastUsedNotebookId();
  if (lastId) {
    const existing = await db().notebooks.get(lastId);
    if (existing) return existing;
  }
  const all = await listNotebooks();
  if (all[0]) {
    await setLastUsedNotebookId(all[0].id);
    return all[0];
  }
  return createNotebook(DEFAULT_NOTEBOOK_TITLE, { body: DEFAULT_NOTEBOOK_BODY });
}

export async function linkBranch(notebookId: string, branchId: string): Promise<void> {
  await db().notebookBranchLinks.put({ notebookId, branchId });
  await db().notebooks.update(notebookId, { updatedAt: Date.now() });
}

export async function unlinkBranch(notebookId: string, branchId: string): Promise<void> {
  await db().notebookBranchLinks.delete([notebookId, branchId]);
  await db().notebooks.update(notebookId, { updatedAt: Date.now() });
}

// ---- Notebook attachments ----------------------------------------------------

export async function addNoteAttachment(opts: {
  id: string;
  notebookId: string;
  mimeType: string;
  blob: Blob;
}): Promise<void> {
  await db().notebookAttachments.put({
    id: opts.id,
    notebookId: opts.notebookId,
    mimeType: opts.mimeType,
    blob: opts.blob,
    createdAt: Date.now(),
  });
  await db().notebooks.update(opts.notebookId, { updatedAt: Date.now() });
}

export async function getNoteAttachments(
  notebookId: string,
): Promise<{ id: string; mimeType: string; blob: Blob }[]> {
  const rows = await db().notebookAttachments.where("notebookId").equals(notebookId).toArray();
  return rows.map((r) => ({ id: r.id, mimeType: r.mimeType, blob: r.blob }));
}

export async function countNoteAttachments(notebookId: string): Promise<number> {
  return db().notebookAttachments.where("notebookId").equals(notebookId).count();
}

export async function deleteNoteAttachment(id: string): Promise<void> {
  const row = await db().notebookAttachments.get(id);
  await db().notebookAttachments.delete(id);
  if (row) await db().notebooks.update(row.notebookId, { updatedAt: Date.now() });
}

// ---- Bootstrap / wipe / export -------------------------------------------

export async function ensureWorkspaceReady(): Promise<{ conversationId: string }> {
  const count = await db().conversations.count();
  if (count === 0) {
    const conversation = await createChat({ title: "New chat" });
    return { conversationId: conversation.id };
  }
  let conversationId = await getActiveConversationId();
  if (!conversationId || !(await db().conversations.get(conversationId))) {
    const list = await listConversations();
    conversationId = list[0]!.id;
    await setActiveConversation(conversationId);
  }
  return { conversationId };
}

export async function wipeAll(): Promise<{ conversationId: string }> {
  const d = db();
  await d.transaction(
    "rw",
    [
      d.conversations,
      d.branches,
      d.messages,
      d.notebooks,
      d.notebookBranchLinks,
      d.notebookAttachments,
      d.meta,
    ],
    async () => {
      await Promise.all([
        d.conversations.clear(),
        d.branches.clear(),
        d.messages.clear(),
        d.notebooks.clear(),
        d.notebookBranchLinks.clear(),
        d.notebookAttachments.clear(),
        d.meta.clear(),
      ]);
    },
  );
  await setMeta(META_TOP_Z, 10);
  return ensureWorkspaceReady();
}

export async function exportWorkspace(): Promise<object> {
  return {
    version: 4,
    conversations: await db().conversations.toArray(),
    branches: await db().branches.toArray(),
    messages: await db().messages.toArray(),
    notebooks: await db().notebooks.toArray(),
    notebookBranchLinks: await db().notebookBranchLinks.toArray(),
    meta: await db().meta.toArray(),
  };
}

export async function importWorkspace(data: {
  conversations?: ConversationRecord[];
  branches?: BranchRecord[];
  messages?: MessageRecord[];
  notebooks?: NotebookRecord[];
  notebookBranchLinks?: { notebookId: string; branchId: string }[];
  meta?: { key: string; value: unknown }[];
}): Promise<void> {
  await wipeAll();
  const d = db();
  await d.transaction(
    "rw",
    [d.conversations, d.branches, d.messages, d.notebooks, d.notebookBranchLinks, d.meta],
    async () => {
      await Promise.all([
        d.conversations.clear(),
        d.branches.clear(),
        d.messages.clear(),
        d.notebooks.clear(),
        d.notebookBranchLinks.clear(),
        d.meta.clear(),
      ]);
      if (data.conversations?.length) await d.conversations.bulkAdd(data.conversations);
      if (data.branches?.length) await d.branches.bulkAdd(data.branches);
      if (data.messages?.length) await d.messages.bulkAdd(data.messages);
      if (data.notebooks?.length) await d.notebooks.bulkAdd(data.notebooks);
      if (data.notebookBranchLinks?.length) {
        await d.notebookBranchLinks.bulkAdd(data.notebookBranchLinks);
      }
      if (data.meta?.length) await d.meta.bulkAdd(data.meta);
    },
  );
}
