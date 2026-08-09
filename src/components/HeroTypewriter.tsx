import { useEffect, useMemo, useState } from "react";

/** First phrase typed on a fresh chat. */
const INITIAL_PHRASE = "Stay curious...";

/** Idle-loop suggestions, cycled with the same typewriter effect. */
const IDLE_QUESTIONS = [
  "Why is the sky dark at night?",
  "How do birds know where to migrate?",
  "What makes a song get stuck in your head?",
  "Why do we dream?",
  "How does bread rise?",
  "Why does time feel faster as we age?",
];

/** No-input window before "Stay curious" starts cycling to questions. */
const IDLE_MS = 5000;
/** How long each suggested question stays on screen before backspacing. */
const QUESTION_HOLD_MS = 4200;

const TYPE_MIN_MS = 45;
const TYPE_JITTER_MS = 50;
const DELETE_MIN_MS = 24;
const DELETE_JITTER_MS = 16;

/**
 * Landing-page hero: types "Stay curious" with a human-ish typewriter effect,
 * shows a prominent block caret on its own line, and after 5s of no user
 * input backspaces the phrase and cycles thought-provoking questions.
 *
 * The wrapper is an opaque shield (solid background) so the constellation
 * animation never shows through behind the text or caret.
 */
export function HeroTypewriter({ paused = false }: { paused?: boolean }) {
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const [text, setText] = useState(reducedMotion ? INITIAL_PHRASE : "");

  useEffect(() => {
    if (reducedMotion) return;
    if (paused) {
      // User is typing — freeze on the full phrase for when they clear out.
      setText(INITIAL_PHRASE);
      return;
    }

    let cancelled = false;
    let timeout = 0;
    /** -1 = INITIAL_PHRASE, >= 0 indexes IDLE_QUESTIONS (mod length). */
    let phraseIdx = -1;
    /** Non-zero while waiting out the 5s idle window. */
    let idleDeadline = 0;

    const phrase = () =>
      phraseIdx < 0 ? INITIAL_PHRASE : IDLE_QUESTIONS[phraseIdx % IDLE_QUESTIONS.length];
    const schedule = (fn: () => void, ms: number) => {
      timeout = window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const typeAt = (i: number) => {
      setText(phrase().slice(0, i));
      if (i < phrase().length) {
        schedule(() => typeAt(i + 1), TYPE_MIN_MS + Math.random() * TYPE_JITTER_MS);
      } else if (phraseIdx < 0) {
        armIdle();
      } else {
        schedule(startDelete, QUESTION_HOLD_MS);
      }
    };

    const startDelete = () => {
      idleDeadline = 0;
      deleteAt(phrase().length - 1);
    };

    const deleteAt = (i: number) => {
      setText(phrase().slice(0, i));
      if (i > 0) {
        schedule(() => deleteAt(i - 1), DELETE_MIN_MS + Math.random() * DELETE_JITTER_MS);
      } else {
        phraseIdx += 1;
        schedule(() => typeAt(1), 350);
      }
    };

    /** Wait out IDLE_MS with no keyboard/pointer activity, then cycle. */
    const armIdle = () => {
      idleDeadline = performance.now() + IDLE_MS;
      const check = () => {
        const left = idleDeadline - performance.now();
        if (left <= 0) startDelete();
        else schedule(check, Math.max(100, left));
      };
      schedule(check, IDLE_MS);
    };

    const onActivity = () => {
      if (idleDeadline) idleDeadline = performance.now() + IDLE_MS;
    };
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("pointerdown", onActivity, true);

    setText("");
    schedule(() => typeAt(1), 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      window.removeEventListener("keydown", onActivity, true);
      window.removeEventListener("pointerdown", onActivity, true);
    };
  }, [reducedMotion, paused]);

  // No box, no custom caret: just the heading. The native browser caret in
  // the hero input below is the single, prominent cursor.
  return (
    <h1 className="stay-curious-heading mb-8 text-center font-serif text-ink-800">
        {text.length > 0 ? text : " "}
    </h1>
  );
}
