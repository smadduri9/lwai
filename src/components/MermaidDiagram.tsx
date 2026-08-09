import { Component, useEffect, useRef, useState, type ReactNode } from "react";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
let seq = 0;

/** Debounce re-render while the fence is still streaming in. */
const RENDER_DEBOUNCE_MS = 250;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Never inject mermaid's error "bomb" SVG into the document.
        suppressErrorRendering: true,
        theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        fontFamily: "inherit",
      });
      return m;
    });
  }
  return mermaidPromise;
}

/**
 * Imperative renderer for non-React hosts (the notebook's contentEditable
 * body). Uses the exact same mermaid config + parse pre-validation as the
 * chat's MermaidDiagram. Returns false (host untouched) on invalid source.
 */
export async function renderMermaidInto(host: HTMLElement, source: string): Promise<boolean> {
  try {
    const m = await loadMermaid();
    const text = source.trim();
    if (!text) return false;
    const ok = await m.default.parse(text, { suppressErrors: true }).catch(() => false);
    if (!ok) return false;
    const { svg } = await m.default.render(`mermaid-${++seq}`, text);
    host.innerHTML = svg;
    const el = host.querySelector("svg");
    if (el) {
      el.removeAttribute("height");
      el.style.maxWidth = "100%";
    }
    return true;
  } catch {
    return false;
  }
}

function SourceFallback({ source, invalid }: { source: string; invalid: boolean }) {
  return (
    <span data-anchor-skip className="my-2 block">
      {invalid && (
        <span className="mb-1 inline-block rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          Invalid diagram syntax
        </span>
      )}
      <pre className="overflow-x-auto rounded-lg border border-ivory-300 bg-ivory-100 p-3 font-mono text-[13px] leading-relaxed">
        <code>{source}</code>
      </pre>
    </span>
  );
}

/** Second net: a rendering crash inside mermaid must never take down the app. */
class MermaidErrorBoundary extends Component<
  { source: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { source: string }) {
    if (prev.source !== this.props.source && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <SourceFallback source={this.props.source} invalid />;
    }
    return this.props.children;
  }
}

function MermaidDiagramInner({ source, title }: { source: string; title?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadMermaid()
        .then(async (m) => {
          const text = source.trim();
          // Validate before render — invalid (or still-streaming) source falls
          // back to a plain code block instead of throwing.
          const ok = await m.default
            .parse(text, { suppressErrors: true })
            .catch(() => false);
          if (cancelled) return;
          if (!ok) {
            setInvalid(true);
            setRendered(false);
            return;
          }
          const id = `mermaid-${++seq}`;
          const { svg } = await m.default.render(id, text);
          if (!cancelled && hostRef.current) {
            hostRef.current.innerHTML = svg;
            const el = hostRef.current.querySelector("svg");
            if (el) {
              el.removeAttribute("height");
              el.style.maxWidth = "100%";
            }
            setInvalid(false);
            setRendered(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setInvalid(true);
            setRendered(false);
          }
        });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  const copy = () => {
    void navigator.clipboard.writeText(source.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  if (invalid) {
    return <SourceFallback source={source} invalid />;
  }

  return (
    <span
      data-anchor-skip
      data-mermaid-source={source.trim()}
      className="group/diagram relative my-2 block w-full overflow-x-auto rounded-lg border border-ivory-300 bg-card p-3"
    >
      {title ? (
        <span className="mb-1 block text-xs font-medium text-ink-500">{title}</span>
      ) : null}
      <span ref={hostRef} data-mermaid-diagram className="block" aria-label={title ?? "Diagram"} />
      {!rendered && (
        <span className="block py-2 text-xs text-ink-400 italic">Rendering diagram…</span>
      )}
      <button
        type="button"
        aria-label="Copy diagram source"
        data-copied={copied || undefined}
        onClick={copy}
        className="copy-chip absolute top-1.5 right-1.5 opacity-0 group-hover/diagram:opacity-100"
      />
    </span>
  );
}

/**
 * Renders Mermaid source as an inline SVG diagram (lazy-loads the library).
 * Parse-validates first; invalid syntax falls back to the raw source in a
 * code block with an "Invalid diagram syntax" badge — no error SVG bombs.
 */
export function MermaidDiagram({ source, title }: { source: string; title?: string }) {
  return (
    <MermaidErrorBoundary source={source}>
      <MermaidDiagramInner source={source} title={title} />
    </MermaidErrorBoundary>
  );
}
