import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config as loadEnv } from "dotenv";
import {
  CURATED_MODELS,
  inferProvider,
  type ChatRequestBody,
  type ModelCatalogEntry,
  type ProviderId,
} from "./shared/modelCatalog.ts";
import { handleAnthropicChat, handleAnthropicFile, listAnthropicModels } from "./server/providers/anthropic.ts";
import { handleOpenAIChat, handleOpenAIContainerFile } from "./server/providers/openai.ts";
import { handleGeminiChat } from "./server/providers/gemini.ts";
import { handleLocalChat, listLocalModels, localAvailable } from "./server/providers/local.ts";
import { jsonError, readBody } from "./server/providers/sse.ts";
import { searchWikimediaCached } from "./server/tools/imageSearch.ts";

/**
 * Dev-time multi-provider chat proxy.
 *
 * SECURITY: API keys live only in the Vite server process (read from .env,
 * NOT VITE_-prefixed). The browser only talks to /api/* on the same origin.
 */
export function llmProxy(): Plugin {
  return {
    name: "llm-proxy",
    configureServer(server) {
      // Every handler is fallible; a rejected promise here must never bubble
      // into an unhandled rejection that takes down the dev server.
      const guard =
        (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
        (req: IncomingMessage, res: ServerResponse) => {
          handler(req, res).catch((err: unknown) => {
            if (!res.writableEnded) {
              jsonError(res, 500, `Internal error: ${String(err)}`);
            }
          });
        };
      server.middlewares.use("/api/chat", guard(handleChat));
      server.middlewares.use("/api/files", guard(handleFiles));
      server.middlewares.use("/api/images", guard(handleImageSearch));
      server.middlewares.use("/api/models", guard(handleModelList));
    },
  };
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    jsonError(res, 405, "Method not allowed");
    return;
  }

  loadEnv({ override: true });

  let body: ChatRequestBody;
  try {
    body = JSON.parse(await readBody(req)) as ChatRequestBody;
  } catch {
    jsonError(res, 400, "Invalid JSON body");
    return;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    jsonError(res, 400, "`messages` must be a non-empty array");
    return;
  }

  const model =
    typeof body.model === "string" && /^[\w./:-]{1,128}$/.test(body.model)
      ? body.model
      : "auto";

  // Legacy "ollama" maps onto the unified local provider.
  const rawProvider = body.provider === "ollama" ? "local" : body.provider;
  const provider: ProviderId =
    rawProvider && ["local", "anthropic", "openai", "gemini"].includes(rawProvider)
      ? (rawProvider as ProviderId)
      : inferProvider(model);

  const thinkingLevel =
    typeof body.thinkingLevel === "string" ? body.thinkingLevel : undefined;
  const system =
    typeof body.system === "string" && body.system.trim()
      ? body.system.slice(0, 8000)
      : undefined;

  const messages = body.messages.map((m) => ({
    role: String(m.role),
    content: String(m.content ?? ""),
  }));

  switch (provider) {
    case "openai":
      await handleOpenAIChat(req, res, { model, thinkingLevel, messages, system });
      break;
    case "gemini":
      await handleGeminiChat(req, res, { model, thinkingLevel, messages, system });
      break;
    case "anthropic":
      await handleAnthropicChat(req, res, { model, thinkingLevel, messages, system });
      break;
    case "local":
    default:
      await handleLocalChat(req, res, { model, messages, system });
      break;
  }
}

async function handleFiles(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }
  loadEnv({ override: true });

  // Mount strips /api/files — path may be ":id" or "openai/:container/:file"
  const path = (req.url ?? "").split("?")[0].replace(/^\//, "");
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "openai" && parts.length === 3) {
    const [, containerId, fileId] = parts;
    if (!/^[\w-]+$/.test(containerId) || !/^[\w-]+$/.test(fileId)) {
      res.statusCode = 400;
      res.end("Invalid file id");
      return;
    }
    await handleOpenAIContainerFile(res, containerId, fileId);
    return;
  }

  const fileId = parts[0] ?? "";
  if (!/^[\w-]+$/.test(fileId)) {
    res.statusCode = 400;
    res.end("Invalid file id");
    return;
  }
  await handleAnthropicFile(req, res, fileId);
}

async function handleModelList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }

  loadEnv({ override: true });

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasLocal = await localAvailable();

  const [liveAnthropic, liveLocal] = await Promise.all([
    hasAnthropic ? listAnthropicModels() : Promise.resolve([]),
    hasLocal ? listLocalModels() : Promise.resolve([]),
  ]);

  const byId = new Map<string, ModelCatalogEntry & { available: boolean }>();

  for (const m of CURATED_MODELS) {
    const available =
      (m.provider === "anthropic" && hasAnthropic) ||
      (m.provider === "openai" && hasOpenAI) ||
      (m.provider === "gemini" && hasGemini) ||
      (m.provider === "local" && hasLocal);
    byId.set(m.id, { ...m, available });
  }

  // Merge live Anthropic models not already curated.
  for (const live of liveAnthropic) {
    if (byId.has(live.id)) continue;
    byId.set(live.id, {
      id: live.id,
      name: live.name,
      provider: "anthropic",
      thinkingModes: live.id.includes("haiku")
        ? ["off", "on"]
        : ["low", "medium", "high", "xhigh", "max"],
      defaultThinking: live.id.includes("haiku") ? "on" : "high",
      capabilities: { search: true, code: true, local: false },
      available: hasAnthropic,
    });
  }

  // Installed local models (Ollama / LM Studio via OpenAI schema).
  for (const live of liveLocal) {
    byId.set(live.id, {
      id: live.id,
      name: live.name,
      provider: "local",
      thinkingModes: [],
      defaultThinking: "",
      capabilities: { search: true, code: true, local: true },
      available: hasLocal,
    });
  }

  const models = [...byId.values()].sort((a, b) => {
    const order: ProviderId[] = ["local", "anthropic", "openai", "gemini"];
    const d = order.indexOf(a.provider) - order.indexOf(b.provider);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-cache");
  res.end(
    JSON.stringify({
      models,
      providers: {
        local: hasLocal,
        anthropic: hasAnthropic,
        openai: hasOpenAI,
        gemini: hasGemini,
      },
    }),
  );
}

// ---- Wikimedia image search ----------------------------------------------

async function handleImageSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }

  const query = new URL(req.url ?? "", "http://localhost").searchParams.get("q")?.trim();
  if (!query) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing ?q=<query>" }));
    return;
  }

  const hits = await searchWikimediaCached(query);

  res.statusCode = hits.length > 0 ? 200 : 404;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(
    JSON.stringify(
      hits.length > 0 ? { images: hits } : { error: `No image found for "${query}"` },
    ),
  );
}
