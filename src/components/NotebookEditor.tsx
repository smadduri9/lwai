import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
// Same rendering CSS as the chat's MarkdownMessage — captured KaTeX math and
// highlighted code keep their exact chat appearance inside notes.
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import * as repo from "../db/workspaceRepository";
import { renderMermaidInto } from "./MermaidDiagram";
import { branchChain } from "../lib/context";
import { applyHighlights, type HighlightItem } from "../lib/highlight";
import { newId } from "../lib/id";
import {
  isAllowedNoteImage,
  isAppRelativeHref,
  NOTE_IMAGE_MAX_PER_NOTE,
  sanitizeNoteHtml,
} from "../lib/noteHtml";
import { chatUrl } from "../lib/chatUrl";
import { quoteLabel } from "../lib/quoteLabel";
import { rangeToOffsets } from "../lib/selection";
import { navigateInPage } from "../lib/workspaceTabs";
import { useChatStore } from "../store/chatStore";
import { useNotebookStore } from "../store/notebookStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { NotebookEntry } from "../types";

function FormatBtn({
  label,
  title,
  onMouseDown,
  className = "",
}: {
  label: string;
  title: string;
  onMouseDown: (e: ReactMouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-600 transition-colors hover:bg-ivory-100 hover:text-clay-600 ${className}`}
    >
      {label}
    </button>
  );
}

/**
 * One notebook document: rich-editable body, format bar, and linked chats
 * panel. Selecting text arms the "Ask more" toolbar (opens a new chat tab).
 */
export function NotebookEditor({
  notebook,
  showToolbar = true,
}: {
  notebook: NotebookEntry;
  /** When false, parent owns the format bar. */
  showToolbar?: boolean;
}) {
  const updateBody = useNotebookStore((s) => s.updateBody);
  const unlinkBranch = useNotebookStore((s) => s.unlinkBranch);
  const branches = useChatStore((s) => s.branches);
  const setWindowMode = useChatStore((s) => s.setWindowMode);
  const focusWindow = useChatStore((s) => s.focusWindow);
  const conversationId = useWorkspaceStore((s) => s.conversationId);
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranch = useUiStore((s) => s.setActiveBranch);
  const pendingNoteCaret = useUiStore((s) => s.pendingNoteCaret);
  const clearNoteCaret = useUiStore((s) => s.clearNoteCaret);
  const setPending = useSelectionStore((s) => s.setPending);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [asksOpen, setAsksOpen] = useState(false);
  const lastHtml = useRef(notebook.body);
  const skipHighlightSync = useRef(false);

  const hydrateImages = useCallback(async () => {
    const el = editorRef.current;
    if (!el) return;
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    const imgs = el.querySelectorAll<HTMLImageElement>("img[data-attachment-id]");
    if (imgs.length === 0) return;
    const attachments = await repo.getNoteAttachments(notebook.id);
    const byId = new Map(attachments.map((a) => [a.id, a]));
    for (const img of imgs) {
      const id = img.getAttribute("data-attachment-id");
      if (!id) continue;
      const att = byId.get(id);
      if (!att) continue;
      const url = URL.createObjectURL(att.blob);
      objectUrls.current.push(url);
      img.src = url;
    }
  }, [notebook.id]);

  /**
   * Render captured mermaid sources with the exact same pipeline as the chat:
   * each `pre[data-mermaid-source]` gets a read-only rendered view injected
   * after it (never persisted — sanitizeNoteHtml strips the views on save).
   * Invalid sources keep their visible code block as the clean fallback.
   */
  const hydrateMermaid = useCallback(async () => {
    const el = editorRef.current;
    if (!el) return;
    for (const pre of el.querySelectorAll<HTMLElement>("pre[data-mermaid-source]")) {
      if (pre.nextElementSibling?.hasAttribute("data-mermaid-view")) continue;
      const source = pre.textContent ?? "";
      if (!source.trim()) continue;
      const view = document.createElement("div");
      view.setAttribute("data-mermaid-view", "1");
      view.setAttribute("data-anchor-skip", "1");
      view.setAttribute("contenteditable", "false");
      view.className = "note-mermaid-view";
      pre.insertAdjacentElement("afterend", view);
      const ok = await renderMermaidInto(view, source);
      if (ok) pre.classList.add("note-mermaid-source-hidden");
      else view.remove();
    }
  }, []);

  useEffect(() => {
    const html = notebook.body;
    lastHtml.current = html;
    const el = editorRef.current;
    if (el && document.activeElement !== el) {
      el.innerHTML = html || "";
      void hydrateImages();
      void hydrateMermaid();
    }
  }, [notebook.id, notebook.body, hydrateImages, hydrateMermaid]);

  useEffect(() => {
    const el = editorRef.current;
    if (el && !el.innerHTML) {
      el.innerHTML = notebook.body || "";
      void hydrateImages();
      void hydrateMermaid();
    }
    return () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const highlightItems = useMemo((): HighlightItem[] => {
    return notebook.linkedBranchIds
      .map((id) => {
        const b = branches[id];
        if (!b?.anchor || !b.window) return null;
        return {
          branchId: id,
          anchor: b.anchor,
          minimized: b.window.mode === "minimized",
          active: id === activeBranchId,
          messageCount: b.messages.length,
        };
      })
      .filter((x): x is HighlightItem => x !== null);
  }, [notebook.linkedBranchIds, branches, activeBranchId]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || focused || skipHighlightSync.current) return;
    if (highlightItems.length === 0) return;
    applyHighlights(el, highlightItems);
  }, [highlightItems, focused, notebook.body]);

  useEffect(() => {
    if (!pendingNoteCaret) return;
    const el = editorRef.current;
    if (!el) return;

    const place = () => {
      const html = notebook.body;
      if (document.activeElement !== el) {
        el.innerHTML = html || "";
        lastHtml.current = html;
        void hydrateImages();
        void hydrateMermaid();
      }
      el.focus({ preventScroll: false });
      const last = el.lastElementChild;
      const range = document.createRange();
      const sel = window.getSelection();
      if (last) {
        range.selectNodeContents(last);
        range.collapse(false);
      } else {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      sel?.removeAllRanges();
      sel?.addRange(range);
      last?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setFocused(true);
      clearNoteCaret();
    };

    // Wait a tick so body sync from appendCapture has painted.
    const t = window.setTimeout(place, 40);
    return () => window.clearTimeout(t);
  }, [pendingNoteCaret, notebook, hydrateImages, clearNoteCaret]);

  const commitHtml = () => {
    const el = editorRef.current;
    if (!el) return;
    let i = 0;
    for (const h of el.querySelectorAll("h1, h2")) {
      const existing = h.getAttribute("data-heading-id")?.trim() ?? "";
      if (!existing || !/^[a-zA-Z0-9_-]+$/.test(existing)) {
        h.setAttribute("data-heading-id", `h-${++i}`);
      }
    }
    const next = sanitizeNoteHtml(el.innerHTML);
    if (next === lastHtml.current) return;
    lastHtml.current = next;
    updateBody(notebook.id, next);
  };

  const runFormat = (cmd: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    commitHtml();
  };

  const runBlockFormat = (tag: "p" | "h1" | "h2") => (e: ReactMouseEvent) => {
    e.preventDefault();
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, tag);
    commitHtml();
  };

  const insertImageBlob = async (file: Blob) => {
    if (!isAllowedNoteImage(file)) {
      window.alert("Use a PNG, JPEG, WebP, or GIF under 4 MB.");
      return;
    }
    const count = await repo.countNoteAttachments(notebook.id);
    if (count >= NOTE_IMAGE_MAX_PER_NOTE) {
      window.alert(`This notebook already has ${NOTE_IMAGE_MAX_PER_NOTE} images.`);
      return;
    }
    const id = newId();
    await repo.addNoteAttachment({
      id,
      notebookId: notebook.id,
      mimeType: file.type,
      blob: file,
    });
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const img = document.createElement("img");
    img.setAttribute("data-attachment-id", id);
    img.alt = "";
    img.src = url;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.appendChild(img);
    }
    commitHtml();
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void insertImageBlob(file);
        return;
      }
    }
  };

  const handleMouseUp = () => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !el.contains(sel.anchorNode) || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    // Don't arm Ask toolbar when the user is clicking a capture link.
    const anchorEl = (sel.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? (sel.anchorNode as HTMLElement)
      : sel.anchorNode?.parentElement
    )?.closest("a[href]");
    if (anchorEl && isAppRelativeHref(anchorEl.getAttribute("href") ?? "")) return;

    const offsets = rangeToOffsets(el, range);
    if (!offsets) return;
    const text = el.textContent ?? "";
    const quotedText = text.slice(offsets.startOffset, offsets.endOffset);
    if (!quotedText.trim()) return;
    const r = range.getBoundingClientRect();
    setPending({
      kind: "note",
      anchor: {
        sourceType: "note",
        sourceNoteId: notebook.id,
        quotedText,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
      },
      rect: {
        left: r.left,
        top: r.top,
        bottom: r.bottom,
        width: Math.max(r.width, 120),
      },
    });
  };

  const focusLinkedBranch = (branchId: string) => {
    const branch = useChatStore.getState().branches[branchId];
    if (!branch?.window) return;
    if (branch.window.mode === "minimized") {
      setWindowMode(branchId, branch.window.restoreMode ?? "bubble");
    }
    focusWindow(branchId);
    setActiveBranch(branchId);
    const mark = document.querySelector<HTMLElement>(`mark[data-branch-id="${branchId}"]`);
    mark?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const handleBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link && editorRef.current?.contains(link)) {
      const href = link.getAttribute("href") ?? "";
      if (isAppRelativeHref(href)) {
        e.preventDefault();
        e.stopPropagation();
        navigateInPage(href);
        return;
      }
    }
    const el = target.closest<HTMLElement>("mark[data-branch-id], button.subchat-badge");
    const branchId = el?.dataset.branchId;
    if (!branchId) return;
    e.preventDefault();
    e.stopPropagation();
    focusLinkedBranch(branchId);
  };

  return (
    <article data-note-id={notebook.id} className="group relative py-2">
      <div>
        {showToolbar && (
          <div
            className="mb-2 flex flex-wrap items-center gap-0.5 rounded-lg border border-ivory-200 bg-card px-1.5 py-1 shadow-sm"
            onMouseDown={(e) => e.preventDefault()}
          >
            <FormatBtn label="Body" title="Normal text" onMouseDown={runBlockFormat("p")} />
            <FormatBtn label="H1" title="Heading 1" className="font-semibold" onMouseDown={runBlockFormat("h1")} />
            <FormatBtn label="H2" title="Heading 2" className="font-semibold" onMouseDown={runBlockFormat("h2")} />
            <span className="mx-1 h-3 w-px bg-ivory-300" />
            <FormatBtn label="B" title="Bold (⌘B)" className="font-bold" onMouseDown={runFormat("bold")} />
            <FormatBtn label="I" title="Italic (⌘I)" className="italic" onMouseDown={runFormat("italic")} />
            <FormatBtn label="U" title="Underline (⌘U)" className="underline" onMouseDown={runFormat("underline")} />
            <span className="mx-1 h-3 w-px bg-ivory-300" />
            <FormatBtn label="• List" title="Bulleted list" onMouseDown={runFormat("insertUnorderedList")} />
            <FormatBtn label="1. List" title="Numbered list" onMouseDown={runFormat("insertOrderedList")} />
            <span className="mx-1 h-3 w-px bg-ivory-300" />
            <FormatBtn
              label="Image"
              title="Insert image"
              onMouseDown={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void insertImageBlob(file);
              }}
            />
          </div>
        )}
        <div
          ref={editorRef}
          data-note-body={notebook.id}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="Notebook body"
          onFocus={() => {
            skipHighlightSync.current = true;
            setFocused(true);
          }}
          onBlur={() => {
            skipHighlightSync.current = false;
            setFocused(false);
            commitHtml();
          }}
          onMouseUp={handleMouseUp}
          onClick={handleBodyClick}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
              e.preventDefault();
              document.execCommand("bold");
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
              e.preventDefault();
              document.execCommand("italic");
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "u") {
              e.preventDefault();
              document.execCommand("underline");
            }
          }}
          className="note-rich-body min-h-[4.5rem] w-full text-[16px] leading-[1.7] text-ink-800 outline-none empty:before:pointer-events-none empty:before:text-ink-300 empty:before:italic empty:before:content-[attr(data-placeholder)]"
          data-placeholder="Write your notes…"
        />
      </div>

      {notebook.linkedBranchIds.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAsksOpen((o) => !o)}
            className="text-[11px] text-ink-400 transition-colors hover:text-clay-600"
          >
            Linked chats ({notebook.linkedBranchIds.length})
            <span className="ml-1">{asksOpen ? "▾" : "▸"}</span>
          </button>
          {asksOpen && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {notebook.linkedBranchIds.map((branchId) => {
                const branch = branches[branchId];
                if (!branch) {
                  return (
                    <div
                      key={branchId}
                      className="flex items-center justify-between rounded-lg px-2 py-1 text-xs text-ink-400"
                    >
                      <span>Chat removed</span>
                      <button
                        type="button"
                        onClick={() => unlinkBranch(notebook.id, branchId)}
                        className="text-ink-500 hover:text-clay-600"
                      >
                        Remove
                      </button>
                    </div>
                  );
                }
                const last = branch.messages[branch.messages.length - 1];
                const crumbs = branchChain(branches, branchId)
                  .map((b) => (b.anchor ? quoteLabel(b.anchor.quotedText, 18) : "Chat"))
                  .join(" › ");
                return (
                  <div
                    key={branchId}
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-ivory-100"
                  >
                    <button
                      type="button"
                      onClick={() => focusLinkedBranch(branchId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-[10px] text-ink-400">{crumbs}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-700">
                        {last?.content || "(empty)"}
                      </p>
                    </button>
                    <a
                      href={chatUrl({ conversationId, branchId })}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 pt-0.5 text-[10px] font-medium text-ink-400 hover:text-clay-600"
                      title="Open in tab"
                    >
                      Tab
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
