import { useState, type FormEvent } from "react";

interface Props {
  fragment: string;
  disabled: boolean;
  onSubmit: (word: string) => void;
}

export function SubmitForm({ fragment, disabled, onSubmit }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value);
    setValue("");
  }

  return (
    <form className="submit-form" onSubmit={handleSubmit}>
      <label className="submit-form__label" htmlFor="word-input">
        {disabled
          ? "You've completed today's puzzle"
          : `Enter a word containing "${fragment.toUpperCase()}"`}
      </label>
      <div className="submit-form__row">
        <input
          id="word-input"
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
