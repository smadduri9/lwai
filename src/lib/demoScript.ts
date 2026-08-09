import { sendMessage } from "./send";
import {
  ANCHOR_CONTEXT_CHARS,
  anchorText,
  anchorTextNodes,
  rangeToQuotedHtml,
} from "./selection";
import { useChatStore } from "../store/chatStore";
import { useDemoStore } from "../store/demoStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";

const DEMO_PROMPT = "Why does the Moon always show the same face to Earth?";

const DEMO_REPLY =
  "Great question! The Moon always shows the same face because of a phenomenon called " +
  "**tidal locking**. Over billions of years, Earth's gravity raised tidal bulges in the " +
  "Moon's body, and the friction from those bulges gradually slowed the Moon's spin until " +
  "its rotation period exactly matched its orbital period — about 27.3 days.\n\n" +
  "So the Moon *does* rotate; it just rotates once per orbit, keeping one hemisphere " +
  "permanently pointed at us. The \"far side\" isn't dark — it gets just as much sunlight, " +
  "we simply never see it from Earth.";

/** Substring of DEMO_REPLY that the demo highlights and asks more about. */
const HIGHLIGHT_TEXT =
  "the friction from those bulges gradually slowed the Moon's spin";

const DEMO_FOLLOWUP = "How long did that slowing process take?";

const DEMO_SUB_REPLY =
  "The despinning happened surprisingly fast on cosmic timescales — models suggest the " +
  "Moon locked within roughly **100 million years** of its formation, when it orbited much " +
  "closer to Earth and tidal forces were far stronger (tidal torque falls off with the " +
  "sixth power of distance!).";

class DemoAborted extends Error {}

function sleep(ms: number, aborted: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => (aborted() ? reject(new DemoAborted()) : resolve()), ms);
  });
}

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  aborted: () => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (performance.now() - start > timeoutMs) throw new DemoAborted();
    await sleep(80, aborted);
  }
}

/** Glide the fake cursor to a viewport point (CSS transition does the easing). */
async function moveCursorTo(x: number, y: number, aborted: () => boolean): Promise<void> {
  useDemoStore.getState().setCursor({ x, y, visible: true });
  await sleep(700, aborted);
}

async function clickAt(el: Element, aborted: () => boolean): Promise<void> {
  const rect = el.getBoundingClientRect();
  await moveCursorTo(rect.left + rect.width / 2, rect.top + rect.height / 2, aborted);
  useDemoStore.getState().setCursor({ clicking: true });
  await sleep(180, aborted);
  useDemoStore.getState().setCursor({ clicking: false });
  (el as HTMLElement).click();
  await sleep(220, aborted);
}

/** Human-ish typing into a branch draft (drives the live composer UI). */
async function typeDraft(branchId: string, text: string, aborted: () => boolean): Promise<void> {
  const setDraft = useUiStore.getState().setDraft;
  for (let i = 1; i <= text.length; i++) {
    setDraft(branchId, text.slice(0, i));
    await sleep(30 + Math.random() * 40, aborted);
  }
  await sleep(350, aborted);
}

/** Wait until the branch's last assistant message is fully streamed. */
async function waitForReply(branchId: string, aborted: () => boolean): Promise<string> {
  await waitFor(
    () => {
      const s = useChatStore.getState();
      const msgs = s.branches[branchId]?.messages ?? [];
      const last = msgs[msgs.length - 1];
      return Boolean(
        last && last.role === "assistant" && last.content && !s.streamingBranches[branchId],
      );
    },
    aborted,
    30_000,
  );
  const msgs = useChatStore.getState().branches[branchId]?.messages ?? [];
  return msgs[msgs.length - 1]!.id;
}

/**
 * Programmatically select `HIGHLIGHT_TEXT` inside a rendered message and arm
 * the real SelectionToolbar via the same anchor math as a manual selection.
 */
