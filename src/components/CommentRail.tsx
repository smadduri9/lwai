import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  SUBCHAT_DEFAULT_CARD_WIDTH,
  SUBCHAT_MIN_WIDTH,
} from "../lib/subChatLayout";
import { layoutRail, railExtent, type RailCardInput } from "../lib/railLayout";
import {
  createMeasureScheduler,
  dockSignatureFromBranches,
} from "../lib/railMeasure";
import { useChatStore } from "../store/chatStore";
import { useRailHostStore } from "../store/railHostStore";
import { useUiStore } from "../store/uiStore";
import { CommentCard } from "./CommentCard";

const FALLBACK_CARD_HEIGHT = 96;
/** How many times to re-check for a highlight mark that hasn't rendered yet. */
const MAX_MARK_RETRIES = 20;
/** Debounce layout while the paper grows during streaming. */
const MEASURE_DEBOUNCE_MS = 80;
/** Skip top animation for tiny position deltas (sub-pixel noise). */
const ANIMATE_TOP_MIN_PX = 4;

export { dockSignatureFromBranches as dockSignatureFromStore } from "../lib/railMeasure";

/**
 * One margin rail (left or right). Cards are absolutely positioned so each
 * sits level with its anchor highlight, pushed apart Docs-style when they
 * would overlap. Everything scrolls with the document since the rail lives
 * inside the same scroll container.
 *
 * `compact` = mini-rail inside a card/window (always visible, narrower).
 */
