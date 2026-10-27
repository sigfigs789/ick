import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { perfectMonthName } from "../game/perfectMonth";

/**
 * How long the card stays up if nobody closes it. Long enough to read twice and
 * screenshot; the confetti under it is long gone by then.
 */
const CELEBRATION_MS = 7000;

/**
 * The moment a player finishes a month without missing a day.
 *
 * Bigger than the Rare-word burst on purpose -- that one fires most days, and
 * this one at most twelve times a year -- so it brings its own gold confetti
 * and a card naming the month. The card floats over the puzzle rather than
 * taking it over: the player is mid-guess on the last day, and a modal they had
 * to close before their next word would be a celebration in the way.
 */
export function PerfectMonthCelebration({
  date,
  days,
  onDone,
}: {
  date: string;
  days: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const month = perfectMonthName(date);
  return (
    <>
      <ConfettiBurst grand />
      <div className="perfect-month" role="status">
        <div className="perfect-month__card">
          <button type="button" className="perfect-month__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="perfect-month__trophy" aria-hidden="true">
            🏆
          </span>
          <span className="perfect-month__title">Perfect {month}!</span>
          <span className="perfect-month__body">
            You played every puzzle this month —{" "}
            <span className="perfect-month__tally">
              {days} for {days}
            </span>
            .
          </span>
        </div>
      </div>
    </>
  );
}
