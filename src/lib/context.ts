import type { ApiMessage, Branch } from "../types";

/**
 * Walk parentBranchId links from `branchId` up to the root and return the
 * chain ordered root-first.
 */
export function branchChain(branches: Record<string, Branch>, branchId: string): Branch[] {
  const chain: Branch[] = [];
  let current: Branch | undefined = branches[branchId];
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break; // guard against cycles in corrupted data
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentBranchId ? branches[current.parentBranchId] : undefined;
  }
  return chain;
}

export function anchorBlock(quotedText: string): string {
  return `Regarding this excerpt from your earlier response: "${quotedText}" —`;
}

/** Marker injected where ancestor history was dropped to fit the budget. */
export const TRUNCATION_MARKER = "[earlier discussion truncated to fit the context window]";

/**
 * Character budgets by provider. Local models have small context windows;
 * chars ≈ 4 × tokens, so 24k chars ≈ 6k tokens of history.
 */
export function contextBudgetChars(provider: string): number {
  return provider === "local" ? 24_000 : 240_000;
}

/** Middle-truncate a long message body, keeping its head and tail. */
function middleTruncate(content: string, keep: number): string {
  if (content.length <= keep) return content;
  const head = Math.ceil(keep * 0.7);
  const tail = keep - head;
  return `${content.slice(0, head)}\n…[snip]…\n${content.slice(content.length - tail)}`;
}

interface RawItem {
  role: "user" | "assistant";
  content: string;
  /** Target-branch messages and anchor blocks are never truncated. */
  protectedItem: boolean;
}

/**
 * The Q/A turn in `branch` that contains `sourceMessageId`: the anchored
 * message plus the nearest preceding user prompt. Empty for notebook anchors
 * (`note:` ids) or when the source message is gone.
 */
function sourceTurn(
  branch: Branch,
  sourceMessageId: string | undefined,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!sourceMessageId || sourceMessageId.startsWith("note:")) return [];
  const msgs = branch.messages;
  const idx = msgs.findIndex((m) => m.id === sourceMessageId);
  if (idx < 0) return [];
  const turn: Array<{ role: "user" | "assistant"; content: string }> = [];
  let u = idx - 1;
  while (u >= 0 && msgs[u].role !== "user") u--;
  if (u >= 0) turn.push({ role: "user", content: msgs[u].content });
  turn.push({ role: msgs[idx].role, content: msgs[idx].content });
  return turn;
}

/**
 * Strict sub-chat isolation: an anchored branch inherits only, per ancestor,
 * the Q/A turn containing that level's anchor source message plus the anchor
 * block — never the full ancestor transcript. Root chats send everything.
 */
function assembleRaw(branches: Record<string, Branch>, branchId: string): RawItem[] {
  const chain = branchChain(branches, branchId);
  const target = chain[chain.length - 1];
  const raw: RawItem[] = [];

  // Plain root chat: the full transcript, unchanged.
  if (chain.length === 1 && !target.anchor) {
    for (const m of target.messages) {
      raw.push({ role: m.role, content: m.content, protectedItem: true });
    }
    return raw;
  }

  for (let i = 0; i + 1 < chain.length; i++) {
    const child = chain[i + 1];
    for (const m of sourceTurn(chain[i], child.anchor?.sourceMessageId)) {
      raw.push({ role: m.role, content: m.content, protectedItem: false });
    }
    if (child.anchor) {
      raw.push({
        role: "user",
        content: anchorBlock(child.anchor.quotedText),
        protectedItem: true,
      });
    }
  }

  // Anchored root (chat spawned from a notebook selection): its own anchor.
  if (chain.length === 1 && target.anchor) {
    raw.push({
      role: "user",
      content: anchorBlock(target.anchor.quotedText),
      protectedItem: true,
    });
  }

  for (const m of target.messages) {
    raw.push({ role: m.role, content: m.content, protectedItem: true });
  }
  return raw;
}

