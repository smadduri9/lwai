/**
 * Text-shaped tool-call detection for local models.
 *
 * Small local models (e.g. Llama 3.1) often emit the tool call as plain text
 * content — `{"name": "web_search", "parameters": {…}}` — instead of the
 * native `tool_calls` field. These helpers let the local provider hold back
 * suspicious text, parse it at turn end, and execute the tool instead of
 * leaking raw JSON into the chat.
 */

/** Give up holding text once this many chars accumulate without resolution. */
export const TOOL_TEXT_HOLD_CAP = 2048;

export interface ParsedTextToolCall {
  name: string;
  /** JSON string, ready to pass to runStandardTool. */
  arguments: string;
}

const PROSE_STARTERS = [
  "here is a function call",
  "here is a tool call",
  "here's a function call",
  "here's a tool call",
];

/** True while `partial` could still turn into `full` (case-insensitive). */
function prefixMatch(partial: string, full: string): boolean {
  const p = partial.toLowerCase();
  return p.length >= full.length ? p.startsWith(full) : full.startsWith(p);
}

/**
 * Should the provider keep holding this accumulated turn text because it may
 * be a text-shaped tool call? Callers should stop holding (and flush) once
 * this returns false or the text exceeds {@link TOOL_TEXT_HOLD_CAP}.
 */
export function mightBeToolCallText(raw: string): boolean {
  const t = raw.trimStart();
  if (!t) return true; // nothing but whitespace yet — keep waiting
  if (t[0] === "{" || t[0] === "[") return true;
  if (t.startsWith("`") || t.startsWith("``")) {
    if (t.length < 3) return true; // could still become a fence
  }
  if (t.startsWith("```")) {
    const after = t.slice(3).replace(/^\s*/, "");
    if (!after) return true;
    if (after[0] === "{" || after[0] === "[") return true;
    return prefixMatch(after.slice(0, 5), "json");
  }
  return PROSE_STARTERS.some((s) => prefixMatch(t.slice(0, s.length + 1).trimEnd(), s));
}

/** Extract the first balanced {…} object from text (string-aware). */
function firstBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Try to parse held text as a single tool call. Handles the OpenAI
 * `arguments` shape, Llama's `parameters` shape, `input`, nested
 * `{"function": {…}}`, fenced ```json blocks, and a leading prose line.
 * Returns null (caller flushes the text as normal content) when the JSON
 * doesn't parse or doesn't name an allowed tool.
 */
export function parseTextToolCall(
  text: string,
  allowedNames: ReadonlySet<string>,
): ParsedTextToolCall | null {
  let t = text.trim();
  if (!t) return null;

  // Unwrap a fenced block if present.
  const fence = t.match(/^[^\n{[]*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i);
  if (fence) t = fence[1].trim();

  // Strip a leading prose line ("Here is a function call…") before the JSON.
  const firstBrace = t.indexOf("{");
  const firstBracket = t.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  if (start > 0) t = t.slice(start);

  // Trim trailing prose after the JSON body.
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end < 0) return null;
  t = t.slice(0, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    // Models sometimes emit several JSON objects (or trailing junk) —
    // fall back to the first balanced object.
    const first = firstBalancedJson(t);
    if (!first) return null;
    try {
      parsed = JSON.parse(first);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) return null;
    parsed = parsed[0];
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  let name: unknown = obj.name;
  let args: unknown = obj.arguments ?? obj.parameters ?? obj.input;
  const fn = obj.function;
  if (fn && typeof fn === "object") {
    const f = fn as Record<string, unknown>;
    name = name ?? f.name;
    args = args ?? f.arguments ?? f.parameters ?? f.input;
  } else if (typeof fn === "string") {
    name = name ?? fn;
  }

  if (typeof name !== "string" || !allowedNames.has(name)) return null;

  let argStr: string;
  if (args == null) {
    argStr = "{}";
  } else if (typeof args === "string") {
    try {
      JSON.parse(args);
    } catch {
      return null;
    }
    argStr = args;
  } else if (typeof args === "object") {
    argStr = JSON.stringify(args);
  } else {
    return null;
  }

  return { name, arguments: argStr };
}
