import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, collectSubtreeIds } from "../store/chatStore";
import {
  buildApiMessages,
  branchChain,
  anchorBlock,
  buildSystemContext,
  describeContext,
  TRUNCATION_MARKER,
} from "./context";
import type { Anchor } from "../types";

function makeAnchor(sourceMessageId: string, quotedText: string): Anchor {
  return { sourceMessageId, quotedText, startOffset: 0, endOffset: quotedText.length };
}

beforeEach(() => {
  localStorage.clear();
  useChatStore.getState().clearAll();
});

describe("branch tree", () => {
  it("starts with a single main root", () => {
    const s = useChatStore.getState();
    expect(Object.keys(s.branches)).toHaveLength(1);
    const root = s.branches[s.rootBranchId];
    expect(root.parentBranchId).toBeNull();
    expect(root.anchor).toBeNull();
    expect(root.window).toBeNull();
  });

  it("creates sub-branches parented to the branch owning the source message", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "hi");
    const asstId = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "hello world");

    const subId = useChatStore
      .getState()
      .createSubBranch(makeAnchor(asstId, "hello"), { x: 10, y: 20 });
    const sub = useChatStore.getState().branches[subId];
    expect(sub.parentBranchId).toBe(s.rootBranchId);
    expect(sub.window?.mode).toBe("bubble");
    expect(sub.window?.position).toEqual({ x: 10, y: 20 });

    // Nest: message in sub, branch off of it.
    const subAsstId = useChatStore.getState().appendMessage(subId, "assistant", "deeper answer");
    const deepId = useChatStore
      .getState()
      .createSubBranch(makeAnchor(subAsstId, "deeper"), { x: 0, y: 0 });
    expect(useChatStore.getState().branches[deepId].parentBranchId).toBe(subId);
  });

  it("walks a 3-level chain root-first", () => {
    const s = useChatStore.getState();
    const a1 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "root answer");
    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a1, "root"), { x: 0, y: 0 });
    const a2 = useChatStore.getState().appendMessage(b1, "assistant", "sub answer");
    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a2, "sub"), { x: 0, y: 0 });

    const chain = branchChain(useChatStore.getState().branches, b2);
    expect(chain.map((b) => b.id)).toEqual([s.rootBranchId, b1, b2]);
  });

  it("deletes a branch and all descendants recursively", () => {
    const s = useChatStore.getState();
    const a1 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "answer");
    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a1, "answer"), { x: 0, y: 0 });
    const a2 = useChatStore.getState().appendMessage(b1, "assistant", "nested");
    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a2, "nested"), { x: 0, y: 0 });

    expect(collectSubtreeIds(useChatStore.getState().branches, b1).sort()).toEqual(
      [b1, b2].sort(),
    );
    useChatStore.getState().deleteBranch(b1);
    const branches = useChatStore.getState().branches;
    expect(branches[b1]).toBeUndefined();
    expect(branches[b2]).toBeUndefined();
    expect(branches[s.rootBranchId]).toBeDefined();
  });

  it("focusWindow bumps zIndex above all others", () => {
    const s = useChatStore.getState();
    const a1 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "answer");
    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a1, "a"), { x: 0, y: 0 });
    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a1, "n"), { x: 0, y: 0 });

    const z1 = useChatStore.getState().branches[b1].window!.zIndex;
    const z2 = useChatStore.getState().branches[b2].window!.zIndex;
    expect(z2).toBeGreaterThan(z1);

    useChatStore.getState().focusWindow(b1);
    const z1After = useChatStore.getState().branches[b1].window!.zIndex;
    expect(z1After).toBeGreaterThan(z2);
    expect(useChatStore.getState().topZIndex).toBe(z1After);
  });
});

