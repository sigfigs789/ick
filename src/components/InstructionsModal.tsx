import { type FormEvent, useEffect, useRef, useState } from "react";
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
        <p className="modal__rarity-note">
          Rarity scores reflect how often a word appears across books, news, movies, websites, and
          social media—not how complex it is. Values are computed using Zipf’s law. The highest ranks
          are Mythic at 9.5+ and Legend at 9.9+.
        </p>
        <form className="word-suggestion feedback-form" onSubmit={submitFeedback}>
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
              placeholder="Share feedback, leave a suggestion, or help me grow the game"
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
