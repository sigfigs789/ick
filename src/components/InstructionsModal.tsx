import { type FormEvent, useEffect, useRef, useState } from "react";
import { maxGuessesFor } from "../game/constants";
import { trackFeedbackSubmitted } from "../analytics";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InstructionsModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
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
        <p className="modal__copy">WordInk gives everyone the same daily drop—say, “INK”. Find the rarest English word you can that contains it, like th<strong>INK</strong>, wr<strong>INK</strong>le, or <strong>INK</strong>ling.</p>
        {/* The guess limit is the rule a first-time player is missing when they
            close this modal: it is the whole shape of a turn, and the only place
            it was stated was the counter above the log ("0 of 4 used"), which
            reads as a tally rather than a rule. Read from maxGuessesFor so it
            cannot drift from the limit actually being enforced.

            Three sentences because they answer three different questions, and
            running them together buried the middle one. The limit is the rule;
            what a rejected guess costs is the thing a player is most wrong
            about before they are told (they hoard, and the limit is not what
            they think it is); and stopping early is a choice they have to know
            exists, because the button offering it only appears once they have
            banked a word.

            The last sentence replaced "lock in when you're done", which named a
            button that no longer exists. What it says instead is the reason to
            spend the last guess rather than walk away on three: the answer is
            what the fourth one buys. */}
        <p className="modal__copy">
          You get {maxGuessesFor()} guesses a day. A word the game turns down costs you nothing, and
          every word it accepts adds to your score — so keep digging. Use all {maxGuessesFor()} and
          the day's rarest possible word is revealed.
        </p>
        <p className="modal__rarity-note">
          Rarity scores reflect how often a word appears across books, news, movies, websites, and
          social media—not how complex it is. The rarer the word, the higher it scores, up to 10.0.
          The top ranks are Mythic at 9.5+ and Legend at 9.9+.
        </p>
        <form className="word-suggestion feedback-form" onSubmit={submitFeedback}>
          <div className="word-suggestion__row feedback-form__row">
            <textarea
              id="game-feedback"
              className="feedback-form__input"
              aria-label="Share feedback or suggest an idea"
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                setSent(false);
              }}
              placeholder="Tell me what you think, or what would make this better"
              rows={2}
              maxLength={300}
            />
            <button type="submit" disabled={!feedback.trim()}>
              Send
            </button>
          </div>
          {sent && <p className="word-suggestion__thanks">Thanks for the feedback!</p>}
        </form>
        <p className="modal__signoff">Made by one person, for fun. Thanks for playing. 🙂</p>
      </div>
    </div>
  );
}
