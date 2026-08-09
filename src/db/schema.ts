import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  BranchRecord,
  ConversationRecord,
  MessageRecord,
  MetaRecord,
  NotebookAttachmentRecord,
  NotebookBranchLinkRecord,
  NotebookRecord,
} from "./types";

export class WorkspaceDB extends Dexie {
  conversations!: EntityTable<ConversationRecord, "id">;
  branches!: EntityTable<BranchRecord, "id">;
  messages!: EntityTable<MessageRecord, "id">;
  notebooks!: EntityTable<NotebookRecord, "id">;
  notebookBranchLinks!: Table<NotebookBranchLinkRecord, [string, string]>;
  notebookAttachments!: EntityTable<NotebookAttachmentRecord, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor(name = "subchat-workspace") {
    super(name);
    // Legacy v1–v3 kept so Dexie can open old DBs before the wipe upgrade.
    this.version(1).stores({
      conversations: "id, updatedAt",
      branches: "id, conversationId, parentBranchId",
      messages: "id, conversationId, branchId, createdAt",
      notebooks: "id, updatedAt",
      notes: "id, notebookId, parentNoteId, createdAt",
      conversationNotebooks: "[conversationId+notebookId], conversationId, notebookId",
      noteBranchLinks: "[noteId+branchId], noteId, branchId",
      meta: "key",
    });
    this.version(2).stores({
      conversations: "id, updatedAt",
      branches: "id, conversationId, parentBranchId",
      messages: "id, conversationId, branchId, createdAt",
      notebooks: "id, updatedAt",
      notes: "id, notebookId, parentNoteId, createdAt",
      conversationNotebooks: "[conversationId+notebookId], conversationId, notebookId",
      noteBranchLinks: "[noteId+branchId], noteId, branchId",
      noteAttachments: "id, noteId, createdAt",
      meta: "key",
    });
    this.version(3).stores({
      sessions: "id, updatedAt",
      conversations: "id, sessionId, updatedAt",
      branches: "id, conversationId, parentBranchId",
      messages: "id, conversationId, branchId, createdAt",
      notes: "id, sessionId, createdAt",
      noteBranchLinks: "[noteId+branchId], noteId, branchId",
      noteAttachments: "id, noteId, createdAt",
      meta: "key",
      notebooks: null,
      conversationNotebooks: null,
    });
    // v4 — sessions removed; chats are top-level; standalone notebooks.
    // Wipe-friendly upgrade (user-approved).
    this.version(4)
      .stores({
        conversations: "id, updatedAt",
        branches: "id, conversationId, parentBranchId",
        messages: "id, conversationId, branchId, createdAt",
        notebooks: "id, updatedAt",
        notebookBranchLinks: "[notebookId+branchId], notebookId, branchId",
        notebookAttachments: "id, notebookId, createdAt",
        meta: "key",
        // Dropped tables
        sessions: null,
        notes: null,
        noteBranchLinks: null,
        noteAttachments: null,
      })
      .upgrade(async (tx) => {
        await Promise.all([
          tx.table("conversations").clear(),
          tx.table("branches").clear(),
          tx.table("messages").clear(),
          tx.table("notebooks").clear().catch(() => undefined),
          tx.table("notebookBranchLinks").clear().catch(() => undefined),
          tx.table("notebookAttachments").clear().catch(() => undefined),
          tx.table("meta").clear(),
        ]);
      });
  }
}

let dbSingleton: WorkspaceDB | null = null;

/** Shared app database (tests may call `resetWorkspaceDb`). */
export function getWorkspaceDb(): WorkspaceDB {
  if (!dbSingleton) dbSingleton = new WorkspaceDB();
  return dbSingleton;
}

/** Close and drop the singleton so tests can use a fresh DB name. */
export async function resetWorkspaceDb(name?: string): Promise<WorkspaceDB> {
  if (dbSingleton) {
    dbSingleton.close();
    await dbSingleton.delete();
    dbSingleton = null;
  }
  dbSingleton = new WorkspaceDB(name ?? `subchat-workspace-test-${Date.now()}`);
  return dbSingleton;
}
