import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { formatTotal } from "../game/dictionary";
import type { PersonalBest } from "../game/personalBest";

/** How long the card stays up if nobody closes it, as the rising average's does. */
const CELEBRATION_MS = 7000;

/**
 * The finish that sets the player's best day or best week ever (see
 * game/personalBest.ts).
 *
 * The rising average's card, in sky blue: it lands when the day is done, so it
 * floats over a finished puzzle, and goes by itself or on a tap of its ×.
 */
export function PersonalBestCelebration({
  best,
  onDone,
}: {
  best: PersonalBest;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const week = best.kind === "week";
  return (
    <>
      <ConfettiBurst grand={week} rising={!week} />
      <div className="improvement improvement--record" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            {week ? "🏅" : "🌟"}
          </span>
          <span className="improvement__title">{week ? "Your best week ever!" : "Your best day ever!"}</span>
          <span className="improvement__body">
            <span className="improvement__gain">{formatTotal(best.score)}</span>{" "}
            {week ? "this week" : "today"}, past your old best of{" "}
            <span className="improvement__tally">{formatTotal(best.previous)}</span>.
          </span>
        </div>
      </div>
    </>
  );
}
