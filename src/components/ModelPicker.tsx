import { useEffect, useMemo, useRef, useState } from "react";
import {
  shortModelLabel,
  useModelStore,
  type ModelInfo,
  type ProviderId,
} from "../store/modelStore";

const PROVIDERS: Array<{ id: ProviderId; label: string; hint: string }> = [
  { id: "local", label: "Local", hint: "Start Ollama or LM Studio" },
  { id: "anthropic", label: "Claude", hint: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", hint: "OPENAI_API_KEY" },
  { id: "gemini", label: "Gemini", hint: "GEMINI_API_KEY" },
];

const COMPOSER_CLEARANCE = 112;

/**
 * Four-column file-tree model menu (tabs on narrow screens).
 */
export function ModelPicker({ compact = false }: { compact?: boolean } = {}) {
  const provider = useModelStore((s) => s.provider);
  const modelId = useModelStore((s) => s.modelId);
  const models = useModelStore((s) => s.models);
  const providersAvailable = useModelStore((s) => s.providersAvailable);
  const setModel = useModelStore((s) => s.setModel);
  const loadModels = useModelStore((s) => s.loadModels);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ProviderId>(provider);
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number }>({
    bottom: COMPOSER_CLEARANCE,
    left: 12,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (!open) return;
    setTab(provider);
    // Retry catalog if still unavailable (e.g. first fetch during server restart).
    const anyAvailable = Object.values(providersAvailable).some(Boolean);
    if (!anyAvailable) void loadModels(true);

    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(920, window.innerWidth * 0.96);
      setPanelPos({
        bottom: Math.max(COMPOSER_CLEARANCE, window.innerHeight - rect.top + 8),
        left: Math.min(
          Math.max(rect.left + rect.width / 2 - width / 2, 12),
          window.innerWidth - width - 12,
        ),
      });
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, provider, providersAvailable, loadModels]);

  const current = useMemo(
    () => models.find((m) => m.id === modelId && m.provider === provider),
    [models, modelId, provider],
  );

  const triggerLabel = current ? shortModelLabel(current.name) : modelId;

  const byProvider = useMemo(() => {
    const map: Record<ProviderId, ModelInfo[]> = {
      local: [],
      anthropic: [],
      openai: [],
      gemini: [],
    };
    for (const m of models) map[m.provider]?.push(m);
    return map;
  }, [models]);

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        title="Choose model"
        onClick={() => setOpen((o) => !o)}
        className={`cursor-pointer truncate whitespace-nowrap rounded-full border border-ivory-300 bg-card font-medium text-ink-700 shadow-sm outline-none transition-colors hover:border-clay-500/50 hover:text-clay-600 ${
          compact
            ? "h-8 max-w-[7.5rem] px-2.5 text-[11px]"
            : "h-[38px] max-w-48 px-3 text-xs"
        }`}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed z-[100] flex max-h-[min(420px,calc(100vh-8rem))] w-[min(920px,96vw)] flex-col overflow-hidden rounded-xl border border-ivory-300 bg-card shadow-xl shadow-ink-900/15"
          style={{ bottom: panelPos.bottom, left: panelPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex border-b border-ivory-200 md:hidden">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTab(p.id)}
                className={`flex-1 px-2 py-2 text-[11px] font-medium ${
                  tab === p.id
                    ? "border-b-2 border-clay-500 text-clay-700"
                    : "text-ink-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="hidden min-h-0 flex-1 grid-cols-4 divide-x divide-ivory-200 md:grid">
            {PROVIDERS.map((p) => (
              <ProviderColumn
                key={p.id}
                label={p.label}
                hint={p.hint}
                available={providersAvailable[p.id] ?? false}
                models={byProvider[p.id] ?? []}
                selectedId={provider === p.id ? modelId : null}
                onSelect={(m) => {
                  setModel(p.id, m.id);
                }}
                onRetry={() => void loadModels(true)}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
            {(() => {
              const p = PROVIDERS.find((x) => x.id === tab) ?? PROVIDERS[0];
              return (
                <ProviderColumn
                  label={p.label}
                  hint={p.hint}
                  available={providersAvailable[p.id] ?? false}
                  models={byProvider[p.id] ?? []}
                  selectedId={provider === tab ? modelId : null}
                  onSelect={(m) => {
                    setModel(tab, m.id);
                  }}
                  onRetry={() => void loadModels(true)}
                  solo
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderColumn({
  label,
  hint,
  available,
  models,
  selectedId,
  onSelect,
  onRetry,
  solo,
}: {
  label: string;
  hint: string;
  available: boolean;
  models: ModelInfo[];
  selectedId: string | null;
  onSelect: (m: ModelInfo) => void;
  onRetry: () => void;
  solo?: boolean;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col ${solo ? "" : "max-h-[320px]"} ${
        available ? "" : "opacity-55"
      }`}
    >
      <div className="shrink-0 border-b border-ivory-100 px-2.5 py-1.5">
        <p className="text-[11px] font-semibold text-ink-700">{label}</p>
        {!available && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-0.5 text-left text-[9px] leading-snug text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
          >
            Add {hint} to .env · Retry
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {models.length === 0 ? (
          <p className="px-2.5 py-3 text-[10px] text-ink-400">
            {available ? "No models" : "Unavailable"}
          </p>
        ) : (
          models.map((m) => {
            const selected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!m.available}
                onClick={() => {
                  if (!m.available) return;
                  onSelect(m);
                }}
                className={`flex w-full flex-col px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                  selected
                    ? "bg-clay-50 text-clay-800"
                    : m.available
                      ? "text-ink-700 hover:bg-ivory-50"
                      : "cursor-not-allowed text-ink-400"
                }`}
              >
                <span className="font-medium leading-tight">{shortModelLabel(m.name)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
