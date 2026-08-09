import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { useEffectPointer } from "../hooks/useEffectPointer";
import {
  CONSTELLATION_EDGES,
  CONSTELLATION_POINTS,
  CONSTELLATION_WRAP,
  TILE_H,
  TILE_W,
} from "../lib/constellationGraph";
import { effectPalette, type EffectPalette } from "../lib/effectPalette";
import { useThemeStore } from "../store/themeStore";

function buildTileFrom(
  tileW: number,
  tileH: number,
  points: Array<[number, number, number]>,
  edges: Array<[number, number]>,
  wrap: Array<[number, number, number, number]>,
  palette: EffectPalette,
  dark: boolean,
): string {
  const { dot: dotColor, line: lineColor, lineOpacity, glow } = palette;

  const lineSegments: Array<[number, number, number, number]> = [];
  for (const [a, b] of edges) {
    const [x1, y1] = points[a];
    const [x2, y2] = points[b];
    lineSegments.push([x1, y1, x2, y2]);
  }
  for (const [a, b, dx, dy] of wrap) {
    if (a >= points.length || b >= points.length) continue;
    const [x1, y1] = points[a];
    const [x2, y2] = points[b];
    const ox = dx * tileW;
    const oy = dy * tileH;
    lineSegments.push([x1, y1, x2 + ox, y2 + oy]);
    lineSegments.push([x1 - ox, y1 - oy, x2, y2]);
  }

  const line = (w: number, o: number) =>
    lineSegments
      .map(
        ([x1, y1, x2, y2]) =>
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${lineColor}" stroke-width="${w}" stroke-opacity="${o}"/>`,
      )
      .join("");

  const lines = (glow ? line(2.4, dark ? 0.14 : 0.12) : "") + line(0.7, lineOpacity);

  const dots = points
    .map(([x, y, r]) => {
      const o = Math.min(0.85, 0.35 + r * 0.16);
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${dotColor}" fill-opacity="${o.toFixed(2)}"/>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">${lines}${dots}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Strict singleton: only one full-viewport constellation may ever mount. */
let mountedInstances = 0;

/**
 * Cursor-reveal constellation background. Purely decorative: always behind
 * content (z-index -1) and pointer-events: none — it can never overlay text
 * or intercept hovers.
 *
 * Singleton by design: a second concurrent mount renders nothing (dev-warned)
 * so background layers can never stack/double-render.
 */
export function PatternLayer({
  orbitRef,
  hoverEnabled = true,
}: {
  orbitRef?: RefObject<HTMLElement | null>;
  hoverEnabled?: boolean;
  /** @deprecated Kept for call-site compat. */
  landing?: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const dark = theme === "dark";

  // Register in a layout effect so StrictMode's mount/unmount/mount cycle
  // keeps the count balanced.
  const [isPrimary, setIsPrimary] = useState(false);
  useLayoutEffect(() => {
    mountedInstances += 1;
    setIsPrimary(mountedInstances === 1);
    if (mountedInstances > 1 && import.meta.env.DEV) {
      console.warn(
        "PatternLayer: duplicate background layer mount ignored (singleton).",
      );
    }
    return () => {
      mountedInstances -= 1;
    };
  }, []);

  const primaryTile = useMemo(
    () =>
      buildTileFrom(
        TILE_W,
        TILE_H,
        CONSTELLATION_POINTS,
        CONSTELLATION_EDGES,
        CONSTELLATION_WRAP,
        effectPalette(dark),
        dark,
      ),
    [dark],
  );

  useEffectPointer({ orbitRef, hoverEnabled, enabled: isPrimary });

  if (!isPrimary) return null;

  return (
    <div aria-hidden className="pattern-layer" style={{ backgroundImage: primaryTile }} />
  );
}
