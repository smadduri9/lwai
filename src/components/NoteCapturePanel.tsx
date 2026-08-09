import { useEffect, useRef, useState } from "react";
import { useNotebookStore } from "../store/notebookStore";
import { useUiStore } from "../store/uiStore";
import { QuoteBlock } from "./QuoteBlock";

/**
 * Pre-save editor for a capture into the last-used notebook: quoted selection
 * plus an optional thought.
 */
export function NoteCapturePanel() {
  const capture = useUiStore((s) => s.noteCapture);
  const setNoteCapture = useUiStore((s) => s.setNoteCapture);
  const appendCapture = useNotebookStore((s) => s.appendCapture);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!capture) {
      setText("");
      return;
    }
    setText("");
    const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, [capture]);

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNoteCapture(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, setNoteCapture]);

  if (!capture) return null;

  const { rect, anchor } = capture;
  const top = Math.min(rect.bottom + 10, window.innerHeight - 280);
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 360);

  const save = () => {
    void (async () => {
      await appendCapture(anchor, text.trim());
      setNoteCapture(null);
      window.getSelection()?.removeAllRanges();
    })();
  };

  return (
    <div
      style={{ position: "fixed", top, left, zIndex: 99999 }}
      className="w-[340px] rounded-xl border border-ivory-300 bg-card p-3 shadow-xl shadow-ink-900/15"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <QuoteBlock anchor={anchor} className="mb-3 max-h-24 overflow-y-auto px-2.5 py-1.5 text-sm" />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Add a thought (optional)… Enter for new line, ⌘/Ctrl+Enter to save"
        rows={3}
        className="mb-3 w-full resize-none rounded-lg border border-ivory-300 bg-ivory-50 px-3 py-2 text-sm text-ink-800 outline-none focus:border-clay-500"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setNoteCapture(null)}
          className="rounded-full px-3 py-1 text-xs font-medium text-ink-500 transition-colors hover:text-ink-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-clay-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-clay-600"
        >
          Save
        </button>
      </div>
    </div>
  );
}
