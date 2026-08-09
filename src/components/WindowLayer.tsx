import { useEffect, useMemo } from "react";
import { isDescendantOf } from "../lib/branchLineage";
import { SUBCHAT_MIN_HEIGHT, SUBCHAT_MIN_WIDTH, clampSubChatSize } from "../lib/subChatLayout";
import { useChatStore } from "../store/chatStore";
import { useRailHostStore } from "../store/railHostStore";
import { useMediaQuery, LEFT_RAIL_QUERY, RIGHT_RAIL_QUERY } from "../hooks/useMediaQuery";
import { SubChatWindow } from "./SubChatWindow";

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Pull every floating window back into the viewport (same bounds as drag). */
function clampWindowsToViewport() {
  const { branches, setWindowRect } = useChatStore.getState();
  for (const b of Object.values(branches)) {
    if (!b.window || b.window.mode === "minimized") continue;
    const { position, size } = b.window;
    const nextSize = clampSubChatSize(size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    // Prefer keeping mins; if viewport is smaller, still clamp to viewport.
    const width = Math.max(
      Math.min(nextSize.width, window.innerWidth),
      Math.min(SUBCHAT_MIN_WIDTH, window.innerWidth),
    );
    const height = Math.max(
      Math.min(nextSize.height, window.innerHeight),
      Math.min(SUBCHAT_MIN_HEIGHT, window.innerHeight),
    );
    const next = {
      position: {
        x: clamp(position.x, 0, Math.max(0, window.innerWidth - 80)),
        y: clamp(position.y, 0, Math.max(0, window.innerHeight - 48)),
      },
      size: { width, height },
    };
    if (
      next.position.x !== position.x ||
      next.position.y !== position.y ||
      next.size.width !== size.width ||
      next.size.height !== size.height
    ) {
      setWindowRect(b.id, next);
    }
  }
}

type FloatCandidate = {
  id: string;
  parentBranchId: string | null;
  mode: "bubble" | "full" | "minimized";
  railSide: "left" | "right";
  zIndex: number;
};

function floatCandidateSignature(
  branches: ReturnType<typeof useChatStore.getState>["branches"],
): string {
  return Object.values(branches)
    .filter((b) => b.window && b.window.mode !== "minimized")
    .map(
      (b) =>
        `${b.id}:${b.parentBranchId ?? ""}:${b.window!.mode}:${b.window!.railSide ?? "right"}:${b.window!.zIndex}`,
    )
    .sort()
    .join("|");
}

/**
 * Floating sub-chat windows: popped-out ("full") plus bubble cards whose
 * parent has no mounted/visible CommentRail.
 *
 * `hideBranchId` — on BranchPage, the focused thread is the big paper; never
 * also float that same branch. Only its descendants may float (siblings /
 * ancestors / unrelated windows stay hidden so the dedicated tab stays clean).
 */
export function WindowLayer({ hideBranchId }: { hideBranchId?: string } = {}) {
  const rightRailVisible = useMediaQuery(RIGHT_RAIL_QUERY);
  const leftRailVisible = useMediaQuery(LEFT_RAIL_QUERY);
  const hosts = useRailHostStore((s) => s.hosts);
  const branches = useChatStore((s) => s.branches);

  // Primitive signature — Zustand 5 requires getSnapshot to return a cached
  // value; mapped object arrays would infinite-loop.
  const candidateSig = useChatStore((s) => floatCandidateSignature(s.branches));
  const candidates = useMemo((): FloatCandidate[] => {
    return Object.values(useChatStore.getState().branches)
      .filter((b) => b.window && b.window.mode !== "minimized")
      .map(
        (b): FloatCandidate => ({
          id: b.id,
          parentBranchId: b.parentBranchId,
          mode: b.window!.mode,
          railSide: b.window!.railSide ?? "right",
          zIndex: b.window!.zIndex,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [candidateSig]);

  const floatingIds = useMemo(() => {
    return candidates
      .filter((c) => {
        if (hideBranchId) {
          if (c.id === hideBranchId) return false;
          if (!isDescendantOf(branches, c.id, hideBranchId)) return false;
        }
        if (c.mode === "full") return true;
        if (c.mode !== "bubble") return false;
        const parentId = c.parentBranchId;
        if (!parentId) return true;
        const host = hosts[parentId];
        if (!host) return true;
        // Mini-rail inside a card/window always docks children.
        if (host.compact > 0) return false;
        if (host.page <= 0) return true;
        return c.railSide === "left" ? !leftRailVisible : !rightRailVisible;
      })
      .map((c) => c.id);
  }, [candidates, hosts, leftRailVisible, rightRailVisible, hideBranchId, branches]);

  // Browser zoom / window resize can strand windows off-screen; snap them back.
  useEffect(() => {
    window.addEventListener("resize", clampWindowsToViewport);
    return () => window.removeEventListener("resize", clampWindowsToViewport);
  }, []);

  return (
    <>
      {floatingIds.map((id) => (
        <SubChatWindow key={id} branchId={id} />
      ))}
    </>
  );
}
