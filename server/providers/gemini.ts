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

type GeminiEvent = {
  event_type?: string;
  type?: string;
  delta?: {
    type?: string;
    text?: string;
    arguments?: string;
  };
  step?: {
    type?: string;
    id?: string;
    arguments?: { query?: string; queries?: string[] };
  };
  interaction?: {
    status?: string;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    outputs?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }>;
    }>;
  };
  error?: { message?: string };
};

export async function handleGeminiChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    model: string;
    thinkingLevel?: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  },
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    jsonError(res, 500, "GEMINI_API_KEY is not set. Add it to .env and retry.");
    return;
  }

  const systemPrompt = opts.system ? `${SYSTEM_PROMPT}\n\n${opts.system}` : SYSTEM_PROMPT;

  // Flatten conversation into a single input string with role labels —
  // Interactions API accepts string or structured input; string is most portable.
  const input = opts.messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  const body: Record<string, unknown> = {
    model: opts.model,
    input,
    system_instruction: systemPrompt,
    stream: true,
    tools: [{ type: "google_search" }, { type: "code_execution" }],
  };

  if (opts.thinkingLevel) {
    body.generation_config = {
      thinking_config: { thinking_level: opts.thinkingLevel },
    };
  }

  const upstream = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: abortFrom(req),
    },
  ).catch((err: unknown) => {
    jsonError(res, 502, `Failed to reach Gemini: ${String(err)}`);
    return null;
  });
  if (!upstream) return;

  if (!upstream.ok || !upstream.body) {
    // Fallback: try generateContent stream if Interactions is unavailable.
    const errText = await upstream.text();
    if (upstream.status === 404 || upstream.status === 400) {
      await handleGeminiGenerateContent(req, res, opts, apiKey);
      return;
    }
    jsonError(res, upstream.status, errText || `Gemini error (${upstream.status})`);
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
      // Interactions may use SSE or NDJSON; handle both.
      if (buffer.includes("\n\n")) {
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleGeminiEvent(res, raw);
        }
      } else {
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handleGeminiEvent(res, line.startsWith("data:") ? line : `data: ${line}`);
        }
      }
    }
    endTextStream(res);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      res.end();
      return;
    }
    writeError(res, `Gemini stream interrupted: ${String(err)}`);
  }
}

function handleGeminiEvent(res: ServerResponse, rawEvent: string): void {
  const dataLines = rawEvent
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const payload = dataLines.length > 0 ? dataLines.join("\n") : rawEvent.replace(/^data:\s*/, "").trim();
  if (!payload || payload === "[DONE]") return;

  let ev: GeminiEvent;
  try {
    ev = JSON.parse(payload);
  } catch {
    return;
  }

  const et = ev.event_type ?? ev.type;
  if (et === "step.delta" || et === "content.delta") {
    if (ev.delta?.type === "text" && ev.delta.text) {
      writeTextDelta(res, ev.delta.text);
    } else if (ev.delta?.type === "thought" || ev.delta?.type === "thinking") {
      writeThinkingStatus(res);
    }
  } else if (et === "step.start") {
    if (ev.step?.type === "google_search_call") {
      writeSearchStatus(
        res,
        ev.step.arguments?.query ?? ev.step.arguments?.queries?.[0],
      );
    } else if (ev.step?.type === "thought" || ev.step?.type === "thinking") {
      writeThinkingStatus(res);
    }
  } else if (et === "interaction.completed") {
    const outputs = ev.interaction?.outputs ?? [];
    for (const out of outputs) {
      for (const a of out.annotations ?? []) {
        if (a.url) writeCitation(res, a.url, a.title || a.url);
      }
    }
    if (ev.interaction?.usage) {
      writeUsage(res, {
        input_tokens: ev.interaction.usage.input_tokens,
        output_tokens: ev.interaction.usage.output_tokens,
      });
    }
  } else if (et === "error") {
    writeError(res, ev.error?.message ?? "Gemini error");
  }

  // generateContent-style chunk
  const candidates = (ev as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates;
  if (candidates?.[0]?.content?.parts) {
    for (const p of candidates[0].content.parts) {
      if (p.text) writeTextDelta(res, p.text);
    }
  }
}

/** Fallback streaming via generateContent when Interactions is unavailable. */
async function handleGeminiGenerateContent(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    model: string;
    thinkingLevel?: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  },
  apiKey: string,
): Promise<void> {
  const contents = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const genConfig: Record<string, unknown> = {};
  if (opts.thinkingLevel) {
    genConfig.thinkingConfig = { thinkingLevel: opts.thinkingLevel };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: opts.system ? `${SYSTEM_PROMPT}\n\n${opts.system}` : SYSTEM_PROMPT }],
      },
      contents,
      tools: [{ google_search: {} }, { code_execution: {} }],
      generationConfig: genConfig,
    }),
    signal: abortFrom(req),
  }).catch((err: unknown) => {
    jsonError(res, 502, `Failed to reach Gemini: ${String(err)}`);
    return null;
  });
  if (!upstream) return;

  if (!upstream.ok || !upstream.body) {
    jsonError(res, upstream.status, (await upstream.text()) || "Gemini error");
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
        handleGeminiEvent(res, raw);
      }
    }
    endTextStream(res);
  } catch (err) {
    writeError(res, `Gemini stream interrupted: ${String(err)}`);
  }
}

function abortFrom(req: IncomingMessage): AbortSignal {
  const c = new AbortController();
  req.on("close", () => c.abort());
  return c.signal;
}
