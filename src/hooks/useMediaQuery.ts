import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Breakpoints where each comment rail is visible (right shows first). */
export const RIGHT_RAIL_QUERY = "(min-width: 1024px)";
export const LEFT_RAIL_QUERY = "(min-width: 1280px)";
