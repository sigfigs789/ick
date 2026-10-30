import { isTester } from "./testers";

/**
 * The do-over test: whether a second retry, earned by playing 4 days in a
 * week (see doOver.ts), brings players back.
 *
 * Split 50/50: `shown` gets the do-over -- the pie beside the streak, the
 * extra retry, the come-back line the day before -- and `hidden` gets none of
 * it. A player is drawn the first time the pie would appear, on today's
 * puzzle once a day of the week is played, which is the moment the two arms
 * start to differ, and keeps the arm for good. The draw is reported once, as
 * `do_over_assigned` (with `returning`), and /experimentsV2 reads the arms
 * from that day on, new and returning players apart (see the
 * analytics_v2_experiment migration).
 */

export type DoOverVariant = "shown" | "hidden";

/** The share of players who get the do-over. */
export const DO_OVER_SHOW_SHARE = 0.5;

const ASSIGNMENT_KEY = "ick:do-over-test";

function isVariant(value: unknown): value is DoOverVariant {
  return value === "shown" || value === "hidden";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser gets no do-over and is left out.
 */
export function assignDoOverArm(
  random: () => number = Math.random
): { variant: DoOverVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: DoOverVariant = random() < DO_OVER_SHOW_SHARE ? "shown" : "hidden";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/** The arm already drawn, or null before the draw -- read without drawing. */
export function drawnDoOverArm(): DoOverVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?do-over=shown` (or `=hidden`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to shown. A forced arm is never stored or reported, so it cannot leak into
 * the split.
 */
export function forcedDoOverVariant(search: string = window.location.search): DoOverVariant | null {
  const value = new URLSearchParams(search).get("do-over");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