/**
 * Enforce the char budget: ancestor messages are middle-truncated oldest-first,
 * then dropped entirely (oldest-first) with a truncation marker if still over.
 * Target-branch messages and anchor blocks are always kept verbatim.
 */
function applyBudget(raw: RawItem[], budgetChars: number): RawItem[] {
  const total = () => raw.reduce((n, it) => n + it.content.length, 0);
  if (total() <= budgetChars) return raw;

  const TRUNCATED_KEEP = 600;
  // Pass 1: middle-truncate unprotected items, oldest first.
  for (const item of raw) {
    if (total() <= budgetChars) break;
    if (item.protectedItem || item.content.length <= TRUNCATED_KEEP) continue;
    item.content = middleTruncate(item.content, TRUNCATED_KEEP);
  }
  if (total() <= budgetChars) return raw;

  // Pass 2: drop unprotected items oldest-first, marking the gap once.
  const out: RawItem[] = [];
  let dropped = false;
  let remaining = total();
  for (const item of raw) {
    if (!item.protectedItem && remaining > budgetChars) {
      remaining -= item.content.length;
      dropped = true;
      continue;
    }
    out.push(item);
  }
  if (dropped) {
    out.unshift({ role: "user", content: TRUNCATION_MARKER, protectedItem: true });
  }
  return out;
}

/**
 * Assemble the provider `messages` array for a branch: ancestor messages
 * root-first, each branch's anchor injected as a user block before that
 * branch's own messages, budget applied, then merged so roles strictly
 * alternate (providers require user/assistant alternation starting with user).
 */
export function buildApiMessages(
  branches: Record<string, Branch>,
  branchId: string,
  opts?: { budgetChars?: number },
): ApiMessage[] {
  const raw = applyBudget(
    assembleRaw(branches, branchId),
    opts?.budgetChars ?? Number.POSITIVE_INFINITY,
  );

  // Merge consecutive same-role messages and drop empty ones.
  const merged: ApiMessage[] = [];
  for (const msg of raw) {
    const content = msg.content.trim();
    if (!content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + content;
    } else {
      merged.push({ role: msg.role, content });
    }
  }

  // The conversation must start with a user message.
  if (merged.length > 0 && merged[0].role === "assistant") {
    merged.unshift({ role: "user", content: "(conversation begins)" });
  }

  return merged;
}

/** How much source-message context to include around the anchored quote. */
const SURROUND_CHARS = 400;

/**
 * Build the per-thread system prompt block for an anchored sub-chat: the
 * highlighted text plus the surrounding passage of the parent message.
 * Returns undefined for plain root chats without an anchor.
 */
export function buildSystemContext(
  branches: Record<string, Branch>,
  branchId: string,
): string | undefined {
  const branch = branches[branchId];
  const anchor = branch?.anchor;
  if (!anchor) return undefined;

  const lines: string[] = [
    "This thread is a focused follow-up anchored to a highlighted excerpt of an earlier assistant response. Answer about this excerpt specifically; the wider conversation is provided in the messages.",
    `Highlighted excerpt: "${anchor.quotedText}"`,
  ];

  // Surrounding passage from the source message (or prefix/suffix fallback).
  let surrounding = "";
  for (const b of Object.values(branches)) {
    const src = b.messages.find((m) => m.id === anchor.sourceMessageId);
    if (src) {
      const start = Math.max(0, (anchor.startOffset ?? 0) - SURROUND_CHARS);
      const end = Math.min(src.content.length, (anchor.endOffset ?? 0) + SURROUND_CHARS);
      surrounding = src.content.slice(start, end);
      break;
    }
  }
  if (!surrounding && (anchor.prefix || anchor.suffix)) {
    surrounding = `${anchor.prefix ?? ""}${anchor.quotedText}${anchor.suffix ?? ""}`;
  }
  if (surrounding) {
    lines.push(`Surrounding passage: …${surrounding}…`);
  }
  return lines.join("\n");
}

