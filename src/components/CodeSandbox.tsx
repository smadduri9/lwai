import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { runCode, RUN_TIMEOUT_MS } from "../lib/codeRunner";

interface TerminalEntry {
  stream: "out" | "err" | "meta";
  text: string;
}

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    padding: "8px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--color-ink-300, #b8b2a7)",
  },
  "&.cm-focused": { outline: "none" },
});

/**
 * Mini-IDE for LLM-generated code: an editable CodeMirror editor seeded with
 * the tool call's code, a Run/Stop toolbar, and an attached terminal block
 * showing stdout/stderr. Python executes locally in a Pyodide Web Worker;
 * JavaScript in an ephemeral sandboxed worker. The user can read, edit, and
 * re-run before trusting any result.
 */
export function CodeSandbox({
  language,
  code,
  autoRunOutput,
  autoRunFailed,
}: {
  language: string;
  /** Code from the tool call (may still be streaming in). */
  code: string;
  /** Output of the server-side auto-run, pre-filled into the terminal. */
  autoRunOutput?: string;
  autoRunFailed?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastPushedCode = useRef<string>("");
  const userEdited = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<TerminalEntry[] | null>(null);

  // Create the editor once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || viewRef.current) return;
    const langExt = /^py/i.test(language) ? python() : javascript();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          langExt,
          editorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && u.state.doc.toString() !== lastPushedCode.current) {
              userEdited.current = true;
            }
          }),
        ],
      }),
    });
    lastPushedCode.current = code;
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the tool input is still streaming, keep syncing the doc — until the
  // user edits, at which point their version wins.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || userEdited.current || code === lastPushedCode.current) return;
    lastPushedCode.current = code;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  }, [code]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = async () => {
    const view = viewRef.current;
    if (!view || running) return;
    const source = view.state.doc.toString();
    if (!source.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setEntries([{ stream: "meta", text: `$ run (${/^py/i.test(language) ? "python" : "javascript"})` }]);
    const outcome = await runCode(language, source, {
      timeoutMs: RUN_TIMEOUT_MS,
      signal: controller.signal,
    });
    setEntries((prev) => {
      const next = [...(prev ?? [])];
      if (outcome.output) next.push({ stream: "out", text: outcome.output });
      if (outcome.error) next.push({ stream: "err", text: outcome.error });
      next.push({
        stream: "meta",
        text: outcome.ok
          ? `✓ finished in ${(outcome.durationMs / 1000).toFixed(2)}s`
          : `✗ failed after ${(outcome.durationMs / 1000).toFixed(2)}s`,
      });
      return next;
    });
    setRunning(false);
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const reset = () => {
    const view = viewRef.current;
    if (!view) return;
    userEdited.current = false;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: lastPushedCode.current },
    });
  };

  // Before the first local run, show the server auto-run's result.
  const terminal: TerminalEntry[] =
    entries ??
    (autoRunOutput !== undefined && autoRunOutput !== ""
      ? [
          { stream: "meta", text: "$ auto-run (model)" },
          { stream: autoRunFailed ? "err" : "out", text: autoRunOutput },
        ]
      : []);

  return (
    <div className="code-sandbox" onMouseDown={(e) => e.stopPropagation()}>
      <div className="code-sandbox-toolbar">
        <span className="code-sandbox-lang">{/^py/i.test(language) ? "Python" : "JavaScript"}</span>
        <span className="flex-1" />
        <button type="button" onClick={reset} className="code-sandbox-btn" title="Restore the model's original code">
          Reset
        </button>
        {running ? (
          <button type="button" onClick={stop} className="code-sandbox-btn code-sandbox-btn--stop">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => void run()} className="code-sandbox-btn code-sandbox-btn--run">
            ▶ Run
          </button>
        )}
      </div>
      <div ref={hostRef} className="code-sandbox-editor" />
      {(terminal.length > 0 || running) && (
        <div className="code-sandbox-terminal" aria-live="polite">
          {terminal.map((e, i) => (
            <pre
              key={i}
              className={
                e.stream === "err"
                  ? "code-sandbox-line code-sandbox-line--err"
                  : e.stream === "meta"
                    ? "code-sandbox-line code-sandbox-line--meta"
                    : "code-sandbox-line"
              }
            >
              {e.text}
            </pre>
          ))}
          {running && <pre className="code-sandbox-line code-sandbox-line--meta">running…</pre>}
        </div>
      )}
    </div>
  );
}
