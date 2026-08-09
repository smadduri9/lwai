/**
 * Google-Docs-style comment stacking for one margin rail.
 *
 * Every card wants to sit level with its anchor highlight (desiredY). Cards
 * may not overlap, so lower cards get pushed down. The active card wins: it
 * sits exactly at its desired position and neighbors above it are pushed up
 * out of the way instead.
 */

export interface RailCardInput {
  branchId: string;
  /** Y of the anchor highlight, relative to the rail's coordinate space. */
  desiredY: number;
  /** Measured card height. */
  height: number;
}

const GAP = 10;
const TOP_PADDING = 4;

export function layoutRail(
  cards: RailCardInput[],
  activeBranchId?: string | null,
): Record<string, number> {
  const sorted = [...cards].sort(
    (a, b) => a.desiredY - b.desiredY || a.branchId.localeCompare(b.branchId),
  );

  // Pass 1: greedy push-down from the top.
  const placed: Record<string, number> = {};
  let cursor = TOP_PADDING;
  for (const c of sorted) {
    const y = Math.max(c.desiredY, cursor);
    placed[c.branchId] = y;
    cursor = y + c.height + GAP;
  }

  // Pass 2: if the active card was displaced downward, pull it back to its
  // desired Y and push the cards above it up (Docs behavior).
  const activeIdx = sorted.findIndex((c) => c.branchId === activeBranchId);
  if (activeIdx !== -1) {
    const active = sorted[activeIdx];
    const target = Math.max(active.desiredY, TOP_PADDING);
    if (placed[active.branchId] > target) {
      placed[active.branchId] = target;
      let ceiling = target;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const c = sorted[i];
        const maxY = ceiling - GAP - c.height;
        if (placed[c.branchId] > maxY) placed[c.branchId] = Math.max(maxY, TOP_PADDING);
        ceiling = placed[c.branchId];
      }
      // Re-push everything below the active card downward if needed.
      let floor = target + active.height + GAP;
      for (let i = activeIdx + 1; i < sorted.length; i++) {
        const c = sorted[i];
        placed[c.branchId] = Math.max(c.desiredY, floor);
        floor = placed[c.branchId] + c.height + GAP;
      }
    }
  }

  return placed;
}

/** Total rail height needed so the scroll area includes the lowest card. */
export function railExtent(
  cards: RailCardInput[],
  positions: Record<string, number>,
): number {
  let max = 0;
  for (const c of cards) {
    const bottom = (positions[c.branchId] ?? 0) + c.height;
    if (bottom > max) max = bottom;
  }
  return max;
}
