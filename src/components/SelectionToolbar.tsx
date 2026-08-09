import { useEffect, useState } from "react";
import * as repo from "../db/workspaceRepository";
import { fetchImageBlob } from "../lib/chatImageSelect";
import { isAllowedNoteImage, NOTE_IMAGE_MAX_PER_NOTE } from "../lib/noteHtml";
import { newId } from "../lib/id";
import { openSelectionAskInNewTab, openSelectionSubchat } from "../lib/selectionAsk";
import { useNotebookStore } from "../store/notebookStore";
import { useSelectionStore } from "../store/selectionStore";
import { useToastStore } from "../store/toastStore";
import type { Anchor, NoteAnchor } from "../types";

/**
 * Floating toolbar over a selection:
 * - Chat text (main page or a branch's dedicated tab only)
 *   → icon buttons: Ask more (docked side subchat) | Add to notebook
 * - Notebook body text → Ask more (opens a new chat tab)
 * - Image click → Add to Notebook
 */
export function SelectionToolbar() {
  const pending = useSelectionStore((s) => s.pending);
  const setPending = useSelectionStore((s) => s.setPending);
  const updateBody = useNotebookStore((s) => s.updateBody);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pending?.kind !== "image") {
      document.querySelectorAll("img.chat-image-selected").forEach((el) => {
        el.classList.remove("chat-image-selected");
      });
      return;
    }
    const src = pending.imageSrc;
    document.querySelectorAll("img[data-chat-image]").forEach((el) => {
      const img = el as HTMLImageElement;
      const match = (img.currentSrc || img.src) === src;
      img.classList.toggle("chat-image-selected", match);
    });
    return () => {
      document.querySelectorAll("img.chat-image-selected").forEach((el) => {
        el.classList.remove("chat-image-selected");
      });
    };
  }, [pending]);

  useEffect(() => {
    if (!pending || (pending.kind !== "image" && pending.kind !== "chat" && pending.kind !== "note")) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending(null);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-selection-toolbar]")) return;
      if (pending.kind === "image" && t.closest("img[data-chat-image]")) return;
      setPending(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [pending, setPending]);

  if (!pending) return null;
  if (pending.kind !== "image" && pending.kind !== "chat" && pending.kind !== "note") {
    return null;
  }

  const { rect } = pending;
  const isChat = pending.kind === "chat";
  const isNote = pending.kind === "note";
  const halfW = isNote ? 55 : isChat ? 100 : 70;
  const maxLeft = window.innerWidth - (isChat ? 210 : 160);
  const top = Math.max(rect.top - 42, 8);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - halfW, 8), maxLeft);

  const dismiss = () => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const addImageToNotebook = async () => {
    if (pending.kind !== "image" || !pending.imageSrc || busy) return;
    setBusy(true);
    try {
      const blob = await fetchImageBlob(pending.imageSrc);
      if (!blob || !isAllowedNoteImage(blob)) {
        window.alert("Could not add that image. Use a PNG, JPEG, WebP, or GIF under 4 MB.");
        return;
      }
      const notebook = await repo.ensureDefaultNotebook();
      const count = await repo.countNoteAttachments(notebook.id);
      if (count >= NOTE_IMAGE_MAX_PER_NOTE) {
        window.alert(`This notebook already has ${NOTE_IMAGE_MAX_PER_NOTE} images.`);
        return;
      }
      const attId = newId();
      await repo.addNoteAttachment({
        id: attId,
        notebookId: notebook.id,
        mimeType: blob.type,
        blob,
      });
      const imgHtml = `<img data-attachment-id="${attId}" alt="${(pending.imageAlt ?? "").replace(/"/g, "")}">`;
      await useNotebookStore.getState().hydrate();
      const existing = useNotebookStore.getState().notebooks[notebook.id];
      if (existing) updateBody(notebook.id, `${existing.body}${imgHtml}`);
      useToastStore.getState().show(`Added to ${notebook.title}`);
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  const chatAnchor = (): NoteAnchor | null => {
    if (pending.kind !== "chat" || !pending.anchor) return null;
    const a = pending.anchor as Anchor;
    const quoted = a.quotedText?.trim();
    if (!quoted) return null;
    return {
      sourceType: "chat",
      sourceMessageId: a.sourceMessageId,
      quotedText: quoted,
      quotedHtml: a.quotedHtml,
      startOffset: a.startOffset ?? 0,
      endOffset: a.endOffset ?? quoted.length,
    };
  };

  const askMoreChat = () => {
    if (pending.kind !== "chat") return;
    // Selections made inside a docked rail subchat open in a new app tab —
    // never a nested floating box.
    if (pending.origin === "rail") {
      openSelectionAskInNewTab(pending);
      return;
    }
    // Opens the docked sub-chat on the side rail.
    openSelectionSubchat(pending);
  };

  const askMoreNote = () => {
    if (pending.kind !== "note") return;
    openSelectionSubchat(pending);
  };

  const addSelectionToNotebook = async () => {
    const anchor = chatAnchor();
    if (!anchor || busy) return;
    setBusy(true);
    try {
      const id = await useNotebookStore.getState().appendCapture(anchor, "");
      if (id) dismiss();
    } finally {
      setBusy(false);
    }
  };

  if (isNote) {
    return (
      <div
        data-selection-toolbar
        style={{ position: "fixed", top, left, zIndex: 99999 }}
        className="selection-bubble"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button type="button" onClick={askMoreNote} className="selection-bubble-seg">
          Ask more
        </button>
      </div>
    );
  }

  if (isChat) {
    return (
      <div
        data-selection-toolbar
        style={{ position: "fixed", top, left, zIndex: 99999 }}
        className="selection-bubble"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          onClick={askMoreChat}
          title="Ask more about this"
          className="selection-bubble-seg"
        >
          Ask more
        </button>
        <span className="selection-bubble-divider" aria-hidden />
        <button
          type="button"
          disabled={busy}
          onClick={() => void addSelectionToNotebook()}
          title="Add to notebook"
          className="selection-bubble-seg"
        >
          {busy ? "Adding…" : "Add to notebook"}
        </button>
      </div>
    );
  }

  return (
    <div
      data-selection-toolbar
      style={{ position: "fixed", top, left, zIndex: 99999 }}
      className="selection-bubble"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => void addImageToNotebook()}
        className="selection-bubble-seg"
      >
        {busy ? "Adding…" : "Add to Notebook"}
      </button>
    </div>
  );
}
