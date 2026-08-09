import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CURATED_MODELS,
  findCatalogModel,
  type ModelCapabilities,
  type ProviderId,
} from "../../shared/modelCatalog";

export type { ProviderId, ModelCapabilities };

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  thinkingModes: string[];
  defaultThinking: string;
  capabilities: ModelCapabilities;
  available: boolean;
}

/** Local-first: default to the local provider, auto-picking an installed model. */
export const DEFAULT_MODEL_ID = "auto";
export const DEFAULT_PROVIDER: ProviderId = "local";
export const DEFAULT_THINKING = "";

const KNOWN_PROVIDERS: ProviderId[] = ["local", "anthropic", "openai", "gemini"];

interface ModelStore {
  provider: ProviderId;
  modelId: string;
  thinkingLevel: string;
  models: ModelInfo[];
  providersAvailable: Record<ProviderId, boolean>;
  setModel: (provider: ProviderId, modelId: string) => void;
  setThinkingLevel: (level: string) => void;
  /** Pass force=true to retry after a failed load. */
  loadModels: (force?: boolean) => Promise<void>;
}

let loadInFlight = false;
let loadSucceeded = false;

function catalogFallback(): ModelInfo[] {
  return CURATED_MODELS.map((m) => ({
    ...m,
    available: false,
  }));
}

/** Global model choice for all branches, persisted across sessions. */
export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      provider: DEFAULT_PROVIDER,
      modelId: DEFAULT_MODEL_ID,
      thinkingLevel: DEFAULT_THINKING,
      models: catalogFallback(),
      providersAvailable: {
        local: false,
        anthropic: false,
        openai: false,
        gemini: false,
      },
      setModel: (provider, modelId) => {
        const entry =
          get().models.find((m) => m.id === modelId && m.provider === provider) ??
          findCatalogModel(modelId);
        const thinkingLevel = entry?.defaultThinking ?? "";
        set({ provider, modelId, thinkingLevel });
      },
      setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
      loadModels: async (force = false) => {
        if (loadInFlight) return;
        if (loadSucceeded && !force) return;
        loadInFlight = true;
        try {
          const r = await fetch("/api/models");
          if (!r.ok) {
            loadSucceeded = false;
            return;
          }
          const json = (await r.json()) as {
            models?: ModelInfo[];
            providers?: Record<ProviderId, boolean>;
          };
          if (json.models?.length) {
            set({
              models: json.models,
              providersAvailable: json.providers ?? get().providersAvailable,
            });
            loadSucceeded = true;
          } else {
            loadSucceeded = false;
          }
        } catch {
          loadSucceeded = false;
        } finally {
          loadInFlight = false;
        }
      },
    }),
    {
      name: "subchat-model",
      partialize: (s) => ({
        provider: s.provider,
        modelId: s.modelId,
        thinkingLevel: s.thinkingLevel,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Omit<Partial<ModelStore>, "provider"> & {
          provider?: string;
        };
        let modelId = p.modelId ?? DEFAULT_MODEL_ID;
        const catalog = findCatalogModel(modelId);
        // Sanitize persisted provider: old builds stored "ollama"; anything
        // outside the known set would crash the picker with a blank page.
        let provider: ProviderId;
        const raw = p.provider === "ollama" ? "local" : p.provider;
        if (raw && KNOWN_PROVIDERS.includes(raw as ProviderId)) {
          provider = raw as ProviderId;
        } else if (catalog) {
          provider = catalog.provider;
        } else {
          provider = DEFAULT_PROVIDER;
          modelId = DEFAULT_MODEL_ID;
        }
        const thinkingLevel =
          p.thinkingLevel ?? catalog?.defaultThinking ?? DEFAULT_THINKING;
        return { ...current, ...p, modelId, provider, thinkingLevel };
      },
    },
  ),
);

export function shortModelLabel(name: string): string {
  return name
    .replace(/^Claude\s+/i, "")
    .replace(/^Gemini\s+/i, "")
    .replace(/^GPT-/i, "GPT-");
}