async function highlightInMessage(messageId: string, aborted: () => boolean): Promise<void> {
  const container = await waitFor(
    () => document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`),
    aborted,
  );
  container.scrollIntoView({ behavior: "smooth", block: "center" });
  await sleep(500, aborted);

  const text = anchorText(container);
  const startOffset = text.indexOf(HIGHLIGHT_TEXT);
  if (startOffset < 0) throw new DemoAborted();
  const endOffset = startOffset + HIGHLIGHT_TEXT.length;

  // Map text offsets back onto DOM text nodes to build a real Range.
  const range = document.createRange();
  let count = 0;
  let startSet = false;
  for (const node of anchorTextNodes(container)) {
    const next = count + node.data.length;
    if (!startSet && startOffset < next) {
      range.setStart(node, startOffset - count);
      startSet = true;
    }
    if (endOffset <= next) {
      range.setEnd(node, endOffset - count);
      break;
    }
    count = next;
  }

  // Sweep the cursor across the selection, then show the browser selection.
  const rect = range.getBoundingClientRect();
  await moveCursorTo(rect.left, rect.top + rect.height / 2, aborted);
  await moveCursorTo(rect.right, rect.bottom - rect.height / 2, aborted);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  useSelectionStore.getState().setPending({
    kind: "chat",
    anchor: {
      sourceMessageId: messageId,
      quotedText: HIGHLIGHT_TEXT,
      quotedHtml: rangeToQuotedHtml(range),
      prefix: text.slice(Math.max(0, startOffset - ANCHOR_CONTEXT_CHARS), startOffset),
      suffix: text.slice(endOffset, endOffset + ANCHOR_CONTEXT_CHARS),
      startOffset,
      endOffset,
    },
    rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
  });
  await sleep(400, aborted);
}

/**
 * The full scripted demo: type a prompt → simulated reply → highlight text →
 * "Ask more" → subchat opens → type a follow-up → simulated subchat reply.
 * Aborts instantly on Escape or any real user pointerdown.
 */
export async function runDemo(): Promise<void> {
  const demo = useDemoStore.getState();
  if (demo.active) return;

  const rootBranchId = useChatStore.getState().rootBranchId;
  demo.start([DEMO_REPLY, DEMO_SUB_REPLY]);
  const aborted = () => !useDemoStore.getState().active;

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && e.isTrusted) useDemoStore.getState().stop();
  };
  const onPointer = (e: PointerEvent) => {
    if (e.isTrusted) useDemoStore.getState().stop();
  };
  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("pointerdown", onPointer, true);

  try {
    // 1. Glide to the main composer and type the prompt.
    const composer = await waitFor(
      () =>
        document.querySelector<HTMLElement>(`[data-composer="${CSS.escape(rootBranchId)}"]`),
      aborted,
    );
    const cRect = composer.getBoundingClientRect();
    await moveCursorTo(cRect.left + cRect.width / 2, cRect.top + cRect.height / 2, aborted);
    await typeDraft(rootBranchId, DEMO_PROMPT, aborted);

    // 2. Send and wait for the simulated reply.
    useUiStore.getState().setDraft(rootBranchId, "");
    void sendMessage(rootBranchId, DEMO_PROMPT);
    const messageId = await waitForReply(rootBranchId, aborted);
    await sleep(800, aborted);

    // 3. Highlight a phrase in the reply → real SelectionToolbar appears.
    await highlightInMessage(messageId, aborted);

    // 4. Click the real "Ask more" button.
    const askBtn = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>("[data-selection-toolbar] button")].find(
          (b) => /ask more/i.test(b.textContent ?? ""),
        ),
      aborted,
    );
    await clickAt(askBtn, aborted);

    // 5. Wait for the subchat to open, then type + send the follow-up.
    const subBranchId = await waitFor(
      () => useUiStore.getState().selectionAskBranchId,
      aborted,
    );
    const subInput = await waitFor(
      () =>
        document.querySelector<HTMLElement>(
          `textarea[data-branch-id="${CSS.escape(subBranchId)}"]`,
        ),
      aborted,
    );
    const sRect = subInput.getBoundingClientRect();
    await moveCursorTo(sRect.left + sRect.width / 2, sRect.top + sRect.height / 2, aborted);
    await typeDraft(subBranchId, DEMO_FOLLOWUP, aborted);

    useUiStore.getState().setDraft(subBranchId, "");
    void sendMessage(subBranchId, DEMO_FOLLOWUP);
    await waitForReply(subBranchId, aborted);
    await sleep(1400, aborted);
  } catch (err) {
    if (!(err instanceof DemoAborted)) console.error("Demo failed:", err);
  } finally {
    window.removeEventListener("keydown", onEscape, true);
    window.removeEventListener("pointerdown", onPointer, true);
    useDemoStore.getState().stop();
  }
}
