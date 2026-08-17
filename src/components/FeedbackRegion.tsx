import { useEffect, useState } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  feedback: Feedback | null;
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
export function FeedbackRegion({ feedback, onWordRules }: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // A trailing run of zero-width spaces, sized by `feedback.key`, makes
  // consecutive identical messages (e.g. rejecting the same word twice)
  // register as new text content so screen readers re-announce them.
  const filler = feedback ? "​".repeat(feedback.key % 20) : "";

  return (
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
  );
}
