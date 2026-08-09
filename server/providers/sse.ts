import type { IncomingMessage, ServerResponse } from "node:http";

/** Write one Anthropic-shaped SSE event the client already understands. */
export function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function startTextStream(res: ServerResponse, model?: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  writeSse(res, {
    type: "message_start",
    message: { model, usage: { input_tokens: 0 } },
  });
  writeSse(res, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text" },
  });
}

export function writeTextDelta(res: ServerResponse, text: string): void {
  if (!text) return;
  writeSse(res, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
}

export function writeThinkingStatus(res: ServerResponse): void {
  writeSse(res, {
    type: "content_block_start",
    index: 1,
    content_block: { type: "thinking" },
  });
}

export function writeSearchStatus(res: ServerResponse, query?: string): void {
  writeSse(res, {
    type: "content_block_start",
    index: 2,
    content_block: { type: "server_tool_use", name: "web_search" },
  });
  if (query) {
    writeSse(res, {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: JSON.stringify({ query }) },
    });
    writeSse(res, { type: "content_block_stop", index: 2 });
  }
}

export function writeCitation(res: ServerResponse, url: string, title: string): void {
  writeSse(res, {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "citations_delta",
      citation: { type: "web_search_result_location", url, title },
    },
  });
}

// ---- Standard tool-call events (execute_code / generate_diagram / …) ------

export function writeToolStart(res: ServerResponse, tool: { id: string; name: string }): void {
  writeSse(res, { type: "tool_start", tool });
}

export function writeToolInput(res: ServerResponse, tool: { id: string; input: string }): void {
  writeSse(res, { type: "tool_input", tool });
}

export function writeToolResult(
  res: ServerResponse,
  tool: { id: string; output: string; status: "done" | "error" },
): void {
  writeSse(res, { type: "tool_result", tool });
}

export function writeUsage(
  res: ServerResponse,
  usage: { input_tokens?: number; output_tokens?: number },
): void {
  writeSse(res, { type: "message_delta", usage });
}

export function endTextStream(res: ServerResponse): void {
  writeSse(res, { type: "content_block_stop", index: 0 });
  writeSse(res, { type: "message_stop" });
  res.end();
}

export function writeError(res: ServerResponse, message: string): void {
  if (!res.headersSent) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
  }
  writeSse(res, { type: "error", error: { message } });
  res.end();
}

export function jsonError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message } }));
}

const BODY_MAX_BYTES = 2 * 1024 * 1024;

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Pipe an upstream ReadableStream body to the client response with abort on close. */
export async function pipeStream(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Response,
): Promise<void> {
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.end(text);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = upstream.body.getReader();
  const onClose = () => {
    void reader.cancel().catch(() => {});
  };
  req.on("close", onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const ok = res.write(value);
      if (!ok) await new Promise<void>((resolve) => res.once("drain", () => resolve()));
    }
  } catch {
    // client disconnected
  } finally {
    req.off("close", onClose);
    res.end();
  }
}
