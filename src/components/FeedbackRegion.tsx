import { useEffect, useState } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  feedback: Feedback | null;
  /**
   * A note about a live lookup: the in-progress verb while it runs, its past
   * tense once it answers. Rendered above the toast, so it sits directly under
   * the input with the verdict below it.
   */
  note?: string | null;
  onWordRules: () => void;
}

const VISIBLE_MS = 6000;

/**
 * A single polite live region, styled as a small toast that fades in and
 * back out. Re-announcing an identical message (e.g. the same rejection
 * twice in a row) works because `feedback.key` changes every time, forcing
 * React to treat the text as new content -- the fade is purely visual and
 * doesn't affect what's read.
 */
export function FeedbackRegion({ feedback, note, onWordRules }: Props) {
  const [shown, setShown] = useState(false);
  const [noteShown, setNoteShown] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // The note holds while the lookup is still running -- it has no verdict to
  // outlive yet. Once one lands it fades on the same window as the toast, keyed
  // off the same `feedback` change, so the two always clear together.
  useEffect(() => {
    if (!note) {
      setNoteShown(false);
      return;
    }
    setNoteShown(true);
    if (!feedback) return;
    const timer = window.setTimeout(() => setNoteShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [note, feedback]);

  // A note still in flight ends in an ellipsis; a settled one ("Found it.")
  // doesn't. Only the pending form gets the animated dots, so the split is just
  // that character: the stem stays a plain text node and carries the
  // announcement, and the dots are decoration the screen reader never sees.
  const pendingStem = note?.endsWith("…") ? note.slice(0, -1) : null;

  // A trailing run of zero-width spaces, sized by `feedback.key`, makes
  // consecutive identical messages (e.g. rejecting the same word twice)
  // register as new text content so screen readers re-announce them.
  const filler = feedback ? "​".repeat(feedback.key % 20) : "";

  return (
    <>
      {note && (
        // Deliberately not role="status": the toast below is the page's single
        // status region, and aria-live alone still announces this when it changes.
        <p className={`live-note${noteShown ? " live-note--shown" : ""}`} aria-live="polite">
          {pendingStem ?? note}
          {pendingStem !== null && (
            <span className="live-note__dots" aria-hidden="true">
              <span className="live-note__dot">.</span>
              <span className="live-note__dot">.</span>
              <span className="live-note__dot">.</span>
            </span>
          )}
        </p>
      )}
      <p
        className={`feedback${feedback ? ` feedback--${feedback.kind}` : ""}${shown ? " feedback--shown" : ""}`}
        role="status"
        aria-live="polite"
      >
        {feedback ? `${feedback.message}${filler}` : ""}
        {feedback?.kind === "rejected" && (
          <button
            type="button"
            className="feedback__more-info"
            onClick={onWordRules}
          >
            More info
          </button>
        )}
      </p>
    </>
  );
}
