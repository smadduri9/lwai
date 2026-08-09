/**
 * Coalesce layout measure callbacks to at most one run per animation frame.
 * Cancels pending work on dispose so unmounted rails don't measure.
 */
export function createMeasureScheduler(run: () => void): {
  schedule: () => void;
  cancel: () => void;
} {
  let rafId: number | null = null;

  const schedule = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      run();
    });
  };

  const cancel = () => {
    if (rafId == null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  return { schedule, cancel };
}

/** Structural dock signature — excludes message content so streaming doesn't remeasure. */
export function dockStructuralSignature(parts: {
  id: string;
  railSide: string;
  railW: string | number;
  railH: string | number;
  railOffsetY: string | number;
  mode: string;
}): string {
  return `${parts.id}:${parts.railSide}:${parts.railW}:${parts.railH}:${parts.railOffsetY}:${parts.mode}`;
}

/** Build a structural signature for all bubble children on one rail side. */
export function dockSignatureFromBranches(
  branches: Array<{
    id: string;
    parentBranchId: string | null;
    window: {
      mode: string;
      railSide?: string;
      railSize?: { w?: number; h?: number };
      railOffsetY?: number;
    } | null;
  }>,
  parentId: string,
  side: "left" | "right",
): string {
  return branches
    .filter(
      (b) =>
        b.parentBranchId === parentId &&
        b.window?.mode === "bubble" &&
        (b.window.railSide ?? "right") === side,
    )
    .map((b) =>
      dockStructuralSignature({
        id: b.id,
        railSide: b.window?.railSide ?? "right",
        railW: b.window?.railSize?.w ?? "",
        railH: b.window?.railSize?.h ?? "",
        railOffsetY: b.window?.railOffsetY ?? "",
        mode: b.window?.mode ?? "bubble",
      }),
    )
    .sort()
    .join("|");
}
