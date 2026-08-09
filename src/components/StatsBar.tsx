import { useMemo, useState } from "react";
import { useChatStore } from "../store/chatStore";
import { useStatsStore } from "../store/statsStore";
import type { Branch } from "../types";

const STORE_KEY = "subchat-reader-store";

function fmtTokens(n: number | undefined): string {
  if (n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Output tokens per second of generation time (after the first token). */
function tokensPerSec(outputTokens?: number, durationMs?: number, ttftMs?: number): number | undefined {
  if (!outputTokens || !durationMs) return undefined;
  const genMs = durationMs - (ttftMs ?? 0);
  if (genMs <= 0) return undefined;
  return outputTokens / (genMs / 1000);
}

function branchDepth(branches: Record<string, Branch>, id: string): number {
  let depth = 0;
  let cur = branches[id];
  while (cur?.parentBranchId) {
    depth += 1;
    cur = branches[cur.parentBranchId];
  }
  return depth;
}

/**
 * Slim collapsible dev-stats readout for the header: one compact line by
 * default, click to expand the full panel (tokens, timing, tree, storage).
 */
export function StatsBar() {
  const [open, setOpen] = useState(false);
  const last = useStatsStore((s) => s.last);
  const session = useStatsStore((s) => s.session);
  const branches = useChatStore((s) => s.branches);

  const tree = useMemo(() => {
    const all = Object.values(branches);
    const subChats = all.filter((b) => b.window !== null);
    return {
      subChats: subChats.length,
      maxDepth: Math.max(0, ...subChats.map((b) => branchDepth(branches, b.id))),
      messages: all.reduce((n, b) => n + b.messages.length, 0),
    };
  }, [branches]);

  // Only worth computing while the panel is visible.
  const storageBytes = useMemo(() => {
    if (!open) return 0;
    try {
      return new Blob([localStorage.getItem(STORE_KEY) ?? ""]).size;
    } catch {
      return 0;
    }
  }, [open, branches]);

  const tps = tokensPerSec(last?.outputTokens, last?.durationMs, last?.ttftMs);

  const summary =
    session.responses === 0 && !last
      ? "stats"
      : [
          `${fmtTokens(session.inputTokens)} in / ${fmtTokens(session.outputTokens)} out`,
          tps !== undefined ? `${tps.toFixed(0)} tok/s` : null,
          `${tree.subChats} branch${tree.subChats === 1 ? "" : "es"}`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-ink-500 transition-colors hover:bg-ivory-200 hover:text-ink-800"
        title="Session stats"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {summary}
      </button>

      {open && (
        <div className="absolute top-full left-1/2 z-[100] mt-1.5 w-[560px] max-w-[90vw] -translate-x-1/2 rounded-lg border border-ivory-300 bg-ivory-50 p-4 font-mono text-[11px] shadow-lg shadow-ink-900/10 backdrop-blur-md dark:bg-neutral-900">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <StatSection title="Last response">
              <StatRow label="model" value={last?.model ?? "—"} />
              <StatRow
                label="tokens"
                value={`${fmtTokens(last?.inputTokens)} in / ${fmtTokens(last?.outputTokens)} out`}
              />
              <StatRow label="first token" value={fmtMs(last?.ttftMs)} />
              <StatRow label="total time" value={fmtMs(last?.durationMs)} />
              <StatRow label="gen speed" value={tps !== undefined ? `${tps.toFixed(1)} tok/s` : "—"} />
              <StatRow label="web searches" value={String(last?.searches ?? 0)} />
              <StatRow label="code runs" value={String(last?.codeRuns ?? 0)} />
            </StatSection>

            <StatSection title="Session">
              <StatRow label="responses" value={String(session.responses)} />
              <StatRow
                label="tokens"
                value={`${fmtTokens(session.inputTokens)} in / ${fmtTokens(session.outputTokens)} out`}
              />
              <StatRow label="web searches" value={String(session.searches)} />
              <StatRow label="code runs" value={String(session.codeRuns)} />
            </StatSection>

            <StatSection title="Context sent (last request)">
              <StatRow label="messages" value={String(last?.contextMessages ?? "—")} />
              <StatRow
                label="characters"
                value={last?.contextChars !== undefined ? last.contextChars.toLocaleString() : "—"}
              />
            </StatSection>

            <StatSection title="Tree / storage">
              <StatRow label="asks" value={String(tree.subChats)} />
              <StatRow label="max depth" value={String(tree.maxDepth)} />
              <StatRow label="messages" value={String(tree.messages)} />
              <StatRow label="localStorage" value={fmtBytes(storageBytes)} />
            </StatSection>
          </div>
        </div>
      )}
    </div>
  );
}

function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-ink-400 uppercase">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-ink-400">{label}</span>
      <span className="text-right text-ink-800">{value}</span>
    </div>
  );
}
