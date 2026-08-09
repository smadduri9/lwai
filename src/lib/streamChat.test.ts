import { describe, it, expect, vi, afterEach } from "vitest";
import { streamChat, type UsageUpdate } from "./streamChat";
import type { Artifact, StreamPhase } from "../types";

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function run(events: object[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

  const deltas: string[] = [];
  const phases: StreamPhase[] = [];
  const artifacts: Artifact[] = [];
  const usage: UsageUpdate[] = [];
  const toolEvents: Array<{ kind: string; id: string; payload?: string }> = [];
  let done = false;
  let error: string | null = null;

  await streamChat([{ role: "user", content: "hi" }], {
    onDelta: (t) => deltas.push(t),
    onStatus: (phase) => phases.push(phase),
    onCitation: () => {},
    onArtifact: (a) => artifacts.push(a),
    onToolStart: (t) => toolEvents.push({ kind: "start", id: t.id, payload: t.name }),
    onToolInput: (t) => toolEvents.push({ kind: "input", id: t.id, payload: t.input }),
    onToolResult: (t) =>
      toolEvents.push({ kind: `result:${t.status}`, id: t.id, payload: t.output }),
    onUsage: (u) => usage.push(u),
    onDone: () => {
      done = true;
    },
    onError: (m) => {
      error = m;
    },
  });

  return { deltas, phases, artifacts, usage, toolEvents, done, error };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChat code-execution parsing", () => {
  it("emits code, output, and file artifacts with statuses and usage", async () => {
    const result = await run([
      {
        type: "message_start",
        message: { model: "claude-test", usage: { input_tokens: 12 } },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "server_tool_use", name: "code_execution" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"code":"print(' },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '1)"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "code_execution_tool_result",
          content: {
            type: "code_execution_result",
            stdout: "1\n",
            stderr: "",
            content: [{ type: "code_execution_output", file_id: "file_abc", name: "chart.png" }],
          },
        },
      },
      { type: "content_block_start", index: 3, content_block: { type: "text" } },
      {
        type: "content_block_delta",
        index: 3,
        delta: { type: "text_delta", text: "Here is the chart." },
      },
      { type: "content_block_stop", index: 3 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } },
    ]);

    expect(result.error).toBeNull();
    expect(result.done).toBe(true);
    expect(result.deltas.join("")).toBe("Here is the chart.");

    expect(result.artifacts).toEqual([
      { kind: "code", code: "print(1)" },
      { kind: "output", stdout: "1\n", stderr: "" },
      { kind: "file", fileId: "file_abc", filename: "chart.png" },
    ]);

    expect(result.phases).toContain("coding");
    expect(result.phases).toContain("running");
    expect(result.phases).toContain("writing");

    const merged = Object.assign({}, ...result.usage) as UsageUpdate;
    expect(merged.model).toBe("claude-test");
    expect(merged.inputTokens).toBe(12);
    expect(merged.outputTokens).toBe(40);
    expect(merged.codeRuns).toBe(1);
    expect(merged.ttftMs).toBeGreaterThanOrEqual(0);
    expect(merged.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles bash-flavor result blocks and searches alongside code", async () => {
    const result = await run([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", name: "web_search" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":"gdp of france"}' },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "server_tool_use", name: "bash_code_execution" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"command":"ls -la"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "bash_code_execution_tool_result",
          content: { type: "bash_code_execution_result", stdout: "total 0", stderr: "" },
        },
      },
    ]);

    expect(result.error).toBeNull();
    expect(result.artifacts).toEqual([
      { kind: "code", code: "ls -la" },
      { kind: "output", stdout: "total 0", stderr: "" },
    ]);
    const merged = Object.assign({}, ...result.usage) as UsageUpdate;
    expect(merged.searches).toBe(1);
    expect(merged.codeRuns).toBe(1);
  });

  it("surfaces thinking as a status without leaking it into the text", async () => {
    const result = await run([
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me reason about this..." },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig_abc123" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer." } },
      { type: "content_block_stop", index: 1 },
    ]);

    expect(result.error).toBeNull();
    expect(result.deltas.join("")).toBe("Answer.");
    expect(result.phases).toContain("thinking");
    expect(result.phases).toContain("writing");
  });
});

describe("streamChat standard tool events", () => {
  it("parses tool_start / tool_input / tool_result with statuses", async () => {
    const result = await run([
      { type: "tool_start", tool: { id: "call_1", name: "execute_code" } },
      {
        type: "tool_input",
        tool: { id: "call_1", input: '{"language":"python","code":"print(2+2)"}' },
      },
      { type: "tool_result", tool: { id: "call_1", output: "4", status: "done" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "It is 4." } },
      { type: "tool_start", tool: { id: "call_2", name: "web_search" } },
      { type: "tool_result", tool: { id: "call_2", output: "boom", status: "error" } },
    ]);

    expect(result.error).toBeNull();
    expect(result.toolEvents).toEqual([
      { kind: "start", id: "call_1", payload: "execute_code" },
      { kind: "input", id: "call_1", payload: '{"language":"python","code":"print(2+2)"}' },
      { kind: "result:done", id: "call_1", payload: "4" },
      { kind: "start", id: "call_2", payload: "web_search" },
      { kind: "result:error", id: "call_2", payload: "boom" },
    ]);
    expect(result.phases).toContain("coding");
    expect(result.phases).toContain("searching");
    expect(result.deltas.join("")).toBe("It is 4.");
  });
});