describe("buildApiMessages", () => {
  it("returns the root conversation as-is", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "Explain monads");
    useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "A monad is a burrito.");

    const msgs = buildApiMessages(useChatStore.getState().branches, s.rootBranchId);
    expect(msgs).toEqual([
      { role: "user", content: "Explain monads" },
      { role: "assistant", content: "A monad is a burrito." },
    ]);
  });

  it("injects ancestor context and the anchor block before branch messages", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "Explain monads");
    const asst = useChatStore
      .getState()
      .appendMessage(s.rootBranchId, "assistant", "A monad is a burrito.");

    const sub = useChatStore
      .getState()
      .createSubBranch(makeAnchor(asst, "burrito"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(sub, "user", "Why a burrito?");

    const msgs = buildApiMessages(useChatStore.getState().branches, sub);
    expect(msgs).toEqual([
      { role: "user", content: "Explain monads" },
      { role: "assistant", content: "A monad is a burrito." },
      { role: "user", content: anchorBlock("burrito") + "\n\nWhy a burrito?" },
    ]);
  });

  it("keeps anchor framing for every level in deep chains", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "q0");
    const a0 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "answer zero");

    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a0, "zero"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b1, "user", "q1");
    const a1 = useChatStore.getState().appendMessage(b1, "assistant", "answer one");

    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a1, "one"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b2, "user", "q2");

    const msgs = buildApiMessages(useChatStore.getState().branches, b2);
    expect(msgs).toEqual([
      { role: "user", content: "q0" },
      { role: "assistant", content: "answer zero" },
      { role: "user", content: anchorBlock("zero") + "\n\nq1" },
      { role: "assistant", content: "answer one" },
      { role: "user", content: anchorBlock("one") + "\n\nq2" },
    ]);
    // Roles strictly alternate starting with user.
    msgs.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? "user" : "assistant"));
  });

  it("merges consecutive same-role messages and drops empty ones", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "first");
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "second");
    useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "   ");
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "third");

    const msgs = buildApiMessages(useChatStore.getState().branches, s.rootBranchId);
    expect(msgs).toEqual([{ role: "user", content: "first\n\nsecond\n\nthird" }]);
  });

  it("keeps target branch + anchors verbatim under a tight budget", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "x".repeat(2000));
    const a0 = useChatStore
      .getState()
      .appendMessage(s.rootBranchId, "assistant", "y".repeat(2000) + " zero");

    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a0, "zero"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b1, "user", "my focused question");

    const msgs = buildApiMessages(useChatStore.getState().branches, b1, { budgetChars: 800 });
    const joined = msgs.map((m) => m.content).join("\n");
    // Own message and the anchor quote survive intact.
    expect(joined).toContain("my focused question");
    expect(joined).toContain(anchorBlock("zero"));
    // Total size respects the budget order of magnitude (middle-truncated).
    expect(joined.length).toBeLessThan(2500);
  });

  it("strict isolation: unrelated root turns never appear in a sub-chat payload", () => {
    const s = useChatStore.getState();
    for (let i = 0; i < 5; i++) {
      useChatStore.getState().appendMessage(s.rootBranchId, "user", `unrelated question ${i}`);
      useChatStore.getState().appendMessage(s.rootBranchId, "assistant", `unrelated answer ${i}`);
    }
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "the real question");
    const a = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "final answer");
    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a, "final"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b1, "user", "follow up");

    const msgs = buildApiMessages(useChatStore.getState().branches, b1);
    const joined = msgs.map((m) => m.content).join("\n");
    // Only the anchor's source turn is inherited.
    expect(joined).toContain("the real question");
    expect(joined).toContain("final answer");
    expect(joined).toContain("follow up");
    for (let i = 0; i < 5; i++) {
      expect(joined).not.toContain(`unrelated question ${i}`);
      expect(joined).not.toContain(`unrelated answer ${i}`);
    }
  });

  it("strict isolation: sibling sub-branches never leak into a sub-chat payload", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "q0");
    const a0 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "shared answer");

    const sibling = useChatStore
      .getState()
      .createSubBranch(makeAnchor(a0, "shared"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(sibling, "user", "sibling question");
    useChatStore.getState().appendMessage(sibling, "assistant", "sibling answer");

    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a0, "answer"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b2, "user", "my own question");

    const msgs = buildApiMessages(useChatStore.getState().branches, b2);
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain("my own question");
    expect(joined).toContain("shared answer");
    expect(joined).not.toContain("sibling question");
    expect(joined).not.toContain("sibling answer");
  });

  it("drops an oversized source turn and marks the gap when far over budget", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "big q " + "x".repeat(3000));
    const a = useChatStore
      .getState()
      .appendMessage(s.rootBranchId, "assistant", "big a " + "y".repeat(3000) + " final");
    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a, "final"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b1, "user", "follow up");

    const msgs = buildApiMessages(useChatStore.getState().branches, b1, { budgetChars: 700 });
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain(TRUNCATION_MARKER);
    expect(joined).toContain("follow up");
    expect(joined).not.toContain("big q");
  });
});

