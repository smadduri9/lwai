/** Shared stroke/fill colors for constellation background effects. */
export interface EffectPalette {
  dot: string;
  line: string;
  lineOpacity: number;
  glow: boolean;
}

/** Primary: coral / neon orange. */
export function effectPalette(dark: boolean): EffectPalette {
  if (dark) {
    return { dot: "#ffa273", line: "#ff8a4d", lineOpacity: 0.35, glow: true };
  }
  return { dot: "#d97860", line: "#c45a42", lineOpacity: 0.38, glow: true };
}

/** Secondary partner: soft teal (complementary calm against clay). */
export function secondaryPalette(dark: boolean): EffectPalette {
  if (dark) {
    return { dot: "#7ec8c8", line: "#5ab4b4", lineOpacity: 0.32, glow: true };
  }
  return { dot: "#5a9e9a", line: "#3d7a76", lineOpacity: 0.34, glow: true };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two hex colors (t = 0 → a, 1 → b). Approximate mid-hue blend. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/**
 * When both constellations are active, blend toward a shared mid-palette
 * so the field reads as one system (color-theory merge).
 */
export function mergedPalettes(dark: boolean): {
  primary: EffectPalette;
  secondary: EffectPalette;
} {
  const p = effectPalette(dark);
  const s = secondaryPalette(dark);
  // Mid-hue: warm–cool blend (~40% toward partner).
  const primary: EffectPalette = {
    dot: mixHex(p.dot, s.dot, 0.35),
    line: mixHex(p.line, s.line, 0.35),
    lineOpacity: p.lineOpacity,
    glow: true,
  };
  const secondary: EffectPalette = {
    dot: mixHex(s.dot, p.dot, 0.35),
    line: mixHex(s.line, p.line, 0.35),
    lineOpacity: s.lineOpacity * 0.9,
    glow: true,
  };
  return { primary, secondary };
}
