export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  branchId: string;
  createdAt: number;
  /** Web sources cited by the model (from the server-side web search tool). */
  citations?: Citation[];
  /** Code-execution artifacts (code run, stdout, generated files/charts). */
  artifacts?: Artifact[];
}

export interface Citation {
  url: string;
  title: string;
}

/** A piece of tool activity attached to an assistant message. */
export type Artifact =
  | { kind: "code"; code: string }
  | { kind: "output"; stdout: string; stderr: string }
  | { kind: "file"; fileId: string; filename?: string }
  | {
      /** A standard tool call (execute_code, generate_diagram, fetch_url_content, web_search). */
      kind: "tool";
      id: string;
      name: string;
      /** JSON string of the tool input as sent by the model. */
      input: string;
      /** Tool result payload (stdout / extracted text / mermaid source / results JSON). */
      output?: string;
      status: "running" | "done" | "error";
    };

/** What the model is currently doing while a response streams in. */
export type StreamPhase =
  | "thinking"
  | "searching"
  | "reading"
  | "writing"
  | "coding"
  | "running"
  | "diagramming";

export interface StreamStatus {
  phase: StreamPhase;
  /** The web search query, once known. */
  query?: string;
}

/**
 * Where a sub-chat is anchored. Follows the W3C Web Annotation
 * TextQuoteSelector model: exact quote plus prefix/suffix context, with
 * character offsets into the source message's rendered plain text as a
 * fast-path position hint.
 */
export interface Anchor {
  sourceMessageId: string; // the assistant message the selection came from
  quotedText: string; // exact selected text
  /** Sanitized HTML of the selection when captured from rendered markdown. */
  quotedHtml?: string;
  // Character offsets relative to the source message's plain-text content.
  // Store offsets (not DOM nodes) so highlights survive re-renders.
  startOffset: number;
  endOffset: number;
  /** Up to 32 chars of rendered text immediately before the quote. */
  prefix?: string;
  /** Up to 32 chars of rendered text immediately after the quote. */
  suffix?: string;
}

export type WindowMode = "bubble" | "full" | "minimized";

export interface WindowState {
  mode: WindowMode;
  // Persisted so reopening a minimized window restores it:
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  /** Mode to restore when un-minimizing (the mode it had before minimize). */
  restoreMode?: Exclude<WindowMode, "minimized">;
  /** Which margin rail a docked ("bubble" mode) card sits in. */
  railSide?: "left" | "right";
  /** User-dragged size overrides for a docked card (width px, body scroll height px). */
  railSize?: { w?: number; h?: number };
  /** User-dragged vertical offset (px) from the highlight-aligned rail position. */
  railOffsetY?: number;
}

export interface Branch {
  id: string;
  parentBranchId: string | null; // null = root/main thread
  /**
   * Selection this branch was spawned from. Null for a plain chat root;
   * a chat created from a notebook selection carries a synthetic anchor
   * (sourceMessageId = "note:<notebookId>") on its root branch.
   */
  anchor: Anchor | null;
  messages: Message[];
  window: WindowState | null; // null for root (root is the main page)
}

export interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

export type NoteSourceType = "chat" | "note";

/** Where a notebook capture came from — mirrors Anchor but works for notebook text too. */
export interface NoteAnchor {
  sourceType: NoteSourceType;
  /** Chat assistant message the selection came from. */
  sourceMessageId?: string;
  /** Source notebook when sourceType === "note". */
  sourceNoteId?: string;
  /** Chat branch that owned the source message. */
  branchId?: string;
  quotedText: string;
  /** Sanitized HTML fragment of the selection (preserves bold/lists/etc.). */
  quotedHtml?: string;
  startOffset?: number;
  endOffset?: number;
}

/** A standalone notebook: a rich-text document that captures append to. */
export interface NotebookEntry {
  id: string;
  /** User-visible notebook name. */
  title: string;
  /** Freeform editable document body (HTML). */
  body: string;
  /** Sub-chats spawned from this notebook's text. */
  linkedBranchIds: string[];
  createdAt: number;
  updatedAt: number;
}
