import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";
import { MessageBubble } from "./MessageBubble";

/** Scrollable message list for any branch (root page or sub-chat window). */
export function ChatThread({
  branchId,
  className = "",
  style,
}: {
  branchId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const branch = useChatStore((s) => s.branches[branchId]);
  const status = useChatStore((s) => s.streamingBranches[branchId]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = branch?.messages ?? [];

  // The view never moves on its own (no pinning during streaming or when
  // images load). The one exception: your own newly sent message scrolls
  // into view, since that's a direct user action.
  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);
  useEffect(() => {
    if (userCount > prevUserCount.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevUserCount.current = userCount;
  }, [userCount]);

  if (!branch) return null;

  return (
    <div ref={scrollRef} style={style} className={`overflow-y-auto ${className}`}>
      <div className="flex flex-col gap-4 p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-400">
            Type a question below. The selected text is used as context for the model —
            it won’t appear here.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            status={i === messages.length - 1 ? status : undefined}
          />
        ))}
      </div>
    </div>
  );
}
