import { useModelStore } from "../store/modelStore";
import type { ApiMessage, Artifact, Citation, StreamPhase } from "../types";

/** Incremental usage/performance facts extracted from the stream. */
export interface UsageUpdate {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Milliseconds from request start to the first text token. */
  ttftMs?: number;
  /** Total milliseconds for the whole response. */
  durationMs?: number;
  /** Web searches performed so far in this response. */
  searches?: number;
  /** Code-execution tool calls so far in this response. */
  codeRuns?: number;
}

interface StreamCallbacks {
  onDelta: (text: string) => void;
  onStatus: (phase: StreamPhase, query?: string) => void;
  onCitation: (citation: Citation) => void;
  onArtifact?: (artifact: Artifact) => void;
  /** Standard tool-call lifecycle (execute_code / generate_diagram / …). */
  onToolStart?: (tool: { id: string; name: string }) => void;
  onToolInput?: (tool: { id: string; input: string }) => void;
  onToolResult?: (tool: { id: string; output: string; status: "done" | "error" }) => void;
  onUsage?: (update: UsageUpdate) => void;
  onDone: () => void;
  onError: (message: string) => void;
  /** When aborted, calls onDone (not onError) and leaves partial text as-is. */
  signal?: AbortSignal;
}

/** Map a standard tool name to the live status phase shown while it runs. */
export function phaseForTool(name: string): StreamPhase {
  switch (name) {
    case "execute_code":
      return "coding";
    case "web_search":
      return "searching";
    case "fetch_url_content":
      return "reading";
    case "fetch_image":
      return "searching";
    case "generate_diagram":
      return "diagramming";
    default:
      return "running";
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/**
 * POST the assembled messages to the local proxy and stream back text deltas
 * parsed from Anthropic's SSE events. With the server-side web search tool
 * enabled, the stream interleaves `server_tool_use` blocks (search calls),
 * `web_search_tool_result` blocks, and text blocks carrying citations.
 */
export async function streamChat(
  messages: ApiMessage[],
  callbacks: StreamCallbacks,
  opts?: { system?: string },
): Promise<void> {
  const { onUsage, onDone, onError, signal } = callbacks;
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: useModelStore.getState().modelId,
        provider: useModelStore.getState().provider,
        thinkingLevel: useModelStore.getState().thinkingLevel || undefined,
        system: opts?.system,
      }),
      signal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      onDone();
      return;
    }
    onError(`Network error: ${String(err)}`);
    return;
  }

  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const json = await response.json();
      if (json?.error?.message) message = json.error.message;
    } catch {
      // keep the generic message
    }
    onError(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Accumulates the partial JSON input of an in-flight server tool call
  // (web_search query or code_execution code) until it has fully streamed in.
  const state: ParserState = {
    toolInputJson: null,
    toolKind: null,
    startedAt,
    sawFirstToken: false,
    searches: 0,
    codeRuns: 0,
  };

  try {
    for (;;) {
      if (signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        onDone();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleEvent(rawEvent, state, callbacks);
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      onDone();
      return;
    }
    onError(`Stream interrupted: ${String(err)}`);
    return;
  }

  onUsage?.({ durationMs: performance.now() - startedAt });
  onDone();
}

interface ParserState {
  /** Non-null while a server_tool_use block is streaming its input JSON. */
  toolInputJson: string | null;
  /** Which server tool the in-flight input belongs to. */
  toolKind: "search" | "code" | null;
  startedAt: number;
  sawFirstToken: boolean;
  searches: number;
  codeRuns: number;
}

/** Names Anthropic uses for the code-execution family of server tools. */
const CODE_TOOL_NAMES = new Set([
  "code_execution",
  "bash_code_execution",
  "text_editor_code_execution",
]);

interface ToolResultFile {
  type?: string;
  file_id?: string;
  name?: string;
  filename?: string;
}

interface AnthropicEvent {
  type?: string;
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
  content_block?: {
    type?: string;
    name?: string;
    content?: {
      type?: string;
      stdout?: string;
      stderr?: string;
      content?: ToolResultFile[];
    };
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    citation?: { type?: string; url?: string; title?: string };
  };
  /** Normalized standard tool-call events emitted by the proxy. */
  tool?: { id?: string; name?: string; input?: string; output?: string; status?: string };
  error?: { message?: string };
}

function handleEvent(
  rawEvent: string,
  state: ParserState,
  callbacks: StreamCallbacks,
): void {
  const { onDelta, onStatus, onCitation, onArtifact, onUsage, onError } = callbacks;
  const dataLines = rawEvent
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return;

  let payload: AnthropicEvent;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  switch (payload.type) {
    case "tool_start": {
      const t = payload.tool;
      if (t?.id && t.name) {
        callbacks.onToolStart?.({ id: t.id, name: t.name });
        onStatus(phaseForTool(t.name));
      }
      break;
    }

    case "tool_input": {
      const t = payload.tool;
      if (t?.id && t.input !== undefined) {
        callbacks.onToolInput?.({ id: t.id, input: t.input });
      }
      break;
    }

    case "tool_result": {
      const t = payload.tool;
      if (t?.id) {
        callbacks.onToolResult?.({
          id: t.id,
          output: t.output ?? "",
          status: t.status === "error" ? "error" : "done",
        });
        onStatus("writing");
      }
      break;
    }

    case "message_start": {
      onUsage?.({
        model: payload.message?.model,
        inputTokens: payload.message?.usage?.input_tokens,
      });
      break;
    }

    // Carries the cumulative output token count as the response streams.
    case "message_delta": {
      if (payload.usage?.output_tokens !== undefined) {
        onUsage?.({ outputTokens: payload.usage.output_tokens });
      }
      break;
    }

    case "content_block_start": {
      const block = payload.content_block;
      if (block?.type === "server_tool_use" && block.name === "web_search") {
        state.toolInputJson = "";
        state.toolKind = "search";
        state.searches += 1;
        onUsage?.({ searches: state.searches });
        onStatus("searching");
      } else if (block?.type === "server_tool_use" && CODE_TOOL_NAMES.has(block.name ?? "")) {
        state.toolInputJson = "";
        state.toolKind = "code";
        state.codeRuns += 1;
        onUsage?.({ codeRuns: state.codeRuns });
        onStatus("coding");
      } else if (block?.type === "web_search_tool_result") {
        onStatus("reading");
      } else if (block?.type?.endsWith("code_execution_tool_result")) {
        const result = block.content;
        if (result) {
          if (result.stdout || result.stderr) {
            onArtifact?.({
              kind: "output",
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
            });
          }
          for (const f of result.content ?? []) {
            if (f.file_id) {
              onArtifact?.({
                kind: "file",
                fileId: f.file_id,
                filename: f.filename ?? f.name,
              });
            }
          }
        }
      } else if (block?.type === "thinking") {
        onStatus("thinking");
      } else if (block?.type === "text") {
        onStatus("writing");
      }
      break;
    }

    case "content_block_delta": {
      const delta = payload.delta;
      if (!delta) break;
      if (delta.type === "text_delta") {
        if (!state.sawFirstToken) {
          state.sawFirstToken = true;
          onUsage?.({ ttftMs: performance.now() - state.startedAt });
        }
        onDelta(delta.text ?? "");
      } else if (delta.type === "input_json_delta" && state.toolInputJson !== null) {
        state.toolInputJson += delta.partial_json ?? "";
      } else if (delta.type === "citations_delta") {
        const c = delta.citation;
        if (c?.type === "web_search_result_location" && c.url) {
          onCitation({ url: c.url, title: c.title || c.url });
        }
      }
      break;
    }

    case "content_block_stop": {
      if (state.toolInputJson !== null) {
        try {
          const input = JSON.parse(state.toolInputJson) as {
            query?: string;
            code?: string;
            command?: string;
          };
          if (state.toolKind === "search" && input.query) {
            onStatus("searching", input.query);
          } else if (state.toolKind === "code") {
            const code = input.code ?? input.command ?? "";
            if (code) onArtifact?.({ kind: "code", code });
            onStatus("running");
          }
        } catch {
          // partial/malformed input JSON; keep the generic status
        }
        state.toolInputJson = null;
        state.toolKind = null;
      }
      break;
    }

    case "error":
      onError(payload.error?.message ?? "Unknown streaming error");
      break;
  }
}
