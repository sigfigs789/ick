import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { formatTotal } from "../game/dictionary";
import { improvementPercent, type Improvement } from "../game/improvement";

/** How long the card stays up if nobody taps it, as the perfect month's does. */
const CELEBRATION_MS = 7000;

/**
 * The moment a finished puzzle shows the player's average climbing (see
 * game/improvement.ts).
 *
 * The perfect month's card, in green and with an arrow rather than a trophy:
 * it lands when the day is done, so it floats over a finished puzzle rather
 * than in the way of a guess, and goes by itself or on a tap.
 */
export function ImprovementCelebration({
  improvement,
  onDone,
}: {
  improvement: Improvement;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const { recent, earlier, days } = improvement;
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement" role="status">
        <button type="button" className="improvement__card" onClick={onDone} title="Dismiss">
          <span className="improvement__close" aria-hidden="true">
            ×
          </span>
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
        </button>
      </div>
    </>
  );
}
