import type { IncomingMessage, ServerResponse } from "node:http";
import { LOCAL_AUTO_MODEL, SYSTEM_PROMPT } from "../../shared/modelCatalog.ts";
import { STANDARD_TOOLS } from "../../shared/tools.ts";
import { runStandardTool } from "../tools/executors.ts";
import {
  mightBeToolCallText,
  parseTextToolCall,
  TOOL_TEXT_HOLD_CAP,
} from "./toolCallText.ts";
import {
  endTextStream,
  jsonError,
  startTextStream,
  writeError,
  writeTextDelta,
  writeToolInput,
  writeToolResult,
  writeToolStart,
  writeUsage,
} from "./sse.ts";

/**
 * Unified local provider speaking the OpenAI chat-completions schema.
 * Works with Ollama (http://127.0.0.1:11434/v1) and LM Studio
 * (http://localhost:1234/v1). Runs the standard four-tool loop server-side.
 */

const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const LMSTUDIO_DEFAULT = "http://127.0.0.1:1234";
const MAX_TOOL_ROUNDS = 6;

interface ChatMsg {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

async function probe(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Resolve the local server base URL: env override, then Ollama, then LM Studio. */
export async function resolveLocalBase(): Promise<string | null> {
  const env = (process.env.LOCAL_LLM_BASE_URL || process.env.OLLAMA_BASE_URL || "").replace(
    /\/$/,
    "",
  );
  if (env) return (await probe(env)) ? env : env; // trust explicit config
  if (await probe(OLLAMA_DEFAULT)) return OLLAMA_DEFAULT;
  if (await probe(LMSTUDIO_DEFAULT)) return LMSTUDIO_DEFAULT;
  return null;
}

export async function localAvailable(): Promise<boolean> {
  const base = await resolveLocalBase();
  if (!base) return false;
  return probe(base);
}

/** Models that can't chat (embedding / reranking) — hidden from the picker. */
const NON_CHAT_MODEL = /embed|embedding|rerank|bge-|minilm|e5-/i;

export async function listLocalModels(): Promise<Array<{ id: string; name: string }>> {
  const base = await resolveLocalBase();
  if (!base) return [];
  try {
    const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const json = (await r.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .map((m) => (m.id ? { id: m.id, name: m.id } : null))
      .filter((m): m is { id: string; name: string } => Boolean(m))
      .filter((m) => !NON_CHAT_MODEL.test(m.id));
  } catch {
    return [];
  }
}

async function resolveModel(base: string, requested: string): Promise<string | null> {
  if (requested && requested !== LOCAL_AUTO_MODEL) return requested;
  const models = await listLocalModels();
  return models[0]?.id ?? null;
}

export async function handleLocalChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  },
): Promise<void> {
  const base = await resolveLocalBase();
  if (!base) {
    jsonError(
      res,
      502,
      "No local LLM server found. Start Ollama (ollama serve) or LM Studio, or set LOCAL_LLM_BASE_URL in .env.",
    );
    return;
  }
  const model = await resolveModel(base, opts.model);
  if (!model) {
    jsonError(res, 502, `Local server at ${base} reports no installed models.`);
    return;
  }

  // Extra emphasis for small local models, which are the ones that leak
  // text-shaped tool-call JSON into replies.
  const LOCAL_GUARDRAILS =
    "\n\nHARD RULES for this session (violating any of these breaks the app):" +
    "\n1. Reply in plain markdown prose only — never output a JSON object as your answer, and never write tool-call JSON into reply text. Tools are invoked exclusively through the tool-calling API." +
    "\n2. execute_code is ONLY for real computation (math, algorithms, simulations, conversions). Never use it to print, format, or lay out text; use Markdown tables for tabular data." +
    "\n3. generate_diagram takes pure Mermaid source: no ``` fences, quote labels containing spaces or punctuation, one statement per line. If it returns an error, fix the source and call it again." +
    "\n4. If the user asks for pictures or images of ANY entities, you MUST call fetch_image immediately with one query per item in a single `queries` array — never refuse, never apologize about tool constraints, never invent image URLs. Paste the returned ![title](url) Markdown lines directly into your reply." +
    "\n5. After a tool result arrives, write the final answer in plain markdown. Do not repeat raw tool output verbatim — except fetch_image's Markdown image lines, which you must include as-is so the pictures render.";

  const system =
    (opts.system ? `${SYSTEM_PROMPT}\n\n${opts.system}` : SYSTEM_PROMPT) + LOCAL_GUARDRAILS;
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    ...opts.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];

  const signal = abortFrom(req);
  startTextStream(res, model);

