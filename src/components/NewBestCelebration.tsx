import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";

/** How long the card stays up if nobody closes it, as the streak climb's does. */
const CELEBRATION_MS = 7000;

/**
 * The day the streak first goes past the player's longest before it (see
 * game/newBest.ts), on the submission that takes it there.
 *
 * The streak climb's card, flame and all: it floats over the puzzle and goes
 * by itself or on a tap of its ×.
 */
export function NewBestCelebration({
  days,
  best,
  onDone,
}: {
  days: number;
  best: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

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
          <span className="improvement__title">Your longest streak yet!</span>
          <span className="improvement__body">
            <span className="improvement__gain">{days} days</span> — past your best of{" "}
            <span className="improvement__tally">{best}</span>.
          </span>
        </div>
      </div>
    </>
  );
}