export function CommentRail({
  side,
  contentRef,
  /** Parent whose bubble children dock here (main Ask, session root, or nested). */
  dockParentId,
  compact = false,
}: {
  side: "left" | "right";
  contentRef: RefObject<HTMLDivElement | null>;
  dockParentId?: string;
  compact?: boolean;
}) {
  const rootBranchId = useChatStore((s) => s.rootBranchId);
  const parentId = dockParentId ?? rootBranchId;
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const register = useRailHostStore((s) => s.register);
  const unregister = useRailHostStore((s) => s.unregister);

  useEffect(() => {
    register(parentId, compact);
    return () => unregister(parentId, compact);
  }, [parentId, compact, register, unregister]);

  // Primitive signature — Zustand 5 requires getSnapshot to return a cached
  // value; filtered Branch[] arrays would infinite-loop.
  const dockSig = useChatStore((s) =>
    dockSignatureFromBranches(Object.values(s.branches), parentId, side),
  );
  const docked = useMemo(() => {
    return Object.values(useChatStore.getState().branches).filter(
      (b) =>
        b.parentBranchId === parentId &&
        b.window?.mode === "bubble" &&
        (b.window.railSide ?? "right") === side,
    );
  }, [dockSig, parentId, side]);

  const dockIdsKey = dockSig;

  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [extent, setExtent] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measuringClear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markRetries = useRef(0);
  const placedOnce = useRef(new Set<string>());
  const prevTops = useRef(new Map<string, number>());
  const dockedRef = useRef(docked);
  dockedRef.current = docked;

  const runMeasureRef = useRef<() => void>(() => {});
  runMeasureRef.current = () => {
    const content = contentRef.current;
    const rail = railRef.current;
    if (!content || !rail) return;
    const contentTop = rail.getBoundingClientRect().top;
    const current = dockedRef.current;

    const inputs: RailCardInput[] = [];
    let missingMark = false;
    for (const b of current) {
      const mark = content.querySelector<HTMLElement>(`mark[data-branch-id="${b.id}"]`);
      if (!mark && markRetries.current < MAX_MARK_RETRIES) {
        missingMark = true;
        continue;
      }
      const markY = mark ? mark.getBoundingClientRect().top - contentTop : 0;
      const desiredY = markY + (b.window?.railOffsetY ?? 0);
      const el = cardRefs.current.get(b.id);
      inputs.push({
        branchId: b.id,
        desiredY,
        height: el?.offsetHeight ?? FALLBACK_CARD_HEIGHT,
      });
    }

    const next = layoutRail(inputs, useUiStore.getState().activeBranchId);
    setPositions((prev) => (shallowEqual(prev, next) ? prev : next));
    setExtent(railExtent(inputs, next));

    if (missingMark) {
      markRetries.current += 1;
      clearTimeout(markRetryTimer.current);
      markRetryTimer.current = setTimeout(() => scheduler.schedule(), 50);
    } else {
      markRetries.current = 0;
    }

    clearTimeout(measuringClear.current);
    measuringClear.current = setTimeout(() => setMeasuring(false), 120);
  };

  const scheduler = useMemo(
    () => createMeasureScheduler(() => runMeasureRef.current()),
    [],
  );

  useEffect(() => () => scheduler.cancel(), [scheduler]);

  const measure = useCallback(() => {
    setMeasuring(true);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      scheduler.schedule();
    }, MEASURE_DEBOUNCE_MS);
  }, [scheduler]);

  // Re-measure when docked cards change, when cards resize, or on scroll/viewport.
  // Observe card shells only (not the paper content) to avoid scroll-content feedback.
  useEffect(() => {
    measure();
    const content = contentRef.current;
    const ro = new ResizeObserver(() => measure());
    for (const el of cardRefs.current.values()) ro.observe(el);

    const onScroll = () => measure();
    let scrollParent: Element | Window = window;
    if (content) {
      let el: HTMLElement | null = content;
      while (el) {
        const { overflowY } = getComputedStyle(el);
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
          scrollParent = el;
          break;
        }
        el = el.parentElement;
      }
      scrollParent.addEventListener("scroll", onScroll, { passive: true });
    }

    window.addEventListener("resize", measure);
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onViewportResize = () => {
      measure();
      clearTimeout(settle);
      settle = setTimeout(measure, 150);
    };
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      ro.disconnect();
      scrollParent.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      clearTimeout(settle);
      clearTimeout(debounceTimer.current);
      clearTimeout(markRetryTimer.current);
      clearTimeout(measuringClear.current);
      scheduler.cancel();
    };
  }, [measure, dockIdsKey, activeBranchId, contentRef, scheduler]);

  // Re-observe card shells when the dock list changes (refs may mount after first effect).
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    for (const el of cardRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [dockIdsKey, measure, docked]);

  useEffect(() => {
    for (const id of Object.keys(positions)) placedOnce.current.add(id);
  }, [positions]);

  return (
    <div
      ref={railRef}
      data-rail-measuring={measuring ? "" : undefined}
      className={
        compact
          ? "comment-rail-column pointer-events-none relative z-[2] w-36 shrink-0 self-stretch"
          : `comment-rail-column pointer-events-none relative z-[2] hidden min-w-0 flex-1 ${
              side === "left" ? "xl:block" : "lg:block"
            }`
      }
    >
      <div style={{ height: extent }} />
      {docked.map((b) => {
        const top = positions[b.id];
        const positioned = top !== undefined;
        const prev = prevTops.current.get(b.id);
        const delta = prev != null && top != null ? Math.abs(top - prev) : 0;
        if (top != null) prevTops.current.set(b.id, top);
        const animate =
          positioned &&
          placedOnce.current.has(b.id) &&
          !measuring &&
          delta >= ANIMATE_TOP_MIN_PX;
        const active = b.id === activeBranchId;
        const expandedWidth = active
          ? Math.max(
              b.window?.railSize?.w ?? SUBCHAT_DEFAULT_CARD_WIDTH,
              SUBCHAT_MIN_WIDTH,
            )
          : undefined;
        return (
          <div
            key={b.id}
            data-rail-card
            className={`absolute ${animate ? "transition-[top] duration-200 ease-out" : ""}`}
            style={{
              // Clamp: a negative offset would let an active card poke above
              // the rail and stretch the scroll container mid-scroll.
              top: Math.max(0, top ?? 0),
              opacity: positioned ? 1 : 0,
              pointerEvents: positioned ? "auto" : "none",
              zIndex: active ? 2 : 1,
              width: expandedWidth,
              ...(side === "right"
                ? { right: 0, left: expandedWidth ? "auto" : 0 }
                : { left: 0, right: expandedWidth ? "auto" : 0 }),
            }}
          >
            <CommentCard
              branchId={b.id}
              side={side}
              ref={(el) => {
                if (el) cardRefs.current.set(b.id, el);
                else cardRefs.current.delete(b.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function shallowEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Math.abs(a[k] - b[k]) < 0.5);
}
