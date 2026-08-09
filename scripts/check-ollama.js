#!/usr/bin/env node
/**
 * Preflight for `npm run dev` (wired as the `predev` hook).
 *
 * Zero-friction local setup:
 *   1. Ping the local Ollama server (http://127.0.0.1:11434).
 *   2. Offline + no other provider configured -> bold error, abort dev.
 *   3. Online but the default model is missing -> `ollama pull` it in the
 *      background so the app has a working model by the time it's needed.
 *
 * No dependencies — plain Node 18+ (global fetch) and raw ANSI colors.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OLLAMA_BASE = process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434";
const LMSTUDIO_BASE = "http://127.0.0.1:1234";
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || "llama3.2";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

async function ping(base, path = "/") {
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** True when .env configures at least one cloud provider key. */
function hasCloudKeys() {
  if (!existsSync(".env")) return false;
  try {
    const env = readFileSync(".env", "utf8");
    return /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY)\s*=\s*\S+/m.test(env);
  } catch {
    return false;
  }
}

async function installedModels() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const json = await r.json();
    return (json.models ?? []).map((m) => String(m.name ?? ""));
  } catch {
    return [];
  }
}

function pullModelInBackground(model) {
  console.log(
    `${yellow("⬇")}  Default model ${bold(model)} not installed — pulling it in the background.`,
  );
  console.log(`   Watch progress anytime with: ${cyan(`ollama pull ${model}`)}\n`);
  const child = spawn("ollama", ["pull", model], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    console.log(
      yellow(`   Could not spawn "ollama pull ${model}" — run it manually when convenient.`),
    );
  });
  child.unref();
}

const ollamaUp = await ping(OLLAMA_BASE);

if (!ollamaUp) {
  const lmStudioUp = await ping(LMSTUDIO_BASE, "/v1/models");
  if (lmStudioUp) {
    console.log(green("✔") + "  LM Studio detected on :1234 — using it as the local provider.\n");
  } else if (hasCloudKeys()) {
    console.log(
      yellow("⚠") +
        "  Ollama is not running — local models will be unavailable, falling back to your cloud API keys.\n" +
        `   To enable local models, open the Ollama app or run ${cyan("ollama serve")}.\n`,
    );
  } else {
    console.error(
      "\n" +
        bold(red("✖  Ollama is not running — the app has no model to talk to.")) +
        "\n\n" +
        bold("   Fix: open the Ollama app (or run `ollama serve`), then retry `npm run dev`.") +
        "\n" +
        `   Don't have it? Download from ${cyan("https://ollama.com")}\n` +
        `   Prefer cloud models instead? Copy ${cyan(".env.example")} to ${cyan(".env")} and add an API key.\n`,
    );
    process.exit(1);
  }
} else {
  // The app auto-selects the first installed chat model, so any model will do;
  // only auto-pull the default when the library is completely empty.
  const models = await installedModels();
  if (models.length === 0) {
    pullModelInBackground(DEFAULT_MODEL);
  } else {
    console.log(
      green("✔") +
        `  Ollama is running (${models.length} model${models.length === 1 ? "" : "s"} installed).\n`,
    );
  }
}