  let toolsSupported = true;
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const useTools = toolsSupported && round < MAX_TOOL_ROUNDS;
      // Text-shaped tool calls are intercepted on every non-final round, even
      // when the server rejected the native tools param.
      const interceptText = round < MAX_TOOL_ROUNDS;
      let turn: TurnResult;
      try {
        turn = await streamOneTurn(base, model, messages, useTools, interceptText, res, signal);
      } catch (err) {
        if (useTools && isToolsUnsupportedError(err)) {
          // Model/server rejects the tools param — retry the whole turn without.
          toolsSupported = false;
          turn = await streamOneTurn(base, model, messages, false, interceptText, res, signal);
        } else {
          throw err;
        }
      }

      if (turn.usage) writeUsage(res, turn.usage);

      if (turn.toolCalls.length === 0) break;

      // Record the assistant turn, run each tool, then continue the loop.
      messages.push({
        role: "assistant",
        content: turn.text || null,
        tool_calls: turn.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      });
      for (const call of turn.toolCalls) {
        writeToolInput(res, { id: call.id, input: call.arguments });
        const result = await runStandardTool(call.name, call.arguments);
        writeToolResult(res, { id: call.id, output: result.output, status: result.status });
        messages.push({ role: "tool", content: result.output, tool_call_id: call.id });
      }
    }
    endTextStream(res);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      res.end();
      return;
    }
    writeError(res, `Local model stream interrupted: ${String(err)}`);
  }
}

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

interface TurnResult {
  text: string;
  toolCalls: ToolCallAcc[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

function isToolsUnsupportedError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("tool") || msg.includes("400");
}

const TOOL_NAMES: ReadonlySet<string> = new Set(STANDARD_TOOLS.map((t) => t.function.name));

let textCallSeq = 0;

/** Stream one chat-completions turn, emitting text deltas and tool_start events. */
async function streamOneTurn(
  base: string,
  model: string,
  messages: ChatMsg[],
  useTools: boolean,
  /** Hold back text that looks like a tool-call JSON and execute it instead. */
  interceptText: boolean,
  res: ServerResponse,
  signal: AbortSignal,
): Promise<TurnResult> {
  const body: Record<string, unknown> = { model, messages, stream: true };
  if (useTools) body.tools = STANDARD_TOOLS;
  body.stream_options = { include_usage: true };

  const upstream = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    throw new Error(`Local server error (${upstream.status}): ${text.slice(0, 400)}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const turn: TurnResult = { text: "", toolCalls: [] };
  const started = new Set<string>();

  // Text-shaped tool-call interception: buffer deltas while the turn text
  // still looks like it may be a JSON tool call. Never stream held text.
  let holding = interceptText;
  let held = "";
  const flushHeld = () => {
    if (!holding) return;
    holding = false;
    if (held) writeTextDelta(res, held);
    held = "";
  };

  const handleChunk = (json: {
    choices?: Array<{
      delta?: {
        content?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }) => {
    if (json.usage) {
      turn.usage = {
        input_tokens: json.usage.prompt_tokens,
        output_tokens: json.usage.completion_tokens,
      };
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      turn.text += delta.content;
      if (holding) {
        held += delta.content;
        if (!mightBeToolCallText(held) || held.length > TOOL_TEXT_HOLD_CAP) {
          flushHeld();
        }
      } else {
        writeTextDelta(res, delta.content);
      }
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      let acc = turn.toolCalls[idx];
      if (!acc) {
        acc = { id: tc.id ?? `call_${idx}_${Date.now()}`, name: "", arguments: "" };
        turn.toolCalls[idx] = acc;
      }
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      if (acc.name && !started.has(acc.id)) {
        started.add(acc.id);
        writeToolStart(res, { id: acc.id, name: acc.name });
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        handleChunk(JSON.parse(payload));
      } catch {
        // ignore malformed lines
      }
    }
  }

  // Drop tool calls that never resolved a name (malformed stream).
  turn.toolCalls = turn.toolCalls.filter((c) => c && c.name);

  // Turn ended while still holding: either it parses as a tool call (execute
  // it like a native one — the raw JSON never reaches the client) or it was
  // ordinary JSON-looking text and gets flushed now.
  if (holding && held) {
    const parsed = turn.toolCalls.length === 0 ? parseTextToolCall(held, TOOL_NAMES) : null;
    if (parsed) {
      holding = false;
      held = "";
      turn.text = "";
      const call: ToolCallAcc = {
        id: `textcall_${++textCallSeq}_${Date.now()}`,
        name: parsed.name,
        arguments: parsed.arguments,
      };
      turn.toolCalls.push(call);
      writeToolStart(res, { id: call.id, name: call.name });
    } else {
      flushHeld();
    }
  }

  return turn;
}

function abortFrom(req: IncomingMessage): AbortSignal {
  const c = new AbortController();
  req.on("close", () => c.abort());
  return c.signal;
}
