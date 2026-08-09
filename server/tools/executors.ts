import { Worker } from "node:worker_threads";
import type { StandardToolName } from "../../shared/tools.ts";
import { searchWikimediaCached } from "./imageSearch.ts";

const CODE_TIMEOUT_MS = 20_000;
const OUTPUT_CAP = 12_000;
const URL_TEXT_CAP = 8_000;

export interface ToolRunResult {
  output: string;
  status: "done" | "error";
}

function cap(s: string, max = OUTPUT_CAP): string {
  return s.length > max ? s.slice(0, max) + `\n… [truncated ${s.length - max} chars]` : s;
}

/** Dispatch a standard tool call. Never throws — errors become { status: "error" }. */
export async function runStandardTool(
  name: StandardToolName | string,
  rawInput: string,
): Promise<ToolRunResult> {
  let input: Record<string, unknown>;
  try {
    input = rawInput.trim() ? (JSON.parse(rawInput) as Record<string, unknown>) : {};
  } catch {
    return { output: "Invalid JSON tool input.", status: "error" };
  }
  try {
    switch (name) {
      case "execute_code":
        return await executeCode(String(input.language ?? "python"), String(input.code ?? ""));
      case "generate_diagram":
        return generateDiagram(String(input.mermaid ?? ""));
      case "fetch_image":
        return await fetchImages(input);
      case "fetch_url_content":
        return await fetchUrlContent(String(input.url ?? ""));
      case "web_search":
        return await webSearch(String(input.query ?? ""));
      default:
        return { output: `Unknown tool: ${name}`, status: "error" };
    }
  } catch (err) {
    return { output: `Tool failed: ${String(err)}`, status: "error" };
  }
}

// ---- execute_code ----------------------------------------------------------

async function executeCode(language: string, code: string): Promise<ToolRunResult> {
  if (!code.trim()) return { output: "No code provided.", status: "error" };
  if (/^py/i.test(language)) return executePython(code);
  return executeJavaScript(code);
}

/** Pyodide instance cached across requests (first load takes a few seconds). */
let pyodidePromise: Promise<unknown> | null = null;

async function getPyodide(): Promise<{
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched: (s: string) => void }) => void;
  setStderr: (opts: { batched: (s: string) => void }) => void;
}> {
  if (!pyodidePromise) {
    pyodidePromise = import("pyodide").then((m) => m.loadPyodide());
  }
  return pyodidePromise as Promise<{
    runPythonAsync: (code: string) => Promise<unknown>;
    setStdout: (opts: { batched: (s: string) => void }) => void;
    setStderr: (opts: { batched: (s: string) => void }) => void;
  }>;
}

async function executePython(code: string): Promise<ToolRunResult> {
  const run = async (): Promise<ToolRunResult> => {
    const py = await getPyodide();
    const lines: string[] = [];
    py.setStdout({ batched: (s) => lines.push(s) });
    py.setStderr({ batched: (s) => lines.push(s) });
    try {
      const result = await py.runPythonAsync(code);
      let out = lines.join("\n");
      if (result !== undefined && result !== null && String(result) !== "undefined") {
        const repr = String(result);
        if (repr && repr !== "None" && !out.endsWith(repr)) {
          out = out ? `${out}\n${repr}` : repr;
        }
      }
      return { output: cap(out || "(no output)"), status: "done" };
    } catch (err) {
      const out = lines.join("\n");
      return {
        output: cap(`${out ? out + "\n" : ""}${String(err)}`),
        status: "error",
      };
    }
  };
  return withTimeout(run(), CODE_TIMEOUT_MS, "Python execution timed out.");
}

function executeJavaScript(code: string): Promise<ToolRunResult> {
  return new Promise((resolve) => {
    const workerSource = `
      const { parentPort, workerData } = require("node:worker_threads");
      const logs = [];
      const push = (...a) => logs.push(a.map((x) => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "));
      console.log = push; console.error = push; console.warn = push; console.info = push;
      (async () => {
        try {
          const result = await eval(workerData.code);
          parentPort.postMessage({ ok: true, logs, result: result === undefined ? "" : String(result) });
        } catch (e) {
          parentPort.postMessage({ ok: false, logs, error: String(e) });
        }
      })();
    `;
    let settled = false;
    const worker = new Worker(workerSource, { eval: true, workerData: { code } });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve({ output: "JavaScript execution timed out.", status: "error" });
    }, CODE_TIMEOUT_MS);

    worker.once(
      "message",
      (msg: { ok: boolean; logs: string[]; result?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        const body = msg.logs.join("\n");
        if (msg.ok) {
          const out = [body, msg.result].filter(Boolean).join("\n");
          resolve({ output: cap(out || "(no output)"), status: "done" });
        } else {
          resolve({
            output: cap(`${body ? body + "\n" : ""}${msg.error ?? "Error"}`),
            status: "error",
          });
        }
      },
    );
    worker.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output: `Worker error: ${String(err)}`, status: "error" });
    });
  });
}

