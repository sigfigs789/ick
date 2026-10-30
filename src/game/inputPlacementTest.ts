import { isTester } from "./testers";

/**
 * The input placement test: whether the guess input sits above the guess log,
 * straight under the drop as it always has, or below it, after the words
 * already played.
 *
 * Split 80/20: `below`, for 80% of players, moves the input (and the
 * feedback line under it) beneath the guess log; `above`, for the other 20%,
 * keeps it where it is. The split was 50/50 until 2026-10-26 and 20% below
 * until 2026-10-30; players drawn before then keep the arm they had, so only
 * players not yet drawn get the new split. A player is drawn the first time
 * the input appears -- an unfinished puzzle -- which is the moment the
 * two arms start to differ, and keeps the arm for good. The draw is reported
 * once, as `input_placement_assigned`, and /experimentsV2 reads the arms from
 * that day on (see the analytics_v2_experiment migration). That report knows
 * two arms by the names `shown` and `hidden`, so `below`, the arm under test,
 * is sent as `shown` and `above` as `hidden` (see trackInputPlacementAssigned).
 */

export type InputPlacementVariant = "above" | "below";

/** The share of players whose input sits below the guess log. */
export const INPUT_PLACEMENT_BELOW_SHARE = 0.8;

const ASSIGNMENT_KEY = "ick:input-placement-test";

function isVariant(value: unknown): value is InputPlacementVariant {
  return value === "above" || value === "below";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser keeps the input above and is left out.
 */
export function assignInputPlacementArm(
  random: () => number = Math.random
): { variant: InputPlacementVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: InputPlacementVariant = random() < INPUT_PLACEMENT_BELOW_SHARE ? "below" : "above";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/**
 * The arm already drawn, or null before the draw -- read without drawing, so a
 * player already in the test sees their arm on the first paint.
 */
export function drawnInputPlacementArm(): InputPlacementVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?input-placement=below` (or `=above`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to below. A forced arm is never stored or reported, so it cannot leak into
 * the split.
 */
export function forcedInputPlacementVariant(
  search: string = window.location.search
): InputPlacementVariant | null {
  const value = new URLSearchParams(search).get("input-placement");
  if (isVariant(value)) return value;
  return isTester() ? "below" : null;
}
