import { type FormEvent, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trackWordSuggestion } from "../analytics";
import { AchievementCelebration } from "./AchievementCelebration";
import { ACHIEVEMENTS } from "../game/achievements";
import { usesFreeformRules } from "../game/dictionary";
import { modeIsChosen } from "../game/mode";
import {
  drawnHeaderCelebrationsArm,
  forcedHeaderCelebrationsVariant,
} from "../game/headerCelebrationsTest";
import { takesPlayerMessages } from "../game/playerMessages";
import { recordSuggestion } from "../game/suggestions";
import { useGameMode } from "../hooks/useGameMode";
import { navigate } from "../routes";

interface Props {
  open: boolean;
  /** The puzzle being played, which decides which eligibility rules are true. */
  date?: string;
  onClose: () => void;
}

export function WordRulesModal({ open, date, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode] = useGameMode();

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
        {/* What's allowed, and the box to argue with it -- nothing else. How
            words are scored lives in How to play and the common-forms
            explainer, and where the list comes from lives in the terms, so
            this panel only answers the question that opened it: why was that
            word turned away?

            One sentence per era, and from MODE_CHOICE_START one per mode:
            Freeform keeps the trial week's appetite for obsolete, archaic and
            dated words while Standard refuses them. Before that the trial week
            waived every register rule there is, and before the trial none of
            them were waived -- both of those are still reachable from the
            archive and still play that way. See waivedRejectionsFor in
            game/dictionary.ts. */}
        <p className="modal__copy">
          {date !== undefined && modeIsChosen(date)
            ? mode === "freeform"
              ? "In Freeform, proper nouns, abbreviations, and obsolete, archaic or dated words all count. Misspellings, offensive words, hyphenated words and words with punctuation are the only ones left out."
              : "Proper nouns and abbreviations count. Misspellings, offensive words, obsolete, archaic or dated words, hyphenated words and words with punctuation aren't eligible for play."
            : usesFreeformRules(date)
              ? "It's freeform week, so proper nouns, abbreviations, and obsolete, archaic or dated words all count. Misspellings, offensive words, hyphenated words and words with punctuation are the only ones left out."
              : "To keep play consistent, proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words, and words with punctuation aren't eligible for play."}{" "}
          {takesPlayerMessages() &&
            "Know a good word that's missing? Suggest it and everybody gets to play it."}
        </p>
        {takesPlayerMessages() && <WordSuggestionForm onLeave={onClose} />}
      </div>
    </div>
  );
}

/** What the review queue accepts as a word (see the suggested_words migration). */
const SUGGESTION_RE = /^[a-z]{2,30}$/;

const WORD_SCOUT = ACHIEVEMENTS.find((achievement) => achievement.id === "word-suggested");

/**
 * The box for suggesting a word, shared by Word rules (where a turned-away word
 * sends a player) and the "?" menu's Suggest a word.
 *
 * `onLeave` closes whatever sheet holds the form before "See suggestions"
 * takes the player to the queue.
 */
export function WordSuggestionForm({
  onLeave,
  inputRef,
  labelHidden = false,
}: {
  onLeave: () => void;
  inputRef?: Ref<HTMLInputElement>;
  /** For a sheet whose title already says "Suggest a word". */
  labelHidden?: boolean;
}) {
  const [suggestion, setSuggestion] = useState("");
  const [sent, setSent] = useState(false);
  const [firstSuggestion, setFirstSuggestion] = useState(false);
  // Word scout gets the same card a word's badge does, over whatever sheet
  // holds the box -- unless the header celebrations test hides those cards,
  // where the thank-you names it instead.
  const [celebrating, setCelebrating] = useState(false);
  const endCelebrating = useCallback(() => setCelebrating(false), []);

  function submitSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = suggestion.trim().toLowerCase();
    if (!word) return;
    trackWordSuggestion(word);
    // Kept on the device so the player can be thanked if it gets in (see
    // game/suggestions.ts). Only a word the queue would take: anything else
    // never comes back with a verdict.
    const first = SUGGESTION_RE.test(word) && recordSuggestion(word);
    const arm = forcedHeaderCelebrationsVariant() ?? drawnHeaderCelebrationsArm();
    setFirstSuggestion(first && arm === "hidden");
    setCelebrating(first && arm !== "hidden");
    setSuggestion("");
    setSent(true);
  }

  return (
    <form className="word-suggestion" onSubmit={submitSuggestion}>
      <label htmlFor="word-suggestion" className={labelHidden ? "sr-only" : undefined}>
        Suggest a word
      </label>
      <div className="word-suggestion__row">
        <input
          ref={inputRef}
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
          Thanks for the suggestion! We'll let you know if it gets in.{" "}
          {firstSuggestion && (
            <span className="word-suggestion__achievement">
              Achievement unlocked: 💡 Word scout.{" "}
            </span>
          )}
          <button
            type="button"
            className="word-suggestion__link"
            onClick={() => {
              onLeave();
              navigate("suggested-words");
            }}
          >
            See suggestions
          </button>
        </p>
      )}
      {celebrating &&
        WORD_SCOUT &&
        createPortal(
          <AchievementCelebration achievements={[WORD_SCOUT]} onDone={endCelebrating} />,
          document.body
        )}
    </form>
  );
}
