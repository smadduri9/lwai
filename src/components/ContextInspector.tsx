import { useMemo, useState } from "react";
import { useChatStore } from "../store/chatStore";
import { useModelStore } from "../store/modelStore";
import {
  buildApiMessages,
  buildSystemContext,
  contextBudgetChars,
  describeContext,
} from "../lib/context";

function fmtChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * Collapsible per-sub-chat readout of the exact context assembled for the
 * API. Two views: an annotated origin list, and the exact JSON payload
 * (post-budgeting, including the per-thread system block) that will be sent.
 * Mounted in every sub-chat surface: docked card, floating window, and
 * fullscreen branch tab.
 */
export function ContextInspector({ branchId }: { branchId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"origins" | "json">("origins");
  const branches = useChatStore((s) => s.branches);
  const provider = useModelStore((s) => s.provider);
  const desc = useMemo(() => describeContext(branches, branchId), [branches, branchId]);

  const exactPayload = useMemo(() => {
    if (!open || view !== "json") return "";
    const budgetChars = contextBudgetChars(provider);
    const messages = buildApiMessages(branches, branchId, { budgetChars });
    const system = buildSystemContext(branches, branchId);
    return JSON.stringify({ system: system ?? null, messages }, null, 2);
  }, [open, view, branches, branchId, provider]);

  const summary = [
    `${desc.messageCount} msgs`,
    `${fmtChars(desc.totalChars)} chars`,
    `${desc.inheritedCount} inherited${desc.hasAnchor ? " + quote" : ""} + ${desc.ownCount} here`,
  ].join(" · ");

  return (
    <div className="border-b border-ivory-200 bg-ivory-50/60 font-mono text-[10px]">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-ink-400 transition-colors hover:bg-ivory-100 hover:text-ink-700"
        title="Context sent to the model for this sub-chat"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="truncate">ctx: {summary}</span>
      </button>

      {open && (
        <div className="border-t border-ivory-200">
          <div className="flex gap-1 px-3 pt-1">
            {(["origins", "json"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setView(v);
                }}
                className={`rounded px-1.5 py-0.5 ${
                  view === v
                    ? "bg-ink-900/10 font-semibold text-ink-700"
                    : "text-ink-400 hover:text-ink-700"
                }`}
              >
                {v === "origins" ? "origins" : "exact payload"}
              </button>
            ))}
          </div>

          {view === "origins" ? (
            <ol className="max-h-44 overflow-y-auto px-3 py-1.5">
              {desc.items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-1.5 py-0.5">
                  <span
                    className={`shrink-0 rounded-sm px-1 font-semibold ${
                      item.role === "user"
                        ? "bg-clay-500/15 text-clay-600"
                        : "bg-ink-900/10 text-ink-700"
                    }`}
                  >
                    {item.role === "user" ? "usr" : "ast"}
                  </span>
                  <span className="shrink-0 text-ink-400">[{item.origins.join(" + ")}]</span>
                  <span className="min-w-0 flex-1 truncate text-ink-600">{item.preview}</span>
                  <span className="shrink-0 text-ink-400">{fmtChars(item.chars)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <pre className="max-h-56 overflow-auto px-3 py-1.5 text-[10px] leading-snug whitespace-pre-wrap text-ink-600 select-text">
              {exactPayload}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
