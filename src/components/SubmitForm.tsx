import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  fragment: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** Set by clicking a word in the guess log; consumed once, then cleared by the parent. */
  prefill: { word: string; token: number } | null;
  onSubmit: (word: string) => void;
}

export function SubmitForm({ fragment, disabled, feedback, prefill, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value);
    setValue("");
  }

  // A log entry was clicked: load its word into the box and focus it so
  // the player can tweak and resubmit it directly, per "click the text you
  // want typed in."
  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.word);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [prefill]);

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
    <form className="submit-form" onSubmit={handleSubmit}>
      <label className="submit-form__label" htmlFor="word-input">
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${fragment.toUpperCase()}"`}
      </label>
      <div className="submit-form__row" ref={rowRef}>
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
          placeholder={disabled ? "" : "type a word…"}
          maxLength={30}
        />
        <button type="submit" disabled={disabled || !value.trim()}>
          Submit
        </button>
      </div>
    </form>
  );
}
