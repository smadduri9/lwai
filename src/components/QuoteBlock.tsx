import type { NoteAnchor } from "../types";

/** Locked quote block: rich HTML when available, else plain text. */
export function QuoteBlock({
  anchor,
  className = "",
}: {
  anchor: Pick<NoteAnchor, "quotedText" | "quotedHtml">;
  className?: string;
}) {
  const html = anchor.quotedHtml?.trim();
  if (html) {
    return (
      <blockquote
        className={`quote-chip quote-chip--rich max-w-full ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <blockquote className={`quote-chip max-w-full ${className}`}>
      “{anchor.quotedText}”
    </blockquote>
  );
}
