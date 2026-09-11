import { useCallback } from "react";
import { ReviewPage } from "./ReviewPage";
import { formatWhen, useReviewList } from "./reviewList";
import { fetchFeedback } from "../game/review";

/**
 * The feedback players have left, as a page at /feedback.
 *
 * Everything typed into the box in the how-to-play sheet, in the order it was
 * written. Oldest first because these are read as a sequence: the same player
 * often writes twice, and the second note answers the first. The note
 * is the whole of what was stored: the event carries no player id, no name and
 * nothing about the person (see src/analytics.ts, trackFeedback), so this page
 * can only ever show what somebody wrote and when it arrived.
 *
 * Rendered as text and nothing else -- no links made of it, no markup read out
 * of it. It is free text a stranger typed, and the one job this page has is to
 * put it in front of somebody who will read it.
 *
 * Not linked from anywhere in the app. See src/routes.ts, and api/review.ts for
 * what gates the read -- a note is something a player wrote to us, and it should
 * not be sitting at a URL anybody can guess.
 */
export function FeedbackPage() {
  const load = useCallback(() => fetchFeedback(), []);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);

  return (
    <ReviewPage
      title="Submitted feedback"
      note="Notes players left in the how-to-play sheet — oldest first."
      count={rows.length}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="No feedback yet."
    >
      <ul className="review__list">
        {rows.map((note) => (
          <li key={note.id} className="review__item">
            {/* The note first and the time under it: the text is what anybody
                came here to read, and when it landed is context for it. */}
            <p className="review__note">{note.text}</p>
            <p className="review__meta">
              <span>{formatWhen(note.at)}</span>
            </p>
          </li>
        ))}
      </ul>
    </ReviewPage>
  );
}
