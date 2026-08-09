import { useChatStore } from "../store/chatStore";
import { useDemoStore } from "../store/demoStore";
import { runDemo } from "../lib/demoScript";

/** Artificial SVG mouse cursor shown while the demo drives the UI. */
function DemoCursor() {
  const cursor = useDemoStore((s) => s.cursor);
  if (!cursor.visible) return null;
  return (
    <div
      aria-hidden
      className="demo-cursor"
      style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${cursor.clicking ? 0.82 : 1})` }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path
          d="M5.5 3.2l12.8 7.9-5.5 1.2 3.1 6.3-2.6 1.3-3.1-6.4-4.1 3.9z"
          fill="#1c1a16"
          stroke="#fff"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      {cursor.clicking && <span className="demo-cursor-ripple" />}
    </div>
  );
}

/**
 * "Demo" button (next to the theme toggle) + the fake cursor overlay.
 * Runs the scripted walkthrough: type → send → simulated reply → highlight →
 * Ask more → subchat follow-up. Escape or any real click aborts it.
 * Enabled only on a fresh conversation so the script starts deterministic.
 */
export function DemoRunner() {
  const active = useDemoStore((s) => s.active);
  const isEmpty = useChatStore((s) => (s.branches[s.rootBranchId]?.messages.length ?? 0) === 0);

  return (
    <>
      <button
        type="button"
        onClick={() => void runDemo()}
        disabled={active || !isEmpty}
        title={
          active
            ? "Demo running… (Esc to stop)"
            : isEmpty
              ? "Play an automated demo of the app"
              : "Demo needs a fresh, empty chat"
        }
        className="rounded-full border border-ivory-300 bg-card px-3 py-1.5 text-xs font-medium text-ink-700 shadow-sm transition-colors hover:border-clay-500/50 hover:text-clay-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {active ? "Demo…" : "Demo"}
      </button>
      <DemoCursor />
    </>
  );
}
