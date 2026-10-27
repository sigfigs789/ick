import { ConfettiBurst } from "./ConfettiBurst";
import { formatTotal } from "../game/dictionary";
import { improvementPercent, type Improvement } from "../game/improvement";

/**
 * The moment a finished puzzle shows the player's average climbing (see
 * game/improvement.ts).
 *
 * The perfect month's card, in green and with an arrow rather than a trophy:
 * it lands when the day is done, so it floats over a finished puzzle rather
 * than in the way of a guess, and stays until it is closed with its ×.
 */
export function ImprovementCelebration({
  improvement,
  onDone,
}: {
  improvement: Improvement;
  onDone: () => void;
}) {
  const { recent, earlier, days } = improvement;
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            📈
          </span>
          <span className="improvement__title">You're on the rise!</span>
          <span className="improvement__body">
            Your average over your last {days} puzzles is up{" "}
            <span className="improvement__gain">{improvementPercent(improvement)}%</span> —{" "}
            <span className="improvement__tally">
              {formatTotal(earlier)} → {formatTotal(recent)}
            </span>
            .
          </span>
        </div>
      </div>
    </>
  );
}
