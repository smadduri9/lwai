import { useEffect, useRef, type KeyboardEvent } from "react";
import { useChatStore } from "../store/chatStore";
import { useUiStore } from "../store/uiStore";
import { sendMessage, stopMessage } from "../lib/send";
import { ModelPicker } from "./ModelPicker";

/**
 * Fixed-height composer (~3 lines) — no auto-grow or spring animation.
 * Long drafts scroll internally inside the textarea.
 *
 * Hero variant (empty landing): while the draft is blank it renders as a
 * bare blinking-caret line under the "Stay curious" heading; the moment a
 * character is typed the full panel (border, ModelPicker, Send) transitions
 * in around the same textarea, and reverts instantly when cleared.
 */
export function Composer({
  branchId,
  autoFocus = false,
  placeholder = "Send a message…",
  bare = false,
  showModel: _showModel = false,
  hero = false,
}: {
  branchId: string;
  autoFocus?: boolean;
  placeholder?: string;
  bare?: boolean;
  showModel?: boolean;
  hero?: boolean;
}) {
  const text = useUiStore((s) => s.drafts[branchId] ?? "");
  const setDraft = useUiStore((s) => s.setDraft);
  const setText = (value: string) => setDraft(branchId, value);
  const streaming = useChatStore((s) => Boolean(s.streamingBranches[branchId]));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const id = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(id);
  }, [autoFocus]);

  const submit = () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    void sendMessage(branchId, value);
  };

  const stop = () => stopMessage(branchId);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && streaming) {
      e.preventDefault();
      stop();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) submit();
    }
  };

  const actions = (
    <div
      className={`flex shrink-0 flex-row items-center gap-1.5 ${bare ? "w-full justify-end" : ""}`}
    >
      <ModelPicker compact={bare} />
      {streaming ? (
        <button
          type="button"
          onClick={stop}
          title="Stop generating (Esc)"
          className={`composer-stop-btn shrink-0 whitespace-nowrap rounded-full font-medium text-white shadow-sm ${
            bare ? "h-8 px-3 text-xs" : "px-3 py-2 text-sm"
          }`}
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className={`shrink-0 whitespace-nowrap rounded-full bg-clay-500 font-medium text-white transition-colors hover:bg-clay-600 disabled:cursor-not-allowed disabled:bg-ivory-300 disabled:text-ink-400 ${
            bare ? "h-8 px-3 text-xs" : "px-3 py-2 text-sm"
          }`}
        >
          Send
        </button>
      )}
    </div>
  );

  // Bare (rail / float): full-width input, then picker+Send — never side-by-side crush.
  if (bare) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5 p-2">
        <textarea
          ref={textareaRef}
          data-composer={branchId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={placeholder}
          className="composer-plane h-[72px] w-full min-w-0 resize-none overflow-y-auto rounded-2xl border border-ivory-300 bg-card px-3 py-2 text-[14px] leading-snug text-ink-800 placeholder-ink-400 shadow-sm outline-none focus:border-clay-500"
        />
        {actions}
      </div>
    );
  }

  if (hero) {
    const isBlank = text.length === 0;
    return (
      <div
        className={
          isBlank
            ? "flex items-center justify-center"
            : "composer-panel-enter flex items-center gap-2 rounded-2xl border border-ivory-300 bg-card p-1.5 shadow-md shadow-ink-900/10"
        }
      >
        <textarea
          ref={textareaRef}
          data-composer={branchId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={isBlank ? 1 : 3}
          aria-label="Start a new chat"
          className={
            isBlank
              ? // Minimal state: invisible input — just a centered blinking caret.
                "hero-caret-input h-[52px] w-full max-w-xl resize-none overflow-hidden border-0 bg-transparent text-center text-3xl text-ink-800 caret-clay-500 outline-none"
              : "composer-plane h-[84px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-3.5 py-2.5 text-[15px] leading-snug text-ink-800 placeholder-ink-400 outline-none"
          }
        />
        {!isBlank && actions}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-ivory-300 bg-card p-1.5 shadow-md shadow-ink-900/10">
      <textarea
        ref={textareaRef}
          data-composer={branchId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={placeholder}
        className="composer-plane h-[84px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-3.5 py-2.5 text-[15px] leading-snug text-ink-800 placeholder-ink-400 outline-none"
      />
      {actions}
    </div>
  );
}
