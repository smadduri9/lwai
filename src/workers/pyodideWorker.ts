/**
 * Web Worker host for the in-browser Python sandbox (Pyodide/WASM).
 * One interpreter is cached per worker; the owner terminates the whole worker
 * on timeout/stop, so a hung script can never poison later runs.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";

interface RunRequest {
  id: number;
  code: string;
}

interface RunResponse {
  id: number;
  ok: boolean;
  output: string;
  error?: string;
}

let pyodidePromise: Promise<PyodideInterface> | null = null;

function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { id, code } = e.data;
  const lines: string[] = [];
  try {
    const py = await getPyodide();
    py.setStdout({ batched: (s: string) => lines.push(s) });
    py.setStderr({ batched: (s: string) => lines.push(s) });
    const result = await py.runPythonAsync(code);
    let out = lines.join("\n");
    if (result !== undefined && result !== null) {
      const repr = String(result);
      if (repr && repr !== "None" && repr !== "undefined" && !out.endsWith(repr)) {
        out = out ? `${out}\n${repr}` : repr;
      }
    }
    const response: RunResponse = { id, ok: true, output: out };
    self.postMessage(response);
  } catch (err) {
    const response: RunResponse = {
      id,
      ok: false,
      output: lines.join("\n"),
      error: String(err),
    };
    self.postMessage(response);
  }
};

// Signal readiness so the owner can distinguish "loading Pyodide" from "running".
self.postMessage({ id: -1, ok: true, output: "__worker_ready__" });
