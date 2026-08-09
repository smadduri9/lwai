import type { IncomingMessage, ServerResponse } from "node:http";
import { SYSTEM_PROMPT } from "../../shared/modelCatalog.ts";
import { jsonError, pipeStream } from "./sse.ts";

function isHaiku(model: string): boolean {
  return model.includes("haiku");
}

function isAdaptiveModel(model: string): boolean {
  return (
    model.includes("fable") ||
    model.includes("mythos") ||
    model.includes("opus-4-8") ||
    model.includes("opus-4-7") ||
    model.includes("sonnet-5") ||
    model.includes("sonnet-4-6")
  );
}

function buildThinkingConfig(
  model: string,
  thinkingLevel?: string,
): { thinking: Record<string, unknown>; effort?: string } {
  if (isHaiku(model)) {
    if (thinkingLevel === "off") return { thinking: { type: "disabled" } };
    return { thinking: { type: "enabled", budget_tokens: 4096 } };
  }
  if (isAdaptiveModel(model)) {
    const effort = thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : "high";
    return { thinking: { type: "adaptive" }, effort };
  }
  if (thinkingLevel === "off") return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled", budget_tokens: 4096 } };
}

export async function handleAnthropicChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { model: string; thinkingLevel?: string; messages: unknown[]; system?: string },
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    jsonError(
      res,
      500,
      "ANTHROPIC_API_KEY is not set. Add it to .env and retry.",
    );
    return;
  }

  const { thinking, effort } = buildThinkingConfig(opts.model, opts.thinkingLevel);

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: 8192,
    stream: true,
    thinking,
    system: opts.system ? `${SYSTEM_PROMPT}\n\n${opts.system}` : SYSTEM_PROMPT,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      { type: "code_execution_20250825", name: "code_execution" },
    ],
    messages: opts.messages,
  };
  if (effort) {
    body.output_config = { effort };
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
    body: JSON.stringify(body),
    signal: abortSignalFromReq(req),
  }).catch((err: unknown) => {
    jsonError(res, 502, `Failed to reach Anthropic: ${String(err)}`);
    return null;
  });
  if (!upstream) return;
  await pipeStream(req, res, upstream);
}

export async function handleAnthropicFile(
  req: IncomingMessage,
  res: ServerResponse,
  fileId: string,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.end("ANTHROPIC_API_KEY is not set");
    return;
  }

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "files-api-2025-04-14",
  };

  try {
    const [meta, content] = await Promise.all([
      fetch(`https://api.anthropic.com/v1/files/${fileId}`, { headers }),
      fetch(`https://api.anthropic.com/v1/files/${fileId}/content`, { headers }),
    ]);

    if (!content.ok || !content.body) {
      res.statusCode = content.status;
      res.end(await content.text());
      return;
    }

    let mimeType = "application/octet-stream";
    let filename = fileId;
    if (meta.ok) {
      const json = (await meta.json()) as { mime_type?: string; filename?: string };
      if (json.mime_type) mimeType = json.mime_type;
      if (json.filename) filename = json.filename;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const reader = content.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const ok = res.write(value);
      if (!ok) await new Promise<void>((resolve) => res.once("drain", () => resolve()));
    }
    res.end();
  } catch (err) {
    res.statusCode = 502;
    res.end(`Failed to fetch file: ${String(err)}`);
  }
}

export async function listAnthropicModels(): Promise<Array<{ id: string; name: string }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=50", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) return [];
    const json = (await r.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };
    return (json.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => Boolean(m.id))
      .map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
  } catch {
    return [];
  }
}

function abortSignalFromReq(req: IncomingMessage): AbortSignal {
  const c = new AbortController();
  req.on("close", () => c.abort());
  return c.signal;
}