describe("buildSystemContext", () => {
  it("returns undefined for a plain root chat", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "hello");
    expect(buildSystemContext(useChatStore.getState().branches, s.rootBranchId)).toBeUndefined();
  });

  it("includes the quote and the surrounding source passage for a sub-chat", () => {
    const s = useChatStore.getState();
    const a = useChatStore
      .getState()
      .appendMessage(s.rootBranchId, "assistant", "before text. the key idea here. after text.");
    const anchor: Anchor = {
      sourceMessageId: a,
      quotedText: "the key idea",
      startOffset: 13,
      endOffset: 25,
    };
    const b1 = useChatStore.getState().createSubBranch(anchor, { x: 0, y: 0 });
    const system = buildSystemContext(useChatStore.getState().branches, b1);
    expect(system).toContain('Highlighted excerpt: "the key idea"');
    expect(system).toContain("before text");
    expect(system).toContain("after text");
  });
});

describe("describeContext", () => {
  it("attributes origins across a nested chain and matches buildApiMessages", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "q0");
    const a0 = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "answer zero");

    const b1 = useChatStore.getState().createSubBranch(makeAnchor(a0, "zero"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b1, "user", "q1");
    const a1 = useChatStore.getState().appendMessage(b1, "assistant", "answer one");

    const b2 = useChatStore.getState().createSubBranch(makeAnchor(a1, "one"), { x: 0, y: 0 });
    useChatStore.getState().appendMessage(b2, "user", "q2");

    const branches = useChatStore.getState().branches;
    const desc = describeContext(branches, b2);
    const sent = buildApiMessages(branches, b2);

    // Same shape as what actually gets sent.
    expect(desc.messageCount).toBe(sent.length);
    expect(desc.items.map((i) => i.role)).toEqual(sent.map((m) => m.role));
    expect(desc.totalChars).toBe(sent.reduce((n, m) => n + m.content.length, 0));

    // Origin attribution: source turns only (strict isolation), anchors, own.
    expect(desc.items[0].origins).toEqual(["source turn (root)"]);
    expect(desc.items[1].origins).toEqual(["source turn (root)"]);
    expect(desc.items[2].origins).toEqual(["anchor (parent)", "source turn (parent)"]);
    expect(desc.items[3].origins).toEqual(["source turn (parent)"]);
    expect(desc.items[4].origins).toEqual(["anchor", "this chat"]);

    expect(desc.chainDepth).toBe(2);
    expect(desc.hasAnchor).toBe(true);
    expect(desc.ownCount).toBe(1); // "q2"
    expect(desc.inheritedCount).toBe(5); // q0, answer zero, anchor(parent), q1, answer one
  });

  it("counts a root branch as all-own with nothing inherited", () => {
    const s = useChatStore.getState();
    useChatStore.getState().appendMessage(s.rootBranchId, "user", "hello");
    const desc = describeContext(useChatStore.getState().branches, s.rootBranchId);
    expect(desc.inheritedCount).toBe(0);
    expect(desc.hasAnchor).toBe(false);
    expect(desc.ownCount).toBe(1);
    expect(desc.items[0].origins).toEqual(["this chat"]);
  });
});

describe("in-memory session", () => {
  it("keeps sub-branch geometry after create", () => {
    const s = useChatStore.getState();
    const asst = useChatStore.getState().appendMessage(s.rootBranchId, "assistant", "hello world");
    const sub = useChatStore.getState().createSubBranch(makeAnchor(asst, "world"), { x: 5, y: 7 });
    useChatStore.getState().setStreaming(sub, true);

    const after = useChatStore.getState();
    expect(after.branches[sub].anchor?.quotedText).toBe("world");
    expect(after.branches[sub].window?.position).toEqual({ x: 5, y: 7 });
    expect(after.branches[sub].messages).toEqual([]);
    expect(after.streamingBranches[sub]).toBeTruthy();
  });
});
