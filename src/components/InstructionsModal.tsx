import { type FormEvent, useEffect, useRef, useState } from "react";
import { trackFeedbackSubmitted } from "../analytics";
import { modeIsChosen } from "../game/mode";
import { todayDateString } from "../game/date";
import { CommonFormModal } from "./CommonFormModal";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InstructionsModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);
  const [showFolds, setShowFolds] = useState(false);

  useEffect(() => {
    if (open && !showFolds) closeRef.current?.focus();
  }, [open, showFolds]);

  useEffect(() => {
    if (!open || showFolds) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, showFolds, onClose]);

  if (!open) return null;

  // In place of this sheet rather than on top of it: two overlays would both
  // hear Escape, and closing the explainer should land back here, feedback
  // draft and all, not dismiss everything.
  if (showFolds) {
    return (
      <CommonFormModal
        open
        date={todayDateString()}
        onClose={() => setShowFolds(false)}
      />
    );
  }

  function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = feedback.trim();
    if (!note) return;
    trackFeedbackSubmitted(note);
    setFeedback("");
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="instructions-heading">How to play WordInk</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close instructions"
          >
            ×
          </button>
        </div>
        <p className="modal__copy">
          WordInk gives everyone the same daily drop—say, “INK”. Find the rarest
          English word you can that contains it, like th<strong>INK</strong>, wr
          <strong>INK</strong>le, or <strong>INK</strong>ling.
        </p>
        {/* The two modes, once there are two. Short on purpose: this sheet is
            the first thing a new player sees, and the difference between them is
            one sentence each -- whether a word is priced as itself or as the
            common word it is a form of. Everything else about the two is the
            same game, so everything above this still applies to both.

            Only from MODE_CHOICE_START. Before it there is one set of rules and
            a section headed "Standard" would be naming a choice nobody has. */}
        {modeIsChosen(todayDateString()) && (
          <div className="modal__modes">
            <h3 className="modal__modes-heading">Two ways to play</h3>
            <p className="modal__copy">
              <strong>Standard</strong> — words score as their common form:
              “plays” counts as <em>play</em>.{" "}
              <button
                type="button"
                className="common-form__link"
                onClick={() => setShowFolds(true)}
                aria-label="More info on how common forms are scored"
              >
                More info
              </button>
            </p>
            <p className="modal__copy">
              <strong>Freeform</strong> — every word is scored on its own
              frequency, so “plays” is worth what “plays” is worth.
            </p>
          </div>
        )}
        <p className="modal__rarity-note">
          Rarity scores reflect how often a word appears across books, news,
          movies, websites, and social media—not how complex it is. Values are
          computed using Zipf’s law. The highest ranks are Mythic at 9.5+ and
          Legend at 9.9+.
        </p>
        <form
          className="word-suggestion feedback-form"
          onSubmit={submitFeedback}
        >
          <div className="word-suggestion__row feedback-form__row">
            <textarea
              id="game-feedback"
              className="feedback-form__input"
              aria-label="Share feedback or leave a suggestion"
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                setSent(false);
              }}
              placeholder="Share feedback"
              rows={2}
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
        <p className="modal__signoff">
          Made by one person, for fun. Thanks for playing. 🙂
        </p>
      </div>
    </div>
  );
}
