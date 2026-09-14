import { type FormEvent, useEffect, useRef, useState } from "react";
import { trackFreeformFeedback, trackFreeformVote } from "../analytics";

type Vote = "love" | "boo";

interface Props {
  open: boolean;
  /** The puzzle the player is looking at, recorded with the vote and the note. */
  date: string;
  onClose: () => void;
}

/**
 * The Freeform week notice: what changed, a verdict to tap, and a box to say
 * more.
 *
 * Shown once to every player, and reachable from the header's "Freeform" button
 * for the rest of the week. First-timers included: the rules it describes are
 * the rules they are about to play under, and a new player who is never told is
 * the one most likely to take the week's scoring for the game's own.
 *
 * The vote and the note are two separate submissions rather than one form. Most
 * people will tap a button and close the sheet, and requiring a note to register
 * that tap would collect opinions only from the people who write notes -- so the
 * vote is sent the moment it is pressed, and the box below it is extra.
 */
export function FreeformModal({ open, date, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [vote, setVote] = useState<Vote | null>(null);
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

  /**
   * Record a verdict. Re-tapping the other button changes your mind and sends
   * the new one: the tally reads the latest vote per player, and a player who
   * pressed the wrong button should be able to say so rather than being stuck
   * with it.
   */
  function castVote(next: Vote) {
    if (next === vote) return;
    setVote(next);
    trackFreeformVote(next, date);
  }

  function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = feedback.trim();
    if (!note) return;
    trackFreeformFeedback(note, date, vote);
    setFeedback("");
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="freeform-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="freeform-heading">Freeform week!</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="modal__copy">
          Play any word you want — it can be archaic, it can be silly, and it
          won’t be rescored to its “common form”.
        </p>
        <div className="freeform__vote">
          {/* The stakes before the buttons rather than after them. It used to
              sit in the sign-off under the feedback box, which is below the
              fold on a phone and after the moment it was meant to inform -- a
              player deciding whether to bother tapping needs to know the tap
              decides something. */}
          <p className="freeform__ask" id="freeform-vote-label">
            Let me know if you prefer this style and it can be made permanent!
          </p>
          {/* A group rather than two loose buttons, so a screen reader hears the
              question before the answers. `aria-pressed` because these are a
              toggled choice the player can change, not two one-way actions. */}
          <div
            className="freeform__vote-buttons"
            role="group"
            aria-labelledby="freeform-vote-label"
          >
            <button
              type="button"
              className={`freeform__vote-button${
                vote === "boo" ? " freeform__vote-button--picked" : ""
              }`}
              aria-pressed={vote === "boo"}
              onClick={() => castVote("boo")}
            >
              {/* The emoji is aria-hidden so the button is announced as its
                  words alone -- "Boooo", not "Boooo thumbs down sign". */}
              Boooo <span aria-hidden="true">👎</span>
            </button>
            <button
              type="button"
              className={`freeform__vote-button${
                vote === "love" ? " freeform__vote-button--picked" : ""
              }`}
              aria-pressed={vote === "love"}
              onClick={() => castVote("love")}
            >
              Love it! <span aria-hidden="true">❤️</span>
            </button>
          </div>
          {/* role="status" so the acknowledgement is announced, not only seen --
              the buttons stay on screen either way, and a pressed state is not
              an answer to "did that count". */}
          {vote && (
            <p className="freeform__voted" role="status">
              {vote === "love" ? "Noted — thank you! 🙂" : "Noted — thanks for saying so."}
            </p>
          )}
        </div>
        <form className="word-suggestion feedback-form" onSubmit={submitFeedback}>
          <div className="word-suggestion__row feedback-form__row">
            <textarea
              id="freeform-feedback"
              className="feedback-form__input"
              aria-label="Tell me more about the new scoring"
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                setSent(false);
              }}
              placeholder="I like this direction but…"
              rows={2}
            />
            <button type="submit" disabled={!feedback.trim()}>
              Send
            </button>
          </div>
          {sent && (
            <p className="word-suggestion__thanks" role="status">
              Thanks — I read every one of these.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
