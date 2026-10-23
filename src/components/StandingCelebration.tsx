import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import {
  TOP_PERCENT_COPY,
  standingCopy,
  type StandingNotice,
} from "../game/topPercent";

/** As long as the perfect-month card stays up, for the same reasons. */
const CELEBRATION_MS = 7000;

/**
 * The moment a player climbs into the top 10%, 5% or 1% of the month's board,
 * or the first open of a month after finishing the last one in a band (see
 * game/topPercent.ts).
 *
 * The perfect-month card's shape, floated over the puzzle rather than taking it
 * over, with confetti for the tightest band only -- a top 10% lands most months
 * for somebody who plays every day, and the burst is worth more if it is rare.
 */
export function StandingCelebration({
  notice,
  onDone,
}: {
  notice: StandingNotice;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const { title, body } = standingCopy(notice);
  return (
    <>
      {notice.band === 1 && <ConfettiBurst grand />}
      <div className="perfect-month" role="status">
        <button
          type="button"
          className={`perfect-month__card standing standing--${notice.band}`}
          onClick={onDone}
          title="Dismiss"
        >
          <span className="perfect-month__trophy" aria-hidden="true">
            {TOP_PERCENT_COPY[notice.band].emoji}
          </span>
          <span className="perfect-month__title">{title}</span>
          <span className="perfect-month__body">{body}</span>
        </button>
      </div>
    </>
  );
}
