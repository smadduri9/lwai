import type { RefObject } from "react";
import { PatternLayer } from "./PatternLayer";

/**
 * Mounts the constellation background (decorative, z-index -1).
 * Strictly a singleton — PatternLayer suppresses any duplicate mount.
 */
export function BackgroundEffect({
  orbitRef,
  hoverEnabled = true,
  landing = false,
}: {
  orbitRef?: RefObject<HTMLElement | null>;
  hoverEnabled?: boolean;
  /** @deprecated Kept for call-site compat. */
  landing?: boolean;
}) {
  return <PatternLayer orbitRef={orbitRef} hoverEnabled={hoverEnabled} landing={landing} />;
}
