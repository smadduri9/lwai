import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { MermaidDiagram } from "./MermaidDiagram";

interface ImageHit {
  url: string;
  thumb: string;
  title: string;
}

/** Resolved `image-search:` queries, shared across all messages. */
const imageSearchCache = new Map<string, Promise<ImageHit[]>>();

function resolveImageSearch(query: string): Promise<ImageHit[]> {
  let pending = imageSearchCache.get(query);
  if (!pending) {
    pending = fetch(`/api/images?q=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ images?: ImageHit[] }>) : null))
      .then((json) => json?.images ?? [])
      .catch(() => []);
    imageSearchCache.set(query, pending);
  }
  return pending;
}

function searchQueryFrom(src: string): string {
  const raw = src.slice("image-search:".length).replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * `image-search:<query>` gallery: up to 4 relevant images in a 2x2 grid,
 * each clickable to its full-size original. Cells that fail to load drop
 * out individually; the whole block disappears if nothing loads.
 * (Spans with block/grid display keep the markup valid inside <p>.)
 */
function SearchGallery({ query, alt }: { query: string; alt?: string }) {
  const [hits, setHits] = useState<ImageHit[] | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void resolveImageSearch(query).then((results) => {
      if (!cancelled) setHits(results);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (hits === null) {
    return (
      <span className="my-2 grid w-full max-w-md grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="block aspect-[4/3] animate-pulse rounded-lg border border-ivory-300 bg-ivory-200"
          />
        ))}
      </span>
    );
  }

  const visible = hits.filter((h) => !broken.has(h.thumb));
  if (visible.length === 0) return null;

  return (
    <span className="my-2 grid w-full max-w-md grid-cols-2 gap-1.5">
      {visible.map((hit) => (
        <span
          key={hit.thumb}
          className="block overflow-hidden rounded-lg border border-ivory-300 bg-card shadow-sm"
        >
          <img
            data-chat-image
            src={hit.thumb || hit.url}
            alt={alt ? `${alt} — ${hit.title}` : hit.title}
            title={`${hit.title} — click to add to note`}
            loading="lazy"
            onError={() =>
              setBroken((prev) => {
                const next = new Set(prev);
                next.add(hit.thumb);
                return next;
              })
            }
            className="aspect-[4/3] w-full cursor-pointer object-cover"
          />
        </span>
      ))}
    </span>
  );
}

/**
 * Markdown image: rounded and bordered, lazy, click to open full size, and
 * silently removed if it fails to load. `image-search:<query>` sources
 * render a 4-image gallery resolved through /api/images.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return null;
  if (src.startsWith("image-search:")) {
    return <SearchGallery query={searchQueryFrom(src)} alt={alt} />;
  }
  return (
    <span className="my-2 block w-fit">
      <img
        data-chat-image
        src={src}
        alt={alt ?? ""}
        title={alt ? `${alt} — click to add to note` : "Click to add to note"}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-80 max-w-full cursor-pointer rounded-lg border border-ivory-300 bg-card shadow-sm"
      />
    </span>
  );
}

/** Extract raw text from a react-markdown children tree (for copy buttons). */
function childrenToText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childrenToText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * Copy-to-clipboard chip. Renders NO text nodes (label via CSS pseudo-element)
 * so it never pollutes the anchor text model used for highlight offsets.
 */
function CopyChip({ getText, className = "" }: { getText: () => string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      data-copied={copied || undefined}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={`copy-chip ${className}`.trim()}
    />
  );
}

/** Fenced code block with a hover Copy button; ```mermaid renders a diagram. */
function CodeBlock({ children, ...rest }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  const props =
    child && typeof child === "object" && "props" in child
      ? (child as { props: { className?: string; children?: ReactNode } }).props
      : null;
  const language = /language-([\w-]+)/.exec(props?.className ?? "")?.[1];
  const source = childrenToText(children).replace(/\n$/, "");

  if (language === "mermaid") {
    return <MermaidDiagram source={source} />;
  }

  return (
    <span className="group/code relative block">
      <pre
        className="my-2 overflow-x-auto rounded-lg border border-ivory-300 bg-ivory-100 p-3 font-mono text-[13px] leading-relaxed"
        {...rest}
      >
        {children}
      </pre>
      <CopyChip
        getText={() => source}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100"
      />
    </span>
  );
}

/**
 * Decorate KaTeX display-math blocks with a Copy chip that copies the original
 * LaTeX source (KaTeX keeps it in the MathML <annotation> element). Runs after
 * every content change; idempotent; buttons carry no text nodes.
 */
function useMathCopyButtons(ref: React.RefObject<HTMLDivElement | null>, content: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const block of root.querySelectorAll<HTMLElement>(".katex-display")) {
      const host = block.parentElement;
      if (!host || host.querySelector(":scope > button.copy-chip")) continue;
      host.style.position = "relative";
      host.classList.add("math-copy-host");
      const source =
        block.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
      if (!source.trim()) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-chip math-copy-chip";
      btn.setAttribute("aria-label", "Copy LaTeX");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(source).then(() => {
          btn.dataset.copied = "true";
          setTimeout(() => delete btn.dataset.copied, 1400);
        });
      });
      host.appendChild(btn);
    }
  }, [ref, content]);
}

