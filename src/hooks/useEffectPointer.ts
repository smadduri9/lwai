import { useEffect, type RefObject } from "react";

/** px/s along a rectangular perimeter path. */
const ORBIT_SPEED = 260;
const ORBIT_SPEED_HERO = 130;
const POINTER_IDLE_MS = 450;
const LERP = 0.32;
const LERP_HERO = 0.14;

function pointOnPerimeter(
  left: number,
  top: number,
  w: number,
  h: number,
  d: number,
): [number, number] {
  const perimeter = 2 * (w + h);
  d = ((d % perimeter) + perimeter) % perimeter;
  if (d < w) return [left + d, top];
  d -= w;
  if (d < h) return [left + w, top + d];
  d -= h;
  if (d < w) return [left + w - d, top + h];
  d -= w;
  return [left, top + h - d];
}

/** Ref-count for `html.pattern-active` so one consumer unmounting never
 *  blanks the class out from under another live consumer. */
let patternActiveCount = 0;
const addPatternActive = (root: HTMLElement) => {
  patternActiveCount += 1;
  root.classList.add("pattern-active");
};
const removePatternActive = (root: HTMLElement) => {
  patternActiveCount = Math.max(0, patternActiveCount - 1);
  if (patternActiveCount === 0) root.classList.remove("pattern-active");
};

/**
 * Pointer / orbit / ambient motion for constellation reveal.
 * Writes `--mx/--my`; toggles `html.pattern-active`.
 */
export function useEffectPointer({
  orbitRef,
  hoverEnabled = true,
  enabled = true,
}: {
  orbitRef?: RefObject<HTMLElement | null>;
  hoverEnabled?: boolean;
  /** Inert when false (e.g. a suppressed duplicate layer). */
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let started = false;
    let raf = 0;
    let lastPointerAt = -1e9;
    let pathDist = 0;
    let lastTick = 0;

    const orbitPoint = (dist: number): [number, number] | null => {
      const el = orbitRef?.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const pad = 28;
      const left = r.left - pad;
      const top = r.top - pad;
      const w = r.width + pad * 2;
      const h = r.height + pad * 2;
      if (w <= 0 || h <= 0) return null;
      return pointOnPerimeter(left, top, w, h, dist);
    };

    const viewportPoint = (dist: number): [number, number] => {
      const pad = 48;
      const left = pad;
      const top = pad;
      const w = Math.max(1, window.innerWidth - pad * 2);
      const h = Math.max(1, window.innerHeight - pad * 2);
      return pointOnPerimeter(left, top, w, h, dist);
    };

    const speed = () => (hoverEnabled ? ORBIT_SPEED : ORBIT_SPEED_HERO);

    const seed = (): [number, number] | null => {
      return orbitPoint(0) ?? (hoverEnabled ? viewportPoint(0) : null);
    };

    let activeTracked = false;
    const markActive = () => {
      if (!activeTracked) {
        activeTracked = true;
        addPatternActive(root);
      } else {
        root.classList.add("pattern-active");
      }
    };

    const boot = seed();
    if (boot) {
      [targetX, targetY, x, y] = [...boot, ...boot];
      started = true;
      markActive();
    }

    const tick = (now: number) => {
      if (!lastTick) lastTick = now;
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;

      const onHero = !!orbitRef?.current;
      const lerp = onHero && !hoverEnabled ? LERP_HERO : LERP;
      const pointerIdle = now - lastPointerAt > POINTER_IDLE_MS;

      pathDist += speed() * dt;

      if (onHero) {
        const p = orbitPoint(pathDist);
        if (p) {
          [targetX, targetY] = p;
          if (!started) {
            started = true;
            x = targetX;
            y = targetY;
          }
        }
      } else if (hoverEnabled && pointerIdle) {
        const p = viewportPoint(pathDist);
        [targetX, targetY] = p;
        if (!started) {
          started = true;
          x = targetX;
          y = targetY;
        }
      }

      // Never write coords before the position is seeded — a 0,0 write yanks
      // the reveal mask to the viewport corner for a frame.
      if (started) {
        x += (targetX - x) * lerp;
        y += (targetY - y) * lerp;
        root.style.setProperty("--mx", `${x.toFixed(1)}px`);
        root.style.setProperty("--my", `${y.toFixed(1)}px`);
        markActive();
      }

      if (onHero || hoverEnabled) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!hoverEnabled) return;
      lastPointerAt = performance.now();
      targetX = e.clientX;
      targetY = e.clientY;
      if (!started) {
        started = true;
        x = targetX;
        y = targetY;
      }
      markActive();
      if (!raf) {
        lastTick = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      if (activeTracked) removePatternActive(root);
    };
  }, [orbitRef, hoverEnabled, enabled]);
}
