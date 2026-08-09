import { describe, it, expect } from "vitest";
import { layoutRail, railExtent, type RailCardInput } from "./railLayout";

const card = (branchId: string, desiredY: number, height = 100): RailCardInput => ({
  branchId,
  desiredY,
  height,
});

describe("layoutRail", () => {
  it("places non-overlapping cards at their desired positions", () => {
    const pos = layoutRail([card("a", 10), card("b", 300), card("c", 600)]);
    expect(pos).toEqual({ a: 10, b: 300, c: 600 });
  });

  it("pushes overlapping cards down with a gap", () => {
    const pos = layoutRail([card("a", 50), card("b", 60), card("c", 70)]);
    expect(pos.a).toBe(50);
    expect(pos.b).toBe(160); // 50 + 100 + 10
    expect(pos.c).toBe(270);
  });

  it("orders by desired Y regardless of input order", () => {
    const pos = layoutRail([card("late", 500), card("early", 20)]);
    expect(pos.early).toBe(20);
    expect(pos.late).toBe(500);
  });

  it("gives the active card its exact desired Y, pushing neighbors above up", () => {
    // Three cards all wanting ~the same spot; active is the last one.
    const pos = layoutRail([card("a", 100), card("b", 110), card("c", 120)], "c");
    expect(pos.c).toBe(120);
    expect(pos.b).toBe(120 - 100 - 10); // pushed up above active
    // Not enough room above for `a` too: it clamps at the top padding
    // (z-index keeps the active card readable in this extreme case).
    expect(pos.a).toBe(4);
  });

  it("honors user railOffsetY baked into desiredY", () => {
    const pos = layoutRail([card("a", 50 + 80), card("b", 300)]);
    expect(pos.a).toBe(130);
    expect(pos.b).toBe(300);
  });

  it("clamps cards to the top padding when pushing up", () => {
    const pos = layoutRail([card("a", 0), card("b", 10)], "b");
    expect(pos.b).toBe(10);
    expect(pos.a).toBeGreaterThanOrEqual(0);
  });

  it("re-pushes cards below a re-anchored active card", () => {
    const pos = layoutRail([card("a", 100), card("b", 105), card("c", 400)], "b");
    expect(pos.b).toBe(105);
    // c is far away, stays at its desired Y.
    expect(pos.c).toBe(400);
  });
});

describe("railExtent", () => {
  it("returns the bottom of the lowest card", () => {
    const cards = [card("a", 10), card("b", 300, 150)];
    const pos = layoutRail(cards);
    expect(railExtent(cards, pos)).toBe(450);
  });

  it("is 0 for an empty rail", () => {
    expect(railExtent([], {})).toBe(0);
  });
});
