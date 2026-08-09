import type { HTMLAttributes, ReactNode } from "react";
import { SubChatCard } from "./SubChatCard";

/**
 * Unified sub-chat layout for docked cards and float windows.
 * Delegates to SubChatCard (Docs-style quote + reply + ⋮ menu).
 */
export function SubChatShell({
  branchId,
  side,
  variant,
  bodyHeight,
  dragHandleProps,
  autoFocusComposer = false,
  footer,
}: {
  branchId: string;
  side: "left" | "right";
  variant: "rail" | "float";
  /** Docked: fixed body scroll height. Float: omit and use flex-1. */
  bodyHeight?: number;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  autoFocusComposer?: boolean;
  /** Optional resize handles / overlays rendered after the shell column. */
  footer?: ReactNode;
}) {
  return (
    <SubChatCard
      branchId={branchId}
      side={side}
      variant={variant}
      bodyHeight={bodyHeight}
      dragHandleProps={dragHandleProps}
      autoFocusComposer={autoFocusComposer}
      footer={footer}
    />
  );
}
