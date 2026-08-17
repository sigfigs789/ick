import { useEffect, useState } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  feedback: Feedback | null;
  /**
   * A note about work still in progress -- currently only the live dictionary
   * lookup's "Looking deeper". It sits *below* the verdict, so when the verdict
   * arrives it appears above and pushes the note down rather than replacing it.
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

  // The note fades on its own window, so it stays visible while the verdict
  // lands above it and then both clear together.
  useEffect(() => {
    if (!note) {
      setNoteShown(false);
      return;
    }
    setNoteShown(true);
    const timer = window.setTimeout(() => setNoteShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  // A trailing run of zero-width spaces, sized by `feedback.key`, makes
  // consecutive identical messages (e.g. rejecting the same word twice)
  // register as new text content so screen readers re-announce them.
  const filler = feedback ? "​".repeat(feedback.key % 20) : "";

  return (
    <div className="feedback-stack">
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
      {note && (
        // Deliberately not role="status": the verdict above is the page's single
        // status region, and aria-live alone still announces this when it appears.
        <p className={`feedback-note${noteShown ? " feedback-note--shown" : ""}`} aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}
