/**
 * Wikimedia Commons image search, shared by the /api/images middleware (the
 * legacy `image-search:` markdown scheme) and the `fetch_image` tool executor.
 */

export interface ImageHit {
  /** Full-resolution original (may be TIFF or tens of MB — not for <img> tags). */
  url: string;
  /** 800px scaled rendition — always a browser-renderable format; use for display. */
  thumb: string;
  title: string;
}

/** Formats browsers can decode natively — originals outside this set need a thumb. */
const RENDERABLE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const imageSearchCache = new Map<string, ImageHit[]>();

/** Cached wrapper — Wikimedia results are stable enough to memoize per query. */
export async function searchWikimediaCached(query: string): Promise<ImageHit[]> {
  const key = query.trim().toLowerCase();
  if (!imageSearchCache.has(key)) {
    imageSearchCache.set(key, await searchWikimedia(query));
  }
  return imageSearchCache.get(key) ?? [];
}

export async function searchWikimedia(query: string): Promise<ImageHit[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "800",
    format: "json",
  });
  try {
    const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "user-agent": "subchat-reader-dev/1.0" },
    });
    if (!r.ok) return [];
    const json = (await r.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            index?: number;
            imageinfo?: Array<{ thumburl?: string; url?: string; mime?: string }>;
          }
        >;
      };
    };
    const pages = Object.values(json.query?.pages ?? {}).sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const hits: ImageHit[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.mime?.startsWith("image/") || info.mime === "image/svg+xml") continue;
      // Wikimedia's thumburl is a scaled JPEG/PNG even when the original is a
      // TIFF; without it, only originals the browser can decode are usable.
      const thumb =
        info.thumburl ?? (RENDERABLE_MIME.has(info.mime) ? info.url : undefined);
      if (!thumb || seen.has(thumb)) continue;
      seen.add(thumb);
      hits.push({
        url: info.url ?? thumb,
        thumb,
        title: (page.title ?? query).replace(/^File:/, ""),
      });
      if (hits.length === 4) break;
    }
    return hits;
  } catch {
    return [];
  }
}
