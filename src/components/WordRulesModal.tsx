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
        aria-labelledby="word-rules-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="word-rules-heading">Word rules</h2>
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
          WordInk's curated word list is sourced from SCOWL and contains more than 180,000 words. To keep play consistent, proper nouns, abbreviations, archaic or obsolete words, hyphenated words, and words with punctuation aren't eligible for play.
        </p>
        <p className="modal__copy">
          I'm continuously expanding the list to include more delightful and interesting words. Have a good word in mind? Suggest it and improve the experience for everyone!
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
              placeholder="Enter word"
              autoComplete="off"
              maxLength={80}
            />
            <button type="submit" disabled={!suggestion.trim()}>
              Suggest word
            </button>
          </div>
          {sent && <p className="word-suggestion__thanks">Thanks for the suggestion!</p>}
        </form>
      </div>
    </div>
  );
}
