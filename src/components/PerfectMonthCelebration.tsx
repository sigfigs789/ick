import { ConfettiBurst } from "./ConfettiBurst";
import { perfectMonthName } from "../game/perfectMonth";

/**
 * The moment a player finishes a month without missing a day.
 *
 * Bigger than the Rare-word burst on purpose -- that one fires most days, and
 * this one at most twelve times a year -- so it brings its own gold confetti
 * and a card naming the month. The card floats over the puzzle rather than
 * taking it over: the player is mid-guess on the last day, and a modal they had
 * to close before their next word would be a celebration in the way. It stays
 * up until it is tapped away.
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
  const month = perfectMonthName(date);
  return (
    <>
      <ConfettiBurst grand />
      <div className="perfect-month" role="status">
        <button type="button" className="perfect-month__card" onClick={onDone} title="Dismiss">
          <span className="perfect-month__close" aria-hidden="true">
            ×
          </span>
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
        </button>
      </div>
    </>
  );
}
