import { useMemo } from "react";
import { extractNoteHeadings } from "../lib/noteOutline";
import type { NotebookEntry } from "../types";

/**
 * Heading outline for the active notebook (H1 / H2 jump links).
 */
export function NotebookOutline({
  notebook,
  className = "",
}: {
  notebook: NotebookEntry | null;
  className?: string;
}) {
  const raw = notebook ? notebook.body.trim() : "";
  const { items } = useMemo(() => extractNoteHeadings(raw), [raw]);

  const jump = (headingId: string) => {
    if (!notebook) return;
    const el = document.querySelector<HTMLElement>(
      `[data-note-body="${notebook.id}"] [data-heading-id="${headingId}"]`,
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <aside
      className={`flex min-h-0 w-full flex-col self-stretch rounded-xl border border-ivory-200/80 bg-ivory-50/90 backdrop-blur ${className}`}
    >
      <div className="flex shrink-0 items-center border-b border-ivory-200/80 px-3 py-2">
        <p className="text-[11px] font-medium tracking-wide text-ink-400 uppercase">
          Outline
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!notebook ? (
          <p className="px-3 py-5 text-center text-[11px] leading-relaxed text-ink-400">
            No notebook selected yet.
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-ink-400">
            Add Heading 1 or 2 in the notebook to build an outline.
          </p>
        ) : (
          items.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => jump(h.id)}
              style={{ paddingLeft: 10 + (h.level === 2 ? 14 : 0) }}
              className="flex w-full items-start gap-1.5 border-l-2 border-transparent py-1.5 pr-2 text-left text-[12px] text-ink-600 transition-colors hover:bg-ivory-100/80 hover:text-ink-800"
              title={h.text}
            >
              <span className="mt-0.5 shrink-0 text-[9px] text-ink-400">
                {h.level === 1 ? "H1" : "H2"}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{h.text}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
