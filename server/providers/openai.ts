import type { IncomingMessage, ServerResponse } from "node:http";
import { SYSTEM_PROMPT } from "../../shared/modelCatalog.ts";
import {
  endTextStream,
  jsonError,
  startTextStream,
  writeCitation,
  writeError,
  writeSearchStatus,
  writeTextDelta,
  writeThinkingStatus,
  writeUsage,
} from "./sse.ts";

type OpenAIEvent = {
  type?: string;
  delta?: string;
  item?: {
    type?: string;
    id?: string;
    status?: string;
    action?: { query?: string; queries?: string[] };
  };
  annotation?: {
    type?: string;
    url?: string;
    title?: string;
    file_id?: string;
    container_id?: string;
    filename?: string;
  };
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  error?: { message?: string };
};

export async function handleOpenAIChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    model: string;
    thinkingLevel?: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  },
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    jsonError(res, 500, "OPENAI_API_KEY is not set. Add it to .env and retry.");
    return;
  }

  const input = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: opts.model,
    instructions: opts.system ? `${SYSTEM_PROMPT}\n\n${opts.system}` : SYSTEM_PROMPT,
    input,
    stream: true,
    tools: [
      { type: "web_search" },
      {
        type: "code_interpreter",
        container: { type: "auto" },
      },
    ],
  };

  if (opts.thinkingLevel) {
    body.reasoning = { effort: opts.thinkingLevel };
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: abortFrom(req),
  }).catch((err: unknown) => {
    jsonError(res, 502, `Failed to reach OpenAI: ${String(err)}`);
    return null;
  });
  if (!upstream) return;

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    jsonError(res, upstream.status, text || `OpenAI error (${upstream.status})`);
    return;
  }

  startTextStream(res, opts.model);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  req.on("close", () => {
    void reader.cancel().catch(() => {});
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleOpenAIEvent(res, raw);
      }
    }
    endTextStream(res);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      res.end();
      return;
    }
    writeError(res, `OpenAI stream interrupted: ${String(err)}`);
  }
}

function handleOpenAIEvent(res: ServerResponse, rawEvent: string): void {
  const dataLines = rawEvent
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return;
  const joined = dataLines.join("\n");
  if (joined === "[DONE]") return;

  let ev: OpenAIEvent;
  try {
    ev = JSON.parse(joined);
  } catch {
    return;
  }

  switch (ev.type) {
    case "response.output_text.delta":
      writeTextDelta(res, ev.delta ?? "");
      break;
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      writeThinkingStatus(res);
      break;
    case "response.web_search_call.in_progress":
    case "response.web_search_call.searching":
      writeSearchStatus(
        res,
        ev.item?.action?.query ?? ev.item?.action?.queries?.[0],
      );
      break;
    case "response.output_text.annotation.added": {
      const a = ev.annotation;
      if (a?.type === "url_citation" && a.url) {
        writeCitation(res, a.url, a.title || a.url);
      } else if (a?.type === "container_file_citation" && a.file_id && a.container_id) {
        // Surface as a file artifact URL the client already understands via /api/files
        writeTextDelta(
          res,
          `\n\n![chart](/api/files/openai/${a.container_id}/${a.file_id})\n\n`,
        );
      }
      break;
    }
    case "response.completed":
      if (ev.response?.usage) {
        writeUsage(res, {
          input_tokens: ev.response.usage.input_tokens,
          output_tokens: ev.response.usage.output_tokens,
        });
      }
      break;
    case "error":
    case "response.failed":
      writeError(
        res,
        ev.error?.message ?? ev.response?.error?.message ?? "OpenAI error",
      );
      break;
  }
}

export async function handleOpenAIContainerFile(
  res: ServerResponse,
  containerId: string,
  fileId: string,
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.end("OPENAI_API_KEY is not set");
    return;
  }
  try {
    const r = await fetch(
      `https://api.openai.com/v1/containers/${containerId}/files/${fileId}/content`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok || !r.body) {
      res.statusCode = r.status;
      res.end(await r.text());
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const ok = res.write(value);
      if (!ok) await new Promise<void>((resolve) => res.once("drain", () => resolve()));
    }
    res.end();
  } catch (err) {
    res.statusCode = 502;
    res.end(`Failed to fetch OpenAI file: ${String(err)}`);
  }
}

function abortFrom(req: IncomingMessage): AbortSignal {
  const c = new AbortController();
  req.on("close", () => c.abort());
  return c.signal;
}
