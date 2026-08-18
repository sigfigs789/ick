import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  drop: string;
  disabled: boolean;
  feedback: Feedback | null;
  /** A live lookup is running and the player is waiting on it. */
  checking?: boolean;
  onSubmit: (word: string) => void;
}

export function SubmitForm({ drop, disabled, feedback, checking = false, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value);
    setValue("");
    // Tapping the on-screen Submit button (as opposed to the keyboard's own
    // "go"/"done" key) shouldn't dismiss the mobile keyboard -- re-focus so
    // the player can keep typing their next guess without tapping back in.
    inputRef.current?.focus();
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
    <form className="submit-form" onSubmit={handleSubmit}>
      <label className="submit-form__label" htmlFor="word-input">
        {disabled
          ? "You've completed this puzzle"
          : `Enter a word containing "${drop.toUpperCase()}"`}
      </label>
      <div
        className={`submit-form__row${checking ? " submit-form__row--checking" : ""}`}
        ref={rowRef}
      >
        {/* Wraps the input alone so the checking bar spans the field and stops
            short of the Submit button. */}
        <span className="submit-form__field">
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
        </span>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          // Without this, tapping Submit on mobile focuses the button first
          // (stealing focus from the input) and closes the keyboard before
          // the click/submit even fires.
          onMouseDown={(e) => e.preventDefault()}
        >
          Submit
        </button>
      </div>
    </form>
  );
}
