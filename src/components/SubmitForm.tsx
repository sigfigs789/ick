import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";
import type { AcceptedWord, SubmissionResult } from "../game/types";
import type { GameMode } from "../game/mode";
import { FoldHint } from "./FoldHint";
import { useIdleHint } from "../hooks/useIdleHint";

/** One breath of the border pulse, matching input-checking-pulse in index.css. */
const PULSE_MS = 1200;

interface Props {
  drop: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** A live lookup is running and the player is waiting on it. */
  checking?: boolean;
  /**
   * The word data the verdict needs is still downloading. Typing stays open,
   * but the button shows a spinner and waits, so a word is never sent into a
   * pause the player cannot see.
   */
  loading?: boolean;
  /**
   * Answers with the verdict when it has one: a rejected word stays in the box
   * (see handleSubmit), so anything that can reject must say so.
   */
  onSubmit: (word: string) => void | SubmissionResult | Promise<SubmissionResult | void>;
  /**
   * The puzzle and mode being played, for the notice over the input (see
   * FoldHint).
   */
  date?: string;
  mode?: GameMode;
  /**
   * The words banked on this puzzle. Passing them (with `date`) is what puts
   * the box in the idle hint experiment -- see hooks/useIdleHint.ts.
   */
  acceptedWords?: readonly AcceptedWord[];
  /**
   * The button's word. The play screen (see App.tsx) says "Play": a guess is
   * a move in the game, not a form being sent.
   */
  submitLabel?: string;
}

export function SubmitForm({
  drop,
  disabled,
  feedback,
  checking = false,
  loading = false,
  onSubmit,
  date,
  mode,
  acceptedWords,
  submitLabel = "Submit",
}: Props) {
  const [value, setValue] = useState("");
  const idleHint = useIdleHint({ drop, date, acceptedWords, value, disabled });
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);
  // The pulse outlives `checking` by up to one breath. A lookup that answers
  // mid-pulse would otherwise drop the border wherever the lift had reached,
  // which reads as a glitch -- the very thing it exists to prevent -- so the
  // pulse always runs to the end of the breath it is in before it stops.
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (checking) {
      setPulsing(true);
      return;
    }
    if (!pulsing) return;
    const el = fieldRef.current;
    if (!el) {
      setPulsing(false);
      return;
    }
    // `animationiteration` marks the end of a breath while the pulse is
    // looping; `animationend` covers the reduced-motion case, where the global
    // prefers-reduced-motion rule pins it to a single near-instant run and no
    // iteration ever fires. Both reach this element by bubbling up from the
    // input the animation runs on. The timer is the backstop for when neither
    // arrives (a backgrounded tab pauses animations), so the border can never
    // stick lit.
    const stop = () => setPulsing(false);
    el.addEventListener("animationiteration", stop, { once: true });
    el.addEventListener("animationend", stop, { once: true });
    const timer = window.setTimeout(stop, PULSE_MS + 200);
    return () => {
      el.removeEventListener("animationiteration", stop);
      el.removeEventListener("animationend", stop);
      window.clearTimeout(timer);
    };
  }, [checking, pulsing]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const submitted = value;
    if (!submitted.trim() || disabled || loading) return;
    // Tapping the on-screen Submit button (as opposed to the keyboard's own
    // "go"/"done" key) shouldn't dismiss the mobile keyboard -- re-focus so
    // the player can keep typing their next guess without tapping back in.
    inputRef.current?.focus();
    const result = await onSubmit(submitted);
    // Undefined is a caller that does not answer with a verdict, which is
    // only ever an accepting one.
    idleHint.onSubmitted(submitted, !result || result.ok);
    // A rejected word stays in the box. A near miss is usually a letter away
    // from an accepted one, and retyping it from scratch is the player's
    // punishment for having been close.
    if (result && !result.ok) return;
    // A live lookup can answer long after the player moved on, so only clear
    // the box if what is in it is still the word that was submitted.
    setValue((current) => (current === submitted ? "" : current));
  }

  // Wordle-style shake on a rejected submission. Force a reflow before
  // re-adding the class so back-to-back rejections of the same word each
  // replay the animation instead of no-op'ing on an already-applied class.
  useEffect(() => {
    if (feedback?.kind !== "rejected" || !rowRef.current) return;
    const el = rowRef.current;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }, [feedback]);

  return (
    <form className="submit-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="submit-form__label" htmlFor="word-input">
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${drop.toUpperCase()}"`}
      </label>
      <div
        className={`submit-form__row${checking || pulsing ? " submit-form__row--checking" : ""}`}
        ref={rowRef}
      >
        <FoldHint value={value} date={date} mode={mode} />
        {/* Wraps the input alone, and catches the pulse's animation events as
            they bubble up from it. */}
        <span className="submit-form__field" ref={fieldRef}>
          <input
            id="word-input"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            placeholder={disabled ? "" : (idleHint.placeholder ?? "type a word…")}
            maxLength={30}
          />
        </span>
        <button
          type="submit"
          className={loading ? "submit-form__button--loading" : undefined}
          disabled={disabled || loading || !value.trim()}
          aria-busy={loading || undefined}
          aria-label={loading ? "Loading the word list" : undefined}
          // Without this, tapping Submit on mobile focuses the button first
          // (stealing focus from the input) and closes the keyboard before
          // the click/submit even fires.
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && <span className="submit-form__spinner" aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
