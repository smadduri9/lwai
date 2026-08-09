import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { pendingFromChatImage } from "../lib/chatImageSelect";
import { regenerateFromEdit } from "../lib/send";
import { useSelectionStore } from "../store/selectionStore";
import { AddToNotebookButton } from "./AddToNotebookButton";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallCard } from "./ToolCallCard";
import type { Artifact, Message, StreamStatus } from "../types";

function StatusLine({ status }: { status: StreamStatus }) {
  const label =
    status.phase === "searching"
      ? status.query
        ? `Searching the web for “${status.query}”`
        : "Searching the web"
      : status.phase === "reading"
        ? "Reading"
        : status.phase === "coding"
          ? "Executing code"
          : status.phase === "running"
            ? "Running code"
            : status.phase === "diagramming"
              ? "Drawing diagram"
              : "Thinking";
  const chip =
    status.phase === "searching"
      ? "🔍 Search"
      : status.phase === "reading"
        ? "🌐 Read"
        : status.phase === "coding" || status.phase === "running"
          ? "🧠 Code"
          : status.phase === "diagramming"
            ? "📊 Diagram"
            : null;
  return (
    <span className="inline-flex items-center gap-2 py-0.5 text-sm text-ink-400 italic">
      {chip ? (
        <span className="text-[11px] font-medium not-italic tracking-wide uppercase">{chip}</span>
      ) : (
        <span className="inline-flex gap-1" aria-hidden>
          <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:0ms]" />
          <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:150ms]" />
          <span className="size-1 animate-bounce rounded-full bg-ink-400 [animation-delay:300ms]" />
        </span>
      )}
      {label}…
    </span>
  );
}

