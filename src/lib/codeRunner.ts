/**
 * In-browser code execution for the interactive sandbox (user-triggered runs).
 * Python: Pyodide (WASM) in a dedicated Web Worker — true local execution.
 * JavaScript: an ephemeral Blob worker, terminated after every run.
 *
 * Timeout/stop terminates the worker outright, so runaway scripts can never
 * poison later runs; the next run spawns a fresh worker (and re-downloads the
 * cached Pyodide runtime from browser cache, not the network).
 */

export interface RunOutcome {
  output: string;
  error?: string;
  ok: boolean;
  /** Wall-clock duration of the run in ms (excludes runtime boot). */
  durationMs: number;
}

export const RUN_TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 20_000;

function cap(s: string): string {
  return s.length > OUTPUT_CAP
    ? s.slice(0, OUTPUT_CAP) + `\n… [truncated ${s.length - OUTPUT_CAP} chars]`
    : s;
}

let pyWorker: Worker | null = null;
let pyWorkerReady: Promise<void> | null = null;
let seq = 0;

function spawnPyWorker(): { worker: Worker; ready: Promise<void> } {
  const worker = new Worker(new URL("../workers/pyodideWorker.ts", import.meta.url), {
    type: "module",
  });
  const ready = new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent<{ id: number; output: string }>) => {
      if (e.data?.id === -1 && e.data.output === "__worker_ready__") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
  });
  return { worker, ready };
}

function getPyWorker(): { worker: Worker; ready: Promise<void> } {
  if (!pyWorker || !pyWorkerReady) {
    const spawned = spawnPyWorker();
    pyWorker = spawned.worker;
    pyWorkerReady = spawned.ready;
  }
  return { worker: pyWorker, ready: pyWorkerReady };
}

/** Kill the Python worker (Stop button / timeout). Next run gets a fresh one. */
export function killPythonWorker(): void {
  pyWorker?.terminate();
  pyWorker = null;
  pyWorkerReady = null;
}

export function runPython(
  code: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<RunOutcome> {
  const timeoutMs = opts?.timeoutMs ?? RUN_TIMEOUT_MS;
  const { worker, ready } = getPyWorker();
  const id = ++seq;
  const startedAt = performance.now();

  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onMsg);
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      killPythonWorker();
      finish({
        ok: false,
        output: "",
        error: `Execution timed out after ${Math.round(timeoutMs / 1000)}s (interpreter reset).`,
        durationMs: performance.now() - startedAt,
      });
    }, timeoutMs);

    const onAbort = () => {
      killPythonWorker();
      finish({
        ok: false,
        output: "",
        error: "Stopped.",
        durationMs: performance.now() - startedAt,
      });
    };
    opts?.signal?.addEventListener("abort", onAbort);

    const onMsg = (
      e: MessageEvent<{ id: number; ok: boolean; output: string; error?: string }>,
    ) => {
      if (e.data?.id !== id) return;
      finish({
        ok: e.data.ok,
        output: cap(e.data.output ?? ""),
        error: e.data.error ? cap(e.data.error) : undefined,
        durationMs: performance.now() - startedAt,
      });
    };
    worker.addEventListener("message", onMsg);

    void ready.then(() => {
      if (!settled) worker.postMessage({ id, code });
    });
  });
}

const JS_WORKER_SOURCE = `
self.onmessage = async (e) => {
  const logs = [];
  const push = (...a) =>
    logs.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));
  console.log = push; console.error = push; console.warn = push; console.info = push;
  try {
    const result = await eval(e.data.code);
    self.postMessage({ ok: true, logs, result: result === undefined ? "" : String(result) });
  } catch (err) {
    self.postMessage({ ok: false, logs, error: String(err) });
  }
};
`;

export function runJavaScript(
  code: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<RunOutcome> {
  const timeoutMs = opts?.timeoutMs ?? RUN_TIMEOUT_MS;
  const blob = new Blob([JS_WORKER_SOURCE], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const startedAt = performance.now();

  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        output: "",
        error: `Execution timed out after ${Math.round(timeoutMs / 1000)}s.`,
        durationMs: performance.now() - startedAt,
      });
    }, timeoutMs);

    const onAbort = () => {
      finish({
        ok: false,
        output: "",
        error: "Stopped.",
        durationMs: performance.now() - startedAt,
      });
    };
    opts?.signal?.addEventListener("abort", onAbort);

    worker.onmessage = (
      e: MessageEvent<{ ok: boolean; logs: string[]; result?: string; error?: string }>,
    ) => {
      const body = e.data.logs.join("\n");
      if (e.data.ok) {
        finish({
          ok: true,
          output: cap([body, e.data.result].filter(Boolean).join("\n")),
          durationMs: performance.now() - startedAt,
        });
      } else {
        finish({
          ok: false,
          output: cap(body),
          error: e.data.error ?? "Error",
          durationMs: performance.now() - startedAt,
        });
      }
    };
    worker.onerror = (err) => {
      finish({
        ok: false,
        output: "",
        error: String(err.message ?? err),
        durationMs: performance.now() - startedAt,
      });
    };

    worker.postMessage({ code });
  });
}

/** Dispatch by tool language. */
export function runCode(
  language: string,
  code: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<RunOutcome> {
  return /^py/i.test(language) ? runPython(code, opts) : runJavaScript(code, opts);
}
