import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import type { DaysClimb } from "../game/daysClimb";
import { daysMilestone, daysMilestoneReached } from "../game/daysMilestones";

/** How long the card stays up if nobody closes it, as the streak climb's does. */
const CELEBRATION_MS = 7000;

/**
 * The moment the day's first word moves the player up the days-played board
 * (see game/daysClimb.ts).
 *
 * The streak climb's card, in blue and with a calendar: it lands a moment after
 * the word, floats over the puzzle, and goes by itself or on a tap of its ×.
 * It wears the player's days milestone (see game/daysMilestones.ts) in place of
 * the calendar once they have one, and on the day a milestone lands -- the
 * hundredth day, say -- leads with it.
 */
export function DaysClimbCelebration({
  climb,
  onDone,
}: {
  climb: DaysClimb;
  onDone: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const { from, to, days } = climb;
  const places = from - to;
  const milestone = daysMilestone(days);
  const reached = daysMilestoneReached(days);
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement improvement--days" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            {milestone?.emoji ?? "📅"}
          </span>
          <span className="improvement__title">
            {reached
              ? `${days} days played!`
              : to === 1
                ? "Most days played!"
                : "Up the days-played board!"}
          </span>
          <span className="improvement__body">
            {reached
              ? "A new milestone, and you've climbed "
              : days > 0
                ? `${days} ${days === 1 ? "day" : "days"} played, and you've climbed `
                : "You've climbed "}
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
