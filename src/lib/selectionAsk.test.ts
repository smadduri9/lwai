import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useChatStore } from "../store/chatStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";
import {
  openSelectionAskInNewTab,
  openSelectionSubchat,
} from "./selectionAsk";
import type { Anchor } from "../types";

beforeEach(() => {
  useChatStore.getState().clearAll();
  useUiStore.setState({
    selectionAskBranchId: null,
    activeBranchId: null,
    drafts: {},
  });
  useSelectionStore.getState().setPending(null);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedRootMessage(): { rootId: string; messageId: string } {
  const chat = useChatStore.getState();
  const rootId = chat.rootBranchId;
  const messageId = chat.appendMessage(rootId, "assistant", "Mycelial networks connect trees.");
  return { rootId, messageId };
}

function chatPending(messageId: string, quote = "Mycelial networks") {
  return {
    kind: "chat" as const,
    anchor: {
      sourceMessageId: messageId,
      quotedText: quote,
      startOffset: 0,
      endOffset: quote.length,
    } satisfies Anchor,
    rect: { left: 100, top: 100, bottom: 120, width: 80 },
  };
}

describe("openSelectionSubchat", () => {
  it("creates a docked bubble child and activates it", () => {
    const { rootId, messageId } = seedRootMessage();
    const id = openSelectionSubchat(chatPending(messageId));
    expect(id).toBeTruthy();
    const branch = useChatStore.getState().branches[id!];
    expect(branch.parentBranchId).toBe(rootId);
    expect(branch.window?.mode).toBe("bubble");
    expect(useUiStore.getState().activeBranchId).toBe(id);
    expect(useUiStore.getState().selectionAskBranchId).toBe(id);
    expect(useSelectionStore.getState().pending).toBeNull();
  });
});

describe("openSelectionAskInNewTab", () => {
  it("creates a child, minimizes it, and opens BranchPage in a new tab", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const { rootId, messageId } = seedRootMessage();
    const id = openSelectionAskInNewTab(chatPending(messageId));
    expect(id).toBeTruthy();

    const branch = useChatStore.getState().branches[id!];
    expect(branch.parentBranchId).toBe(rootId);
    expect(branch.window?.mode).toBe("minimized");
    expect(branch.window?.restoreMode).toBe("bubble");
    expect(useUiStore.getState().selectionAskBranchId).toBe(id);
    expect(useSelectionStore.getState().pending).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0][0]);
    expect(url).toContain(`branch=${id}`);
    expect(open.mock.calls[0][1]).toBe("_blank");
  });

  it("creates a new card for a different selection range", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const { messageId } = seedRootMessage();
    const first = openSelectionAskInNewTab(chatPending(messageId, "Mycelial"));
    expect(first).toBeTruthy();

    const second = openSelectionAskInNewTab(
      chatPending(messageId, "networks connect"),
    );
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const firstBranch = useChatStore.getState().branches[first!];
    const secondBranch = useChatStore.getState().branches[second!];
    expect(firstBranch.anchor?.quotedText).toBe("Mycelial");
    expect(secondBranch.anchor?.quotedText).toBe("networks connect");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reuses the same card when the exact selection range is chosen again", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const { messageId } = seedRootMessage();
    const pending = chatPending(messageId, "Mycelial networks");
    const first = openSelectionAskInNewTab(pending);
    expect(first).toBeTruthy();

    const second = openSelectionAskInNewTab(pending);
    expect(second).toBe(first);
    expect(useChatStore.getState().branches[first!].anchor?.quotedText).toBe(
      "Mycelial networks",
    );
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("creates distinct docked cards for different selections", () => {
    const { messageId } = seedRootMessage();
    const first = openSelectionSubchat(chatPending(messageId, "Mycelial"));
    const second = openSelectionSubchat(
      chatPending(messageId, "networks connect"),
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(useChatStore.getState().branches[first!].anchor?.quotedText).toBe(
      "Mycelial",
    );
    expect(useChatStore.getState().branches[second!].anchor?.quotedText).toBe(
      "networks connect",
    );
  });

  it("returns null for image pending", () => {
    expect(
      openSelectionAskInNewTab({
        kind: "image",
        imageSrc: "https://example.com/x.png",
        rect: { left: 0, top: 0, bottom: 10, width: 10 },
      }),
    ).toBeNull();
  });
});
