/** Shared types for multi-provider chat proxy (server + client catalog). */

export type ProviderId = "local" | "anthropic" | "openai" | "gemini";

export type ModelCapabilities = {
  search: boolean;
  code: boolean;
  local: boolean;
};

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: ProviderId;
  /** Allowed thinking / effort values for this model (empty = no control). */
  thinkingModes: string[];
  defaultThinking: string;
  capabilities: ModelCapabilities;
};

export type ChatRequestBody = {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  provider?: ProviderId | "ollama";
  thinkingLevel?: string;
  /** Optional system prompt prefix for the target branch (anchored context). */
  system?: string;
};

/** Sentinel model id: the local provider picks the first installed model. */
export const LOCAL_AUTO_MODEL = "auto";

export const SYSTEM_PROMPT =
  "You are an educational assistant inside a reading-first chat app. Explain clearly and precisely; prefer worked examples." +
  " Formatting: markdown throughout. Use LaTeX math ($…$ inline, $$…$$ display) for every formula. Use fenced code blocks with a language tag for code." +
  "\n\nTOOL SELECTION — decide per response, using these exact rules:" +
  "\n- execute_code — WHEN: any arithmetic beyond trivial single-digit sums, any algorithm, simulation, data transformation, date math, unit conversion, or the user says 'run/test/compute this'. Write a clean, self-contained program that PRINTS its results; the user sees it in an editable sandbox and can re-run it. WHEN NOT: formatting or laying out text, printing tables (write a Markdown table directly), or restating known facts. NEVER present numbers as if computed unless they came from an execute_code result." +
  "\n- generate_diagram — WHEN: a process, pipeline, hierarchy, timeline, state machine, architecture, or set of relationships would be clearer drawn; also for simple share/composition charts (pie). Provide strictly valid Mermaid per the tool description. WHEN NOT: for data better shown as a Markdown table, or for a single linear sentence. Never emit a ```mermaid fence when this tool is available — call the tool." +
  "\n- fetch_image — If the user asks for pictures or images of any entities, YOU MUST use the image fetching tool immediately for ALL requested items: pass one query per item in the `queries` array in a SINGLE call (e.g. a list of 8 birds = 8 queries in one call). Also use it proactively whenever a person, place, artwork, organism, landmark, or notable object comes up. The tool returns Markdown image syntax — paste those ![title](url) lines directly into your reply so the images render inline. Never apologize or complain about tool constraints, never claim you cannot fetch or display images, and never fabricate image URLs." +
  "\n- web_search — WHEN: current events, news, prices, versions, release dates, sports, weather, or any fact that may have changed since training. Ground the answer in results and cite sources. WHEN NOT: stable textbook knowledge." +
  "\n- fetch_url_content — WHEN: the user gives a specific URL, or a search result must be read in full before discussing it." +
  "\n\nTOOL-CALL DISCIPLINE: invoke tools ONLY through the tool-calling API — never write tool-call JSON (or any JSON like {\"name\": …, \"parameters\": …}) into your reply text. One tool call does one job; after its result arrives, answer in plain markdown prose and do not emit further JSON. If a tool returns an error with a correction hint, fix the input and call it again." +
  "\n\nWhen no diagram tool is available you may still include a ```mermaid fenced code block — the app renders it as a diagram." +
  " When no fetch_image tool is available, include pictures via the image-search scheme — e.g. ![Karl Marx](image-search:karl+marx+portrait+1875), using + instead of spaces — one marker per subject; never repeat a query.";

export const CURATED_MODELS: ModelCatalogEntry[] = [
  // Local (Ollama / LM Studio via OpenAI chat-completions schema)
  {
    id: LOCAL_AUTO_MODEL,
    name: "Local (auto)",
    provider: "local",
    thinkingModes: [],
    defaultThinking: "",
    capabilities: { search: true, code: true, local: true },
  },
  // Claude
  {
    id: "claude-fable-5",
    name: "Fable 5",
    provider: "anthropic",
    thinkingModes: ["low", "medium", "high", "xhigh", "max"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "claude-opus-4-8",
    name: "Opus 4.8",
    provider: "anthropic",
    thinkingModes: ["low", "medium", "high", "xhigh", "max"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "claude-sonnet-5",
    name: "Sonnet 5",
    provider: "anthropic",
    thinkingModes: ["low", "medium", "high", "xhigh", "max"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "claude-haiku-4-5",
    name: "Haiku 4.5",
    provider: "anthropic",
    thinkingModes: ["off", "on"],
    defaultThinking: "on",
    capabilities: { search: true, code: true, local: false },
  },
  // OpenAI
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    thinkingModes: ["none", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    provider: "openai",
    thinkingModes: ["medium", "high", "xhigh"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    thinkingModes: ["none", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    provider: "openai",
    thinkingModes: ["medium", "high", "xhigh"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    provider: "openai",
    thinkingModes: ["none", "minimal", "low", "medium", "high"],
    defaultThinking: "low",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 nano",
    provider: "openai",
    thinkingModes: ["none", "minimal", "low", "medium"],
    defaultThinking: "minimal",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    thinkingModes: [],
    defaultThinking: "",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    provider: "openai",
    thinkingModes: [],
    defaultThinking: "",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "o3",
    name: "o3",
    provider: "openai",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    provider: "openai",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  // Gemini
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "gemini",
    thinkingModes: ["minimal", "low", "medium", "high"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "gemini",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    provider: "gemini",
    thinkingModes: ["minimal", "low", "medium", "high"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "high",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "medium",
    capabilities: { search: true, code: true, local: false },
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "gemini",
    thinkingModes: ["low", "medium", "high"],
    defaultThinking: "low",
    capabilities: { search: true, code: true, local: false },
  },
];

export function findCatalogModel(id: string): ModelCatalogEntry | undefined {
  return CURATED_MODELS.find((m) => m.id === id);
}

export function inferProvider(modelId: string): ProviderId {
  const hit = findCatalogModel(modelId);
  if (hit) return hit.provider;
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "gemini";
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return "openai";
  }
  return "local";
}
