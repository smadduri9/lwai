import { useState } from "react";
import { CodeSandbox } from "./CodeSandbox";
import { MermaidDiagram } from "./MermaidDiagram";
import type { Artifact } from "../types";

type ToolArtifact = Extract<Artifact, { kind: "tool" }>;

function parseInput(input: string): Record<string, unknown> {
  try {
    return input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toolLabel(a: ToolArtifact, input: Record<string, unknown>): string {
  const running = a.status === "running";
  switch (a.name) {
    case "execute_code":
      return running ? "🧠 Executing code…" : "🧠 Code sandbox";
    case "generate_diagram":
      return running ? "📊 Drawing diagram…" : "📊 Diagram";
    case "fetch_image": {
      const queries = Array.isArray(input.queries)
        ? (input.queries as unknown[]).filter((q): q is string => typeof q === "string")
        : typeof input.query === "string"
          ? [input.query]
          : [];
      const label =
        queries.length > 1
          ? `${queries.length} subjects`
          : queries[0]
            ? `“${queries[0]}”`
            : "";
      return running ? `🖼️ Fetching ${label || "images"}…` : `🖼️ Images ${label ? `— ${label}` : ""}`;
    }
    case "fetch_url_content": {
      const url = typeof input.url === "string" ? shortUrl(input.url) : "";
      return running ? `🌐 Reading ${url || "URL"}…` : `🌐 Read ${url || "URL"}`;
    }
    case "web_search": {
      const q = typeof input.query === "string" ? input.query : "";
      return running ? `🔍 Searching ${q ? `“${q}”` : "the web"}…` : `🔍 Searched ${q ? `“${q}”` : "the web"}`;
    }
    default:
      return running ? `⚙️ Running ${a.name}…` : `⚙️ ${a.name}`;
  }
}

interface ImageHit {
  url: string;
  thumb: string;
  title: string;
}

/**
 * Parse the fetch_image tool result: Markdown `![title](url)` lines (current)
 * or the legacy JSON `{images:[…]}` payload. Tolerates malformed output.
 */
function parseImageHits(output?: string): ImageHit[] {
  if (!output) return [];
  try {
    const json = JSON.parse(output) as { images?: ImageHit[] };
    if (Array.isArray(json.images)) {
      return json.images.filter((h) => typeof h?.url === "string" && /^https?:\/\//.test(h.url));
    }
  } catch {
    // Not JSON — fall through to Markdown parsing.
  }
  const hits: ImageHit[] = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output))) {
    hits.push({ title: m[1], url: m[2], thumb: m[2] });
  }
  return hits;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname.slice(0, 24) : "");
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * One standard tool call: elegant loading state that resolves into a
 * collapsible detail box showing the exact input/output parameters.
 * Rendered identically in main chat, docked cards, floating windows, and
 * fullscreen branch tabs (all via MessageBubble).
 */
export function ToolCallCard({ artifact }: { artifact: ToolArtifact }) {
  const [open, setOpen] = useState(false);
  const input = parseInput(artifact.input);
  const running = artifact.status === "running";
  const failed = artifact.status === "error";
  const label = toolLabel(artifact, input);

  // Diagram source: prefer the (linted) tool output; fall back to the raw
  // input source even on empty output or error so MermaidDiagram's own
  // validation/error-boundary can render either the SVG or a clean fallback.
  const diagramSource =
    artifact.name === "generate_diagram" && !running
      ? artifact.output?.trim() || (typeof input.mermaid === "string" ? input.mermaid : "")
      : "";

  const isSandbox = artifact.name === "execute_code";
  const imageHits =
    artifact.name === "fetch_image" && artifact.status === "done"
      ? parseImageHits(artifact.output)
      : [];

  return (
    <div
      data-tool-card
      data-anchor-skip
      className={`my-2 overflow-hidden rounded-lg border ${
        failed ? "border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/20" : "border-ivory-300 bg-ivory-50"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-[11px] text-ink-500 transition-colors hover:bg-ivory-100 hover:text-ink-800"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className={`min-w-0 flex-1 truncate ${running ? "tool-card-pulse" : ""}`}>
          {label}
          {failed ? " · failed" : ""}
        </span>
        {running && (
          <span className="inline-flex gap-1" aria-hidden>
            <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:0ms]" />
            <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:150ms]" />
            <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:300ms]" />
          </span>
        )}
      </button>

      {diagramSource && (
        <div className="border-t border-ivory-200 px-3 pb-1">
          <MermaidDiagram
            source={diagramSource}
            title={typeof input.title === "string" ? input.title : undefined}
          />
        </div>
      )}

      {/* Interactive mini-IDE: read, edit, and re-run the model's code locally. */}
      {isSandbox && typeof input.code === "string" && input.code && (
        <CodeSandbox
          language={typeof input.language === "string" ? input.language : "python"}
          code={input.code}
          autoRunOutput={artifact.output}
          autoRunFailed={failed}
        />
      )}

      {imageHits.length > 0 && (
        <div className="grid max-w-md grid-cols-2 gap-1.5 border-t border-ivory-200 p-3">
          {imageHits.map((hit) => (
            <span
              key={hit.thumb || hit.url}
              className="block overflow-hidden rounded-lg border border-ivory-300 bg-card shadow-sm"
            >
              <img
                data-chat-image
                src={hit.thumb || hit.url}
                alt={hit.title}
                title={`${hit.title} — click to add to note`}
                loading="lazy"
                className="aspect-[4/3] w-full cursor-pointer object-cover"
              />
            </span>
          ))}
        </div>
      )}

      {open && !isSandbox && (
        <div className="border-t border-ivory-200">
          <div className="px-3 pt-1.5 pb-0.5 font-mono text-[10px] tracking-wide text-ink-400 uppercase">
            Input
          </div>
          <pre className="code-block-surface max-h-56 overflow-auto px-3 pb-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            <code>{JSON.stringify(input, null, 2)}</code>
          </pre>
          {artifact.output !== undefined && artifact.name !== "generate_diagram" && (
            <>
              <div className="border-t border-ivory-200 px-3 pt-1.5 pb-0.5 font-mono text-[10px] tracking-wide text-ink-400 uppercase">
                Output
              </div>
              <pre className="code-block-surface max-h-56 overflow-auto px-3 pb-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                <code>{artifact.output || "(no output)"}</code>
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
