import { useCallback } from "react";
import { MarkToggle, ReviewPage } from "./ReviewPage";
import { formatWhen, useMarks, useReviewList } from "./reviewList";
import { fetchFeedback } from "../game/review";

/**
 * The feedback players have left, as a page at /feedback.
 *
 * Everything typed into the box in the how-to-play sheet, newest first -- the
 * page is reached from that box, so whoever opens it most often just wrote the
 * note at the top. (It was oldest first while this was a curator's backlog and
 * nothing linked to it; see the 2026-09-11 ordering migration.) The note is the
 * whole of what was stored: the event carries no player id, no name and
 * nothing about the person (see src/analytics.ts, trackFeedback), so this page
 * can only ever show what somebody wrote and when it arrived.
 *
 * Rendered as text and nothing else -- no links made of it, no markup read out
 * of it. It is free text a stranger typed, and the one job this page has is to
 * put it in front of somebody who will read it.
 *
 * Each note carries a mark -- accepted, rejected, or nothing yet -- kept in a
 * table of its own (`feedback_marks`) rather than on the event: the events table
 * is an append-only mirror of what the client sent, and this app should not be
 * editing its own log to remember what it has read.
 *
 * Not linked from anywhere in the app. The how-to-play sheet briefly offered
 * this page to whoever had just written a note, which would have made it a
 * public wall -- one player's note read by the next -- and that link was taken
 * back out. Nothing here identifies who wrote what (the event carries no player
 * id, no name and nothing about the person), but the words are still theirs.
 *
 * The triage controls are live here without a key, unlike the word queue's.
 * Nothing links to this page, a note's mark reaches no part of the game, and
 * the person who opens it is the person triaging it -- so it behaves the way it
 * did before any of this was gated. A deployment that sets REVIEW_TOKEN gets
 * the stricter version for free: the read needs the key, so there is no page to
 * click on without one. See api/review.ts.
 */
export function FeedbackPage() {
  const load = useCallback(() => fetchFeedback(), []);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const { markFor, cycle, failed } = useMarks("feedback", rows);

  return (
    <ReviewPage
      title="Submitted feedback"
      note="Notes players left in the how-to-play sheet — newest first."
      count={rows.length}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="No feedback yet."
      markFailed={failed}
    >
      <ul className="review__list">
        {rows.map((note) => (
          <li
            key={note.id}
            className={`review__item review__item--${markFor(note.id, note.mark) ?? "unmarked"}`}
          >
            <MarkToggle
              mark={markFor(note.id, note.mark)}
              // The date, because a note has no short name and the first words
              // of one are not a label -- they are the thing being marked.
              label={formatWhen(note.at)}
              onClick={() => cycle(note.id, note.mark)}
            />
            <div className="review__body">
              {/* The note first and the time under it: the text is what anybody
                  came here to read, and when it landed is context for it. */}
              <p className="review__note">{note.text}</p>
              <p className="review__meta">
                <span>{formatWhen(note.at)}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </ReviewPage>
  );
}
