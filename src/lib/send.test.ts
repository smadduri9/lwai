import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useChatStore } from "../store/chatStore";
import { sendMessage, stopMessage, regenerateFromEdit } from "./send";

beforeEach(() => {
  localStorage.clear();
  useChatStore.getState().clearAll();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockStreamingFetch(chunks: string[], signalCapture?: { signal?: AbortSignal }) {
  const encoder = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (signalCapture) signalCapture.signal = init?.signal as AbortSignal | undefined;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            if (init?.signal?.aborted) {
              controller.error(new DOMException("Aborted", "AbortError"));
              return;
            }
            controller.enqueue(encoder.encode(chunk));
            await new Promise((r) => setTimeout(r, 5));
          }
          controller.close();
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }),
  );
}

describe("stopMessage / sendMessage", () => {
  it("aborts an in-flight stream and keeps partial assistant text", async () => {
    const capture: { signal?: AbortSignal } = {};
    // Slow stream: text delta then hang until abort.
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        capture.signal = init?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } })}\n\n`,
              ),
            );
            await new Promise<void>((_resolve, reject) => {
              const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
              if (init?.signal?.aborted) {
                onAbort();
                return;
              }
              init?.signal?.addEventListener("abort", onAbort, { once: true });
              // Never resolve unless aborted — stopMessage should abort.
            }).catch((err) => {
              controller.error(err);
            });
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }),
    );

    const root = useChatStore.getState().rootBranchId;
    const sendPromise = sendMessage(root, "hi");

    // Wait until streaming starts and first delta lands.
    await vi.waitFor(() => {
      expect(useChatStore.getState().streamingBranches[root]).toBeTruthy();
    });
    await vi.waitFor(() => {
      const msgs = useChatStore.getState().branches[root].messages;
      const asst = msgs.find((m) => m.role === "assistant");
      expect(asst?.content).toContain("Hello");
    });

    stopMessage(root);
    await sendPromise;

    expect(useChatStore.getState().streamingBranches[root]).toBeUndefined();
    const msgs = useChatStore.getState().branches[root].messages;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toContain("Hello");
    expect(capture.signal?.aborted).toBe(true);
  });
});

describe("truncate + regenerateFromEdit", () => {
  it("truncates later messages and orphaned sub-branches in the store", () => {
    const root = useChatStore.getState().rootBranchId;
    const u1 = useChatStore.getState().appendMessage(root, "user", "first");
    const a1 = useChatStore.getState().appendMessage(root, "assistant", "answer one");
    useChatStore.getState().appendMessage(root, "user", "second");
    useChatStore.getState().appendMessage(root, "assistant", "answer two");
    const sub = useChatStore
      .getState()
      .createSubBranch(
        { sourceMessageId: a1, quotedText: "answer", startOffset: 0, endOffset: 6 },
        { x: 0, y: 0 },
      );

    useChatStore.getState().truncateBranchFromMessage(root, u1);
    const s = useChatStore.getState();
    expect(s.branches[root].messages.map((m) => m.id)).toEqual([u1]);
    expect(s.branches[sub]).toBeUndefined();
  });

  it("regenerateFromEdit rewrites the user message and streams a new reply", async () => {
    mockStreamingFetch([
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Fresh" } })}\n\n`,
    ]);

    const root = useChatStore.getState().rootBranchId;
    const u1 = useChatStore.getState().appendMessage(root, "user", "old prompt");
    useChatStore.getState().appendMessage(root, "assistant", "old answer");
    useChatStore.getState().appendMessage(root, "user", "later");
    useChatStore.getState().appendMessage(root, "assistant", "later answer");

    await regenerateFromEdit(root, u1, "new prompt");

    const msgs = useChatStore.getState().branches[root].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: u1, role: "user", content: "new prompt" });
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toContain("Fresh");
    expect(useChatStore.getState().streamingBranches[root]).toBeUndefined();
  });
});
