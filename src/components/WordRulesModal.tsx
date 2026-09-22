import { type FormEvent, useEffect, useRef, useState } from "react";
import { trackWordSuggestion } from "../analytics";
import { usesFreeformRules } from "../game/dictionary";
import { modeIsChosen } from "../game/mode";
import { navigate } from "../routes";

interface Props {
  open: boolean;
  /** The puzzle being played, which decides which eligibility rules are true. */
  date?: string;
  onClose: () => void;
}

export function WordRulesModal({ open, date, onClose }: Props) {
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
        {/* The second sentence is the half that moves. Sourcing and licensing
            are true whatever the rules are; which kinds of word are eligible is
            not, and a rules panel that goes on saying a word is unplayable while
            the player is scoring it is worse than no rules panel.

            Three sentences, one per era, and the *mode* is not asked: from
            MODE_CHOICE_START both modes accept the same words and differ only in
            what they are worth. Before that the trial week waived every register
            rule there is, and before the trial none of them were waived -- both
            of those are still reachable from the archive and still play that
            way. See waivedRejectionsFor in game/dictionary.ts. */}
        <p className="modal__copy">
          WordInk's word list is sourced from SCOWL and <a href="https://en.wiktionary.org/" target="_blank" rel="noreferrer">Wiktionary</a> (used under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>) and contains more than 200,000 words.{" "}
          {date !== undefined && modeIsChosen(date)
            ? "Proper nouns and abbreviations count, whether or not the list already carried them. Misspellings, offensive words, obsolete, archaic or dated words, hyphenated words and words with punctuation aren't eligible for play — in either mode."
            : usesFreeformRules(date)
              ? "It's freeform week, so almost all of it is in play: proper nouns, abbreviations, and obsolete, archaic or dated words all count, whether or not the list already carried them. Misspellings, offensive words, hyphenated words and words with punctuation are the only ones left out."
              : "To keep play consistent, proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words, and words with punctuation aren't eligible for play."}
        </p>
        <p className="modal__copy">
          I'm continuously expanding the list to include more delightful and interesting words. Know a good one that's missing? Suggest it and everybody gets to play it.
        </p>
        <form className="word-suggestion" onSubmit={submitSuggestion}>
          <label htmlFor="word-suggestion">Suggest a word</label>
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
              Suggest word
            </button>
          </div>
          {/* role="status" so the confirmation is announced and not only seen. */}
          {sent && (
            <p className="word-suggestion__thanks" role="status">
              Thanks for the suggestion!{" "}
              <button
                type="button"
                className="word-suggestion__link"
                onClick={() => {
                  onClose();
                  navigate("suggested-words");
                }}
              >
                See suggestions
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
