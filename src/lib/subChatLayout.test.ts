import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  SUBCHAT_DEFAULT_BUBBLE,
  SUBCHAT_DEFAULT_FULL,
  SUBCHAT_MIN_HEIGHT,
  SUBCHAT_MIN_WIDTH,
  clampRailSize,
  clampSubChatSize,
  clampWindowStateSize,
} from "./subChatLayout";
import {
  createMeasureScheduler,
  dockSignatureFromBranches,
  dockStructuralSignature,
} from "./railMeasure";

describe("subChatLayout", () => {
  it("clamps float size up to composer-safe minimums", () => {
    expect(clampSubChatSize({ width: 200, height: 100 })).toEqual({
      width: SUBCHAT_MIN_WIDTH,
      height: SUBCHAT_MIN_HEIGHT,
    });
  });

  it("clamps float size down to viewport", () => {
    expect(
      clampSubChatSize(
        { width: 2000, height: 2000 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ width: 800, height: 600 });
  });

  it("clamps rail width to minimum", () => {
    expect(clampRailSize({ w: 220 }).w).toBe(SUBCHAT_MIN_WIDTH);
  });

  it("clamps persisted window state without mutating when already valid", () => {
    const win = {
      size: { ...SUBCHAT_DEFAULT_BUBBLE },
      railSize: { w: SUBCHAT_MIN_WIDTH, h: 240 },
    };
    expect(clampWindowStateSize(win)).toBe(win);
  });

  it("bumps tiny persisted sizes on hydrate", () => {
    const next = clampWindowStateSize({
      size: { width: 200, height: 100 },
      railSize: { w: 220, h: 50 },
    });
    expect(next.size.width).toBe(SUBCHAT_MIN_WIDTH);
    expect(next.size.height).toBe(SUBCHAT_MIN_HEIGHT);
    expect(next.railSize?.w).toBe(SUBCHAT_MIN_WIDTH);
    expect(next.railSize?.h).toBe(160);
  });

  it("exports defaults larger than legacy bubble", () => {
    expect(SUBCHAT_DEFAULT_BUBBLE.width).toBeGreaterThanOrEqual(SUBCHAT_MIN_WIDTH);
    expect(SUBCHAT_DEFAULT_FULL.height).toBeGreaterThanOrEqual(SUBCHAT_MIN_HEIGHT);
  });
});

describe("railMeasure", () => {
  beforeEach(() => {
    let id = 0;
    const pending = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const handle = ++id;
      pending.set(handle, cb);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      pending.delete(handle);
    });
    (globalThis as { __rafFlush?: () => void }).__rafFlush = () => {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(0);
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces multiple schedule calls into one rAF run", () => {
    const run = vi.fn();
    const { schedule, cancel } = createMeasureScheduler(run);
    schedule();
    schedule();
    schedule();
    expect(run).not.toHaveBeenCalled();
    (globalThis as unknown as { __rafFlush: () => void }).__rafFlush();
    expect(run).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("cancel prevents a pending run", () => {
    const run = vi.fn();
    const { schedule, cancel } = createMeasureScheduler(run);
    schedule();
    cancel();
    (globalThis as unknown as { __rafFlush: () => void }).__rafFlush();
    expect(run).not.toHaveBeenCalled();
  });

  it("dockStructuralSignature excludes message content", () => {
    const a = dockStructuralSignature({
      id: "b1",
      railSide: "right",
      railW: 320,
      railH: 240,
      railOffsetY: 0,
      mode: "bubble",
    });
    expect(a).not.toMatch(/messages/);
  });
});

describe("dockSignatureFromBranches", () => {
  const mk = (opts: {
    messages?: number;
    h?: number;
    railOffsetY?: number;
  }) => ({
    id: "child",
    parentBranchId: "root",
    window: {
      mode: "bubble",
      railSide: "right",
      railSize: { w: 320, h: opts.h ?? 240 },
      railOffsetY: opts.railOffsetY,
    },
  });

  it("does not change when only messages.length would have changed", () => {
    // Signature is structural — callers never pass messages into it.
    const before = dockSignatureFromBranches([mk({})], "root", "right");
    const after = dockSignatureFromBranches([mk({ messages: 99 })], "root", "right");
    expect(before).toBe(after);
  });

  it("changes when railSize changes", () => {
    expect(dockSignatureFromBranches([mk({ h: 240 })], "root", "right")).not.toBe(
      dockSignatureFromBranches([mk({ h: 300 })], "root", "right"),
    );
  });

  it("changes when railOffsetY changes", () => {
    expect(dockSignatureFromBranches([mk({ railOffsetY: 0 })], "root", "right")).not.toBe(
      dockSignatureFromBranches([mk({ railOffsetY: 40 })], "root", "right"),
    );
  });
});