function Sources({ message }: { message: Message }) {
  if (!message.citations?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-ink-400">Sources:</span>
      {message.citations.map((c, i) => (
        <a
          key={c.url}
          href={c.url}
          target="_blank"
          rel="noreferrer"
          title={c.title}
          className="max-w-56 truncate rounded-full border border-ivory-300 bg-ivory-50 px-2 py-0.5 text-xs text-ink-500 transition-colors hover:border-clay-200 hover:text-clay-600"
        >
          {i + 1}. {hostname(c.url)}
        </a>
      ))}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

function CodeArtifact({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const lines = code.split("\n").length;
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-ivory-300 bg-ivory-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-[11px] text-ink-500 transition-colors hover:bg-ivory-100 hover:text-ink-800"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        ran code · {lines} line{lines === 1 ? "" : "s"}
      </button>
      {open && (
        <pre className="code-block-surface max-h-72 overflow-auto border-t border-ivory-200 p-3 text-[12px] leading-relaxed">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function OutputArtifact({ stdout, stderr }: { stdout: string; stderr: string }) {
  const [open, setOpen] = useState(false);
  const text = [stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n");
  if (!text) return null;
  const lines = text.split("\n");
  const long = lines.length > 8;
  const shown = open || !long ? text : lines.slice(0, 8).join("\n");
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-ivory-300">
      <pre className="code-block-surface max-h-72 overflow-auto p-3 font-mono text-[12px] leading-relaxed">
        <code>{shown}</code>
      </pre>
      {long && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full bg-ivory-50 px-3 py-1 text-left font-mono text-[11px] text-ink-500 transition-colors hover:bg-ivory-100"
        >
          {open ? "▾ collapse" : `▸ ${lines.length - 8} more lines`}
        </button>
      )}
    </div>
  );
}

function FileArtifact({
  fileId,
  filename,
  messageId,
}: {
  fileId: string;
  filename?: string;
  messageId: string;
}) {
  const [broken, setBroken] = useState(false);
  const setPending = useSelectionStore((s) => s.setPending);
  const url = `/api/files/${fileId}`;
  // Files without a name in the stream are usually charts; try rendering as an
  // image and fall back to a download link if it isn't one.
  const looksLikeImage = !filename || IMAGE_RE.test(filename);

  const onImageClick = (e: ReactMouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const pending = pendingFromChatImage(e.currentTarget, messageId);
    if (pending) setPending(pending);
  };

  if (looksLikeImage && !broken) {
    return (
      <span className="my-2 block w-fit">
        <img
          data-chat-image
          src={url}
          alt={filename ?? "Generated chart"}
          title="Click to add to note"
          onError={() => setBroken(true)}
          onClick={onImageClick}
          className="max-h-[420px] max-w-full cursor-pointer rounded-lg border border-ivory-300 bg-card shadow-sm"
        />
      </span>
    );
  }
  return (
    <a
      href={url}
      download={filename}
      className="my-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-ivory-300 bg-ivory-50 px-3 py-1 text-xs text-ink-600 transition-colors hover:border-clay-200 hover:text-clay-600"
    >
      📎 {filename ?? fileId}
    </a>
  );
}

function Artifacts({
  artifacts,
  messageId,
}: {
  artifacts?: Artifact[];
  messageId: string;
}) {
  if (!artifacts?.length) return null;
  return (
    <div>
      {artifacts.map((a, i) =>
        a.kind === "code" ? (
          <CodeArtifact key={i} code={a.code} />
        ) : a.kind === "output" ? (
          <OutputArtifact key={i} stdout={a.stdout} stderr={a.stderr} />
        ) : a.kind === "tool" ? (
          <ToolCallCard key={a.id} artifact={a} />
        ) : (
          <FileArtifact
            key={i}
            fileId={a.fileId}
            filename={a.filename}
            messageId={messageId}
          />
        ),
      )}
    </div>
  );
}

/**
 * Seamless in-place editor for a past user message: a borderless textarea
 * that auto-resizes to its content, with Cancel / Save & Submit below.
 * Saving truncates the thread from this message and regenerates.
 */
function InlineUserEdit({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const [text, setText] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: grow/shrink to fit content exactly, cap at 60vh.
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * 0.6);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  };

  useLayoutEffect(resize, [text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onClose();
    void regenerateFromEdit(message.branchId, message.id, trimmed);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        aria-label="Edit message"
        className="block w-full resize-none rounded-lg border-0 bg-ivory-100/70 px-2 py-1 text-center text-[15px] leading-relaxed whitespace-pre-wrap text-ink-800 outline-none dark:bg-neutral-800/60"
      />
      <div className="mt-2 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ivory-100 hover:text-ink-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!text.trim()}
          className="rounded-full bg-clay-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-clay-600 disabled:cursor-not-allowed disabled:bg-ivory-300 disabled:text-ink-400"
        >
          Save &amp; Submit
        </button>
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  status,
}: {
  message: Message;
  status?: StreamStatus;
}) {
  const [editing, setEditing] = useState(false);

  if (message.role === "user") {
    if (editing) {
      return (
        <div className="py-2" data-message-id={message.id}>
          <InlineUserEdit message={message} onClose={() => setEditing(false)} />
        </div>
      );
    }

    return (
      <div className="group relative py-2" data-message-id={message.id}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit prompt and resend"
          className="absolute top-1 right-0 inline-flex items-center gap-1 rounded-full border border-ivory-300 bg-card px-2 py-1 text-[11px] font-medium text-ink-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:border-clay-500/50 hover:text-clay-600 focus-visible:opacity-100"
        >
          <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
            <path
              d="M11.5 2.5l2 2M3 13l.7-3.2L10.8 2.7a1.2 1.2 0 011.7 0l.8.8a1.2 1.2 0 010 1.7L5.2 12.3 2 13z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Edit
        </button>
        <div className="mx-auto max-w-2xl px-2 text-center text-[15px] leading-relaxed whitespace-pre-wrap text-ink-800">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant messages read like document text on the paper, Docs-style.
  return (
    <div className="group/msg relative py-1" data-message-id={message.id}>
      <Artifacts artifacts={message.artifacts} messageId={message.id} />
      {message.content !== "" && <AssistantMessage message={message} />}
      {status && (
        <div className={message.content ? "mt-1.5" : ""}>
          <StatusLine status={status} />
        </div>
      )}
      <Sources message={message} />
      {!status && message.content !== "" && (
        <div className="mt-1.5 flex justify-end opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
          <AddToNotebookButton
            compact
            getAnchor={() => ({
              sourceType: "chat",
              sourceMessageId: message.id,
              branchId: message.branchId,
              quotedText: message.content,
              startOffset: 0,
              endOffset: message.content.length,
            })}
          />
        </div>
      )}
    </div>
  );
});