// ---- generate_diagram --------------------------------------------------------

const MERMAID_TYPES =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|timeline|mindmap|quadrantChart)/;

export function generateDiagram(mermaid: string): ToolRunResult {
  let src = mermaid.trim();
  if (!src) return { output: "Empty diagram source.", status: "error" };

  // Models often wrap the source in markdown fences despite instructions —
  // strip them instead of failing.
  const fenced = /^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/.exec(src);
  if (fenced) src = fenced[1].trim();

  if (!MERMAID_TYPES.test(src)) {
    return {
      output: `Invalid Mermaid: source must START with a diagram keyword on its own line (flowchart TD, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie, timeline, mindmap, quadrantChart). Got: "${src.slice(0, 60)}". Fix the source and call generate_diagram again.`,
      status: "error",
    };
  }
  if (src.includes("```")) {
    return {
      output:
        "Invalid Mermaid: markdown fences (```) inside the source. Remove them and call generate_diagram again with pure Mermaid syntax.",
      status: "error",
    };
  }
  // Cheap structural lint: unbalanced brackets/parens/quotes are the most
  // common failure mode; reject with a corrective hint so the model retries.
  const counts = { "[": 0, "]": 0, "(": 0, ")": 0, "{": 0, "}": 0 };
  let quotes = 0;
  for (const ch of src) {
    if (ch in counts) counts[ch as keyof typeof counts] += 1;
    if (ch === '"') quotes += 1;
  }
  if (
    counts["["] !== counts["]"] ||
    counts["("] !== counts[")"] ||
    counts["{"] !== counts["}"] ||
    quotes % 2 !== 0
  ) {
    return {
      output:
        "Invalid Mermaid: unbalanced brackets, parentheses, or quotes. Wrap node labels containing spaces/punctuation in double quotes (e.g. A[\"Load data (CSV)\"]), close every bracket, and call generate_diagram again.",
      status: "error",
    };
  }
  // The frontend renders the mermaid source; the tool result echoes it back.
  return { output: src, status: "done" };
}

// ---- fetch_image ------------------------------------------------------------

const IMAGE_MAX_QUERIES = 12;

/**
 * Multi-query image fetch: runs every query against Wikimedia Commons
 * concurrently and returns Markdown image syntax for each hit so the model
 * can embed the images directly in its reply.
 */
export async function fetchImages(input: Record<string, unknown>): Promise<ToolRunResult> {
  // Accept `queries: string[]` (canonical) and tolerate the legacy
  // `query: string` shape so older transcripts / smaller models still work.
  const raw = Array.isArray(input.queries)
    ? input.queries
    : typeof input.queries === "string"
      ? [input.queries]
      : typeof input.query === "string"
        ? [input.query]
        : [];
  const queries = [...new Set(raw.map((q) => String(q).trim()).filter(Boolean))].slice(
    0,
    IMAGE_MAX_QUERIES,
  );
  if (queries.length === 0) {
    return { output: "No image queries provided. Pass queries: string[].", status: "error" };
  }

  const perQueryRaw = Number(input.per_query ?? input.count);
  const perQuery = Number.isFinite(perQueryRaw)
    ? Math.min(4, Math.max(1, Math.round(perQueryRaw)))
    : queries.length > 1
      ? 1
      : 4;

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        return { q, hits: (await searchWikimediaCached(q)).slice(0, perQuery) };
      } catch {
        return { q, hits: [] };
      }
    }),
  );

  const sections: string[] = [];
  const misses: string[] = [];
  for (const { q, hits } of results) {
    if (hits.length === 0) {
      misses.push(q);
      continue;
    }
    sections.push(
      hits
        .map((h) => `![${h.title.replace(/[[\]]/g, "")}](${h.thumb})`)
        .join("\n"),
    );
  }

  if (sections.length === 0) {
    return {
      output: `No images found for: ${queries.join(", ")}. Retry with broader or differently-worded search terms.`,
      status: "error",
    };
  }

  const out =
    "Copy these Markdown images into your reply exactly as-is (they render inline):\n\n" +
    sections.join("\n") +
    (misses.length ? `\n\n(No results for: ${misses.join(", ")})` : "");
  return { output: cap(out), status: "done" };
}

