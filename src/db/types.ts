import type { Anchor, Artifact, Citation, Message, WindowState } from "../types";

/** A top-level chat (conversation). Each chat owns a branch tree. */
export interface ConversationRecord {
  id: string;
  title: string;
  rootBranchId: string;
  createdAt: number;
  updatedAt: number;
}

/** Branch shell without embedded messages (messages live in their own table). */
export interface BranchRecord {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  anchor: Anchor | null;
  window: WindowState | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  branchId: string;
  role: Message["role"];
  content: string;
  citations?: Citation[];
  artifacts?: Artifact[];
  createdAt: number;
}

/** A standalone notebook document. */
export interface NotebookRecord {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookBranchLinkRecord {
  notebookId: string;
  branchId: string;
}

/** Binary image (or other) attachment for a notebook body `<img data-attachment-id>`. */
export interface NotebookAttachmentRecord {
  id: string;
  notebookId: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export const META_ACTIVE_CONVERSATION = "activeConversationId";
export const META_LAST_NOTEBOOK = "lastUsedNotebookId";
export const META_TOP_Z = "topZIndex";
