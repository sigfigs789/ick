import { type FormEvent, useEffect, useRef, useState } from "react";
import { trackWordSuggestion } from "../analytics";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WordRulesModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [suggestion, setSuggestion] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function submitSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = suggestion.trim().toLowerCase();
    if (!word) return;
    trackWordSuggestion(word);
    setSuggestion("");
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Word rules"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header modal__header--close-only">
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close word rules"
          >
            ×
          </button>
        </div>
        <p className="modal__copy">
          WordInk’s curated word list is built from established English-language lexical resources and has over 180,000 words.
        </p>
        <p className="modal__copy">
          To keep play consistent, proper nouns, abbreviations, hyphenated words, and words with punctuation aren't eligible for WordInk.
        </p>
        <p className="modal__copy">
          WordInk is built and maintained by a solo developer. I'm continuously expanding the list to include more delightful and interesting words while keeping the game fair and consistent for everyone. Thank you for playing!
        </p>
        <form className="word-suggestion" onSubmit={submitSuggestion}>
          <label htmlFor="word-suggestion">Know a word we should consider?</label>
          <div className="word-suggestion__row">
            <input
              id="word-suggestion"
              value={suggestion}
              onChange={(event) => {
                setSuggestion(event.target.value);
                setSent(false);
              }}
              placeholder="Enter a word"
              autoComplete="off"
              maxLength={80}
            />
            <button type="submit" disabled={!suggestion.trim()}>
              Suggest a word
            </button>
          </div>
          {sent && <p className="word-suggestion__thanks">Thanks for the suggestion!</p>}
        </form>
      </div>
    </div>
  );
}