// ---- fetch_url_content --------------------------------------------------------

/**
 * Hosts the model must not reach through fetch_url_content: loopback, RFC 1918
 * ranges, and link-local metadata endpoints. The tool input is model-generated
 * (and thus influenced by fetched web content), so keep it off the local network.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fd") || h.startsWith("fc")) return true;
  return (
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^0\./.test(h)
  );
}

async function fetchUrlContent(url: string): Promise<ToolRunResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { output: "URL must be absolute http(s).", status: "error" };
  }
  try {
    if (isPrivateHost(new URL(url).hostname)) {
      return { output: "Local and private-network URLs are not fetchable.", status: "error" };
    }
  } catch {
    return { output: "Invalid URL.", status: "error" };
  }
  const r = await fetch(url, {
    headers: { "user-agent": "subchat-reader-dev/1.0 (educational tool)" },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!r.ok) return { output: `Fetch failed (${r.status}).`, status: "error" };
  // Redirects are followed — re-check the landing host so a public URL can't
  // bounce the fetch onto the local network.
  try {
    if (isPrivateHost(new URL(r.url).hostname)) {
      return { output: "Local and private-network URLs are not fetchable.", status: "error" };
    }
  } catch {
    // Keep going — r.url is empty for some upstream responses.
  }
  const type = r.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text") && !type.includes("json")) {
    return { output: `Unsupported content-type: ${type}`, status: "error" };
  }
  const raw = await r.text();
  if (type.includes("json")) return { output: cap(raw, URL_TEXT_CAP), status: "done" };
  return { output: cap(htmlToReadableText(raw), URL_TEXT_CAP), status: "done" };
}

/** Crude readability: strip chrome tags, prefer <article>/<main>, collapse whitespace. */
export function htmlToReadableText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const article = /<article[\s\S]*?<\/article>/i.exec(s)?.[0];
  const main = /<main[\s\S]*?<\/main>/i.exec(s)?.[0];
  const scope = article ?? main ?? s;

  const text = scope
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---- web_search --------------------------------------------------------------

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string): Promise<ToolRunResult> {
  if (!query.trim()) return { output: "Empty query.", status: "error" };
  const r = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { "user-agent": "Mozilla/5.0 (subchat-reader-dev educational tool)" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!r.ok) return { output: `Search failed (${r.status}).`, status: "error" };
  const html = await r.text();
  const hits = parseDuckDuckGoHtml(html).slice(0, 5);
  if (hits.length === 0) return { output: "No results found.", status: "done" };
  const out = hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join("\n\n");
  return { output: cap(out), status: "done" };
}

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = snippetRe.exec(html))) snippets.push(stripTags(m[1]));
  let i = 0;
  while ((m = linkRe.exec(html))) {
    const url = decodeDdgHref(m[1]);
    if (!url) continue;
    hits.push({ title: stripTags(m[2]), url, snippet: snippets[i] ?? "" });
    i += 1;
  }
  return hits;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** DDG wraps result URLs as /l/?uddg=<encoded>. */
function decodeDdgHref(href: string): string | null {
  try {
    if (href.startsWith("http")) {
      const u = new URL(href);
      const uddg = u.searchParams.get("uddg");
      return uddg ? decodeURIComponent(uddg) : href;
    }
    if (href.startsWith("//")) return decodeDdgHref("https:" + href);
    if (href.startsWith("/l/") || href.startsWith("/?")) {
      const u = new URL("https://duckduckgo.com" + href);
      const uddg = u.searchParams.get("uddg");
      return uddg ? decodeURIComponent(uddg) : null;
    }
    return null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T | ToolRunResult> {
  return Promise.race([
    p,
    new Promise<ToolRunResult>((resolve) =>
      setTimeout(() => resolve({ output: message, status: "error" }), ms),
    ),
  ]) as Promise<T | ToolRunResult>;
}
