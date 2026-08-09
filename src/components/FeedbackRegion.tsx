import type { Feedback } from "../hooks/useDailyPuzzle";

interface Props {
  feedback: Feedback | null;
}

/**
 * A single polite live region. Re-announcing an identical message (e.g. the
 * same rejection twice in a row) works because `feedback.key` changes every
 * time, forcing React to treat the text as new content.
 */
export function FeedbackRegion({ feedback }: Props) {
  // A trailing run of zero-width spaces, sized by `feedback.key`, makes
  // consecutive identical messages (e.g. rejecting the same word twice)
  // register as new text content so screen readers re-announce them.
  const filler = feedback ? "​".repeat(feedback.key % 20) : "";

  return (
    <p
      className={`feedback${feedback ? ` feedback--${feedback.kind}` : ""}`}
      role="status"
      aria-live="polite"
    >
      {feedback ? `${feedback.message}${filler}` : ""}
    </p>
  );
}
