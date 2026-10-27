import { ConfettiBurst } from "./ConfettiBurst";
import type { StreakClimb } from "../game/streakClimb";

/**
 * The moment a finished puzzle moves the player up the streak board (see
 * game/streakClimb.ts).
 *
 * The improving average's card, in the streak's orange and with its flame: it
 * lands when the day is done, floats over the finished puzzle, and stays
 * until it is closed with its ×.
 */
export function StreakClimbCelebration({
  climb,
  onDone,
}: {
  climb: StreakClimb;
  onDone: () => void;
}) {
  const { from, to } = climb;
  const places = from - to;
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement improvement--streak" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
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
        </div>
      </div>
    </>
  );
}
