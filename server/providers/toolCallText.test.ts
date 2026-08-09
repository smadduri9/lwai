import { describe, expect, it } from "vitest";
import {
  mightBeToolCallText,
  parseTextToolCall,
  TOOL_TEXT_HOLD_CAP,
} from "./toolCallText.ts";

const TOOLS = new Set(["execute_code", "generate_diagram", "fetch_url_content", "web_search"]);

describe("parseTextToolCall", () => {
  it("parses the OpenAI arguments shape", () => {
    const r = parseTextToolCall(
      '{"name": "web_search", "arguments": {"query": "capital of france"}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"capital of france"}' });
  });

  it("parses the Llama parameters shape", () => {
    const r = parseTextToolCall(
      '{"name": "web_search", "parameters": {"query": "llama 3.1 release date"}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"llama 3.1 release date"}' });
  });

  it("parses stringified arguments", () => {
    const r = parseTextToolCall(
      '{"name": "execute_code", "arguments": "{\\"language\\": \\"python\\", \\"code\\": \\"print(1)\\"}"}',
      TOOLS,
    );
    expect(r?.name).toBe("execute_code");
    expect(JSON.parse(r!.arguments)).toEqual({ language: "python", code: "print(1)" });
  });

  it("parses the nested function shape", () => {
    const r = parseTextToolCall(
      '{"function": {"name": "fetch_url_content", "arguments": {"url": "https://example.com"}}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "fetch_url_content", arguments: '{"url":"https://example.com"}' });
  });

  it("parses a function-as-string shape", () => {
    const r = parseTextToolCall(
      '{"function": "web_search", "parameters": {"query": "x"}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"x"}' });
  });

  it("parses fenced JSON", () => {
    const r = parseTextToolCall(
      '```json\n{"name": "generate_diagram", "parameters": {"source": "graph TD; A-->B"}}\n```',
      TOOLS,
    );
    expect(r).toEqual({
      name: "generate_diagram",
      arguments: '{"source":"graph TD; A-->B"}',
    });
  });

  it("parses prose-prefixed JSON", () => {
    const r = parseTextToolCall(
      'Here is a function call:\n{"name": "web_search", "parameters": {"query": "y"}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"y"}' });
  });

  it("parses a single-element array wrapper", () => {
    const r = parseTextToolCall('[{"name": "web_search", "arguments": {"query": "z"}}]', TOOLS);
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"z"}' });
  });

  it("defaults missing arguments to {}", () => {
    const r = parseTextToolCall('{"name": "web_search"}', TOOLS);
    expect(r).toEqual({ name: "web_search", arguments: "{}" });
  });

  it("returns null for non-tool JSON (passthrough)", () => {
    expect(parseTextToolCall('{"answer": 42, "unit": "meaning"}', TOOLS)).toBeNull();
    expect(parseTextToolCall('{"name": "made_up_tool", "arguments": {}}', TOOLS)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseTextToolCall('{"name": "web_search", "arguments": {', TOOLS)).toBeNull();
    expect(parseTextToolCall("just a plain sentence", TOOLS)).toBeNull();
  });

  it("recovers the first balanced object from multi-object output", () => {
    const r = parseTextToolCall(
      '{"type":"function","function":{"name":"web_search","parameters":{"query":"a"}}}\n{"type":"function","function":{"name":"fetch_url_content","parameters":{"url":"b"}}}',
      TOOLS,
    );
    expect(r).toEqual({ name: "web_search", arguments: '{"query":"a"}' });
  });

  it("returns null for multi-element arrays", () => {
    expect(
      parseTextToolCall(
        '[{"name": "web_search", "arguments": {}}, {"name": "execute_code", "arguments": {}}]',
        TOOLS,
      ),
    ).toBeNull();
  });
});

describe("mightBeToolCallText", () => {
  it("holds text starting with JSON openers", () => {
    expect(mightBeToolCallText("{")).toBe(true);
    expect(mightBeToolCallText('  {"name":')).toBe(true);
    expect(mightBeToolCallText("[")).toBe(true);
  });

  it("holds empty / whitespace-only text", () => {
    expect(mightBeToolCallText("")).toBe(true);
    expect(mightBeToolCallText("  \n")).toBe(true);
  });

  it("holds partial and complete json fences", () => {
    expect(mightBeToolCallText("`")).toBe(true);
    expect(mightBeToolCallText("``")).toBe(true);
    expect(mightBeToolCallText("```")).toBe(true);
    expect(mightBeToolCallText("```j")).toBe(true);
    expect(mightBeToolCallText("```json\n{")).toBe(true);
    expect(mightBeToolCallText('```\n{"name"')).toBe(true);
  });

  it("holds a prose-prefixed function call lead-in", () => {
    expect(mightBeToolCallText("Here is a fun")).toBe(true);
    expect(mightBeToolCallText("Here is a function call:")).toBe(true);
  });

  it("releases ordinary prose immediately", () => {
    expect(mightBeToolCallText("The capital of France is Paris.")).toBe(false);
    expect(mightBeToolCallText("Sure! Let me explain.")).toBe(false);
  });

  it("releases non-json code fences", () => {
    expect(mightBeToolCallText("```python\nprint(1)")).toBe(false);
  });

  it("exposes a sane hold cap", () => {
    expect(TOOL_TEXT_HOLD_CAP).toBeGreaterThanOrEqual(1024);
  });
});
