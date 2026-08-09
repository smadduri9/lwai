import { describe, expect, it } from "vitest";
import { SUBCHAT_MIN_HEIGHT, SUBCHAT_MIN_WIDTH } from "./subChatLayout";
import { SUBCHAT_CENTER_FLOAT, centerFloatRect } from "./subChatFloat";

describe("centerFloatRect", () => {
  it("centers within a large viewport", () => {
    const rect = centerFloatRect(SUBCHAT_CENTER_FLOAT, { width: 1200, height: 800 });
    expect(rect.size).toEqual(SUBCHAT_CENTER_FLOAT);
    expect(rect.position.x).toBe(Math.round((1200 - 400) / 2));
    expect(rect.position.y).toBe(Math.round((800 - 440) / 2));
  });

  it("clamps size to composer-safe minimums", () => {
    const rect = centerFloatRect(
      { width: 200, height: 100 },
      { width: 1200, height: 800 },
    );
    expect(rect.size.width).toBe(SUBCHAT_MIN_WIDTH);
    expect(rect.size.height).toBe(SUBCHAT_MIN_HEIGHT);
  });

  it("keeps at least 12px inset from viewport edges", () => {
    const rect = centerFloatRect(
      { width: 500, height: 500 },
      { width: 400, height: 400 },
    );
    expect(rect.position.x).toBeGreaterThanOrEqual(12);
    expect(rect.position.y).toBeGreaterThanOrEqual(12);
    expect(rect.size.width).toBeLessThanOrEqual(400);
    expect(rect.size.height).toBeLessThanOrEqual(400);
  });
});
