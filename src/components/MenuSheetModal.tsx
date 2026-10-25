import { type FormEvent, type Ref, useEffect, useRef, useState } from "react";
import { trackFeedbackSubmitted } from "../analytics";
import { WordSuggestionForm } from "./WordRulesModal";

/** The sheets the header's "?" menu opens besides How to play. */
export type MenuSheet = "feedback" | "suggest-word";

const TITLES: Record<MenuSheet, string> = {
  feedback: "Feedback",
  "suggest-word": "Suggest a word",
};

/**
 * A small sheet for one thing a player sends us: a note, or a word the game is
 * missing. Each used to sit at the foot of another sheet (How to play, Word
 * rules); the "?" menu gives them a door of their own, so this holds the box
 * and nothing else. Opens with the box focused, since typing is the only thing
 * to do here.
 */
export function MenuSheetModal({
  sheet,
  onClose,
}: {
  sheet: MenuSheet | null;
  onClose: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    if (sheet) fieldRef.current?.focus();
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheet, onClose]);

  if (!sheet) return null;

  return (
    // Not a decision about the game, like How to play (see watchFirstInteraction).
    <div className="modal-overlay" onClick={onClose} data-not-interaction="">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-sheet-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="menu-sheet-heading">{TITLES[sheet]}</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={`Close ${TITLES[sheet].toLowerCase()}`}
          >
            ×
          </button>
        </div>
        {sheet === "feedback" ? (
          <FeedbackForm fieldRef={fieldRef} />
        ) : (
          <>
            <p className="modal__copy">
              Know a good word that's missing? Suggest it and everybody gets to play it.
            </p>
            <WordSuggestionForm onLeave={onClose} inputRef={fieldRef} labelHidden />
          </>
        )}
      </div>
    </div>
  );
}

function FeedbackForm({ fieldRef }: { fieldRef: Ref<HTMLTextAreaElement> }) {
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);

  function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = feedback.trim();
    if (!note) return;
    trackFeedbackSubmitted(note);
    setFeedback("");
    setSent(true);
  }

  return (
    <form className="word-suggestion feedback-form" onSubmit={submitFeedback}>
      <div className="word-suggestion__row feedback-form__row">
        <textarea
          ref={fieldRef}
          id="game-feedback"
          className="feedback-form__input"
          aria-label="Share feedback or leave a suggestion"
          value={feedback}
          onChange={(event) => {
            setFeedback(event.target.value);
            setSent(false);
          }}
          placeholder="Share feedback"
          rows={3}
        />
        <button type="submit" disabled={!feedback.trim()}>
          Send
        </button>
      </div>
      {/* role="status" so the confirmation is announced and not only seen:
          the box empties either way, and an empty box is not an answer.

          No link to /feedback from here, deliberately. The word queue is
          offered to whoever suggests a word, because a queue of words is
          everybody's; a note is something one player wrote to us, and
          pointing the next player at the pile of them is a different thing
          to publish. See src/routes.ts. */}
      {sent && (
        <p className="word-suggestion__thanks" role="status">
          Thanks for the feedback!
        </p>
      )}
    </form>
  );
}