/** One assembled API message, annotated with where its content came from. */
export interface ContextItem {
  role: "user" | "assistant";
  /** Origins folded into this message (merging can combine several). */
  origins: string[];
  /** Single-line truncated preview of the content. */
  preview: string;
  chars: number;
}

export interface ContextDescription {
  items: ContextItem[];
  messageCount: number;
  totalChars: number;
  /** Ancestor branches above this one (root = depth 1 for a rail card). */
  chainDepth: number;
  /** Raw messages inherited from ancestor branches (incl. their anchors). */
  inheritedCount: number;
  /** Whether this branch injects its own anchored quote. */
  hasAnchor: boolean;
  /** This branch's own messages. */
  ownCount: number;
}

/**
 * Mirror of buildApiMessages that annotates each assembled message with its
 * origin (root / parent / ancestor / anchor / this chat), for the per-sub-chat
 * context inspector.
 */
export function describeContext(
  branches: Record<string, Branch>,
  branchId: string,
): ContextDescription {
  const chain = branchChain(branches, branchId);
  const target = chain[chain.length - 1];

  const raw: { role: "user" | "assistant"; content: string; origin: string }[] = [];
  let inheritedCount = 0;
  let ownCount = 0;

  if (chain.length === 1 && !target.anchor) {
    // Plain root chat: everything is its own.
    for (const m of target.messages) {
      if (!m.content.trim()) continue;
      raw.push({ role: m.role, content: m.content, origin: "this chat" });
      ownCount++;
    }
  } else {
    // Strict sub-chat assembly — mirrors assembleRaw exactly.
    for (let i = 0; i + 1 < chain.length; i++) {
      const child = chain[i + 1];
      const ancestorDistance = chain.length - 1 - i;
      const ancestorLabel =
        i === 0 ? "root" : ancestorDistance === 1 ? "parent" : "ancestor";
      for (const m of sourceTurn(chain[i], child.anchor?.sourceMessageId)) {
        if (!m.content.trim()) continue;
        raw.push({
          role: m.role,
          content: m.content,
          origin: `source turn (${ancestorLabel})`,
        });
        inheritedCount++;
      }
      if (child.anchor) {
        const childDistance = chain.length - 1 - (i + 1);
        const childLabel = childDistance === 1 ? "parent" : "ancestor";
        raw.push({
          role: "user",
          content: anchorBlock(child.anchor.quotedText),
          origin: childDistance === 0 ? "anchor" : `anchor (${childLabel})`,
        });
        if (childDistance !== 0) inheritedCount++;
      }
    }
    if (chain.length === 1 && target.anchor) {
      raw.push({
        role: "user",
        content: anchorBlock(target.anchor.quotedText),
        origin: "anchor",
      });
    }
    for (const m of target.messages) {
      if (!m.content.trim()) continue;
      raw.push({ role: m.role, content: m.content, origin: "this chat" });
      ownCount++;
    }
  }

  // Merge exactly like buildApiMessages so counts/chars match what is sent.
  const items: ContextItem[] = [];
  for (const msg of raw) {
    const content = msg.content.trim();
    if (!content) continue;
    const last = items[items.length - 1];
    if (last && last.role === msg.role) {
      last.chars += content.length + 2; // "\n\n" joiner
      if (!last.origins.includes(msg.origin)) last.origins.push(msg.origin);
    } else {
      items.push({
        role: msg.role,
        origins: [msg.origin],
        preview: oneLinePreview(content),
        chars: content.length,
      });
    }
  }
  if (items.length > 0 && items[0].role === "assistant") {
    items.unshift({
      role: "user",
      origins: ["padding"],
      preview: "(conversation begins)",
      chars: "(conversation begins)".length,
    });
  }

  return {
    items,
    messageCount: items.length,
    totalChars: items.reduce((n, it) => n + it.chars, 0),
    chainDepth: chain.length - 1,
    inheritedCount,
    hasAnchor: Boolean(target?.anchor),
    ownCount,
  };
}

function oneLinePreview(content: string, max = 90): string {
  const line = content.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}
