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
 * Shown once to a player who has already played -- see `hasEverPlayed` -- and
 * reachable from the "i" in the header forever after. A first-timer never sees
 * it, deliberately: it announces the *absence* of a rule they have never met,
 * and "we stopped rescoring your word to its common form" means nothing to
 * somebody who has not yet watched it happen.
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
          A lot of you told me the scoring was getting in your way — you’d find a
          word, and WordInk would quietly rescore it as its “common form”. So
          I’m giving your way a shot.
        </p>
        <p className="modal__copy">
          All week, every word scores exactly as you played it. Find{" "}
          <strong>kindless</strong> and you’re scored for <strong>kindless</strong>
          , not for <em>kind</em>.
        </p>
        <p className="modal__copy">
          And nothing’s too close to anything else — <strong>play</strong>,{" "}
          <strong>plays</strong> and <strong>played</strong> are three answers
          now, each scored on its own. Old words, proper nouns and abbreviations
          are all in too. Play the words you want to play.
        </p>
        <div className="freeform__vote">
          <p className="freeform__ask" id="freeform-vote-label">
            What do you think?
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
                vote === "love" ? " freeform__vote-button--picked" : ""
              }`}
              aria-pressed={vote === "love"}
              onClick={() => castVote("love")}
            >
              Love it!
            </button>
            <button
              type="button"
              className={`freeform__vote-button${
                vote === "boo" ? " freeform__vote-button--picked" : ""
              }`}
              aria-pressed={vote === "boo"}
              onClick={() => castVote("boo")}
            >
              Boooo
            </button>
          </div>
          {/* role="status" so the acknowledgement is announced, not only seen --
              the buttons stay on screen either way, and a pressed state is not
              an answer to "did that count". */}
          {vote && (
            <p className="freeform__voted" role="status">
              {vote === "love"
                ? "Noted — glad it’s landing."
                : "Noted — sorry, and thank you for saying so."}
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
              placeholder="Anything else? (optional)"
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
        <p className="modal__signoff">
          It’s a trial for the week. If enough of you like it, it stays for good.
        </p>
      </div>
    </div>
  );
}
