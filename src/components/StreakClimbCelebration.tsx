import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import type { StreakClimb } from "../game/streakClimb";

/** How long the card stays up if nobody taps it, as the improving average's does. */
const CELEBRATION_MS = 7000;

/**
 * The moment a finished puzzle moves the player up the streak board (see
 * game/streakClimb.ts).
 *
 * The improving average's card, in the streak's orange and with its flame: it
 * lands when the day is done, floats over the finished puzzle, and goes by
 * itself or on a tap.
 */
export function StreakClimbCelebration({
  climb,
  onDone,
}: {
  climb: StreakClimb;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const { from, to } = climb;
  const places = from - to;
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement improvement--streak" role="status">
        <button type="button" className="improvement__card" onClick={onDone} title="Dismiss">
          <span className="improvement__close" aria-hidden="true">
            ×
          </span>
          <span className="improvement__icon" aria-hidden="true">
            🔥
          </span>
          <span className="improvement__title">
            {to === 1 ? "Top of the streak board!" : "Up the streak board!"}
          </span>
          <span className="improvement__body">
            You've climbed{" "}
            <span className="improvement__gain">
              {places} {places === 1 ? "place" : "places"}
            </span>{" "}
            —{" "}
            <span className="improvement__tally">
              #{from} → #{to}
            </span>
            .
          </span>
        </button>
      </div>
    </>
  );
}