/**
 * Renders assistant markdown with Claude-ish typography, LaTeX math (KaTeX),
 * syntax-highlighted code, and mermaid diagrams. Memoized on content so the
 * highlight effect's DOM mutations (marks/badges) are never reconciled away
 * by React while content is stable.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useMathCopyButtons(rootRef, content);
  return (
    <div ref={rootRef}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeKatex, { throwOnError: false }],
        [rehypeHighlight, { detect: false }],
      ]}
      // Let the custom image-search: scheme through the sanitizer.
      urlTransform={(url) =>
        url.startsWith("image-search:") ? url : defaultUrlTransform(url)
      }
      components={{
        img: (p) => <MarkdownImage src={typeof p.src === "string" ? p.src : undefined} alt={p.alt} />,
        h1: (p) => <h1 className="mt-4 mb-2 font-serif text-xl font-semibold first:mt-0" {...p} />,
        h2: (p) => <h2 className="mt-4 mb-2 font-serif text-lg font-semibold first:mt-0" {...p} />,
        h3: (p) => <h3 className="mt-3 mb-1.5 font-serif text-base font-semibold first:mt-0" {...p} />,
        h4: (p) => <h4 className="mt-3 mb-1 text-[15px] font-semibold first:mt-0" {...p} />,
        p: (p) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
        ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
        li: (p) => <li className="[&>p]:my-0.5" {...p} />,
        blockquote: (p) => (
          <blockquote className="my-2 border-l-2 border-ivory-300 pl-3 text-ink-500 italic" {...p} />
        ),
        a: (p) => (
          <a
            className="text-clay-600 underline decoration-clay-500/40 underline-offset-2 hover:decoration-clay-500"
            target="_blank"
            rel="noreferrer"
            {...p}
          />
        ),
        code: (p) => {
          const inPre = /language-/.test(p.className ?? "");
          return inPre ? (
            <code {...p} className={`${p.className ?? ""} font-mono text-[13px]`} />
          ) : (
            <code
              {...p}
              className="rounded bg-ivory-200 px-1 py-0.5 font-mono text-[13px] text-ink-700"
            />
          );
        },
        pre: (p) => <CodeBlock {...p} />,
        table: (p) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...p} />
          </div>
        ),
        th: (p) => (
          <th className="border border-ivory-300 bg-ivory-100 px-2.5 py-1.5 text-left font-semibold" {...p} />
        ),
        td: (p) => <td className="border border-ivory-300 px-2.5 py-1.5 align-top" {...p} />,
        hr: () => <hr className="my-4 border-ivory-300" />,
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
});
