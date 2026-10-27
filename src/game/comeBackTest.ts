import { isTester } from "./testers";

/**
 * The come-back test: whether the line under the streak strip that says what
 * tomorrow is worth (see comeBack.ts) brings players back.
 *
 * Split 2:1: `shown`, for two in three players, sees the line; `hidden`, for
 * the other one in three, sees nothing in its place. The split was 50/50
 * until 2026-10-27; players drawn before then keep the arm they had. A
 * player is drawn the first time the line would appear -- today's puzzle, a
 * word banked -- which is the moment the two arms start to differ, and keeps
 * the arm for good. The draw is reported once, as `come_back_assigned`, and
 * /analyticsV2 reads the arms from that day on, on the scorecard's measures
 * (see the analytics_v2_experiment migration).
 */

export type ComeBackVariant = "shown" | "hidden";

/** The share of players who see the line. */
export const COME_BACK_SHOW_SHARE = 2 / 3;

const ASSIGNMENT_KEY = "ick:come-back-test";

function isVariant(value: unknown): value is ComeBackVariant {
  return value === "shown" || value === "hidden";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser sees the line and is left out.
 */
export function assignComeBackArm(
  random: () => number = Math.random
): { variant: ComeBackVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: ComeBackVariant = random() < COME_BACK_SHOW_SHARE ? "shown" : "hidden";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?come-back=hidden` (or `=shown`), for seeing either without
 * waiting on a draw; a hand-picked tester (see testers.ts) is forced to shown.
 * A forced arm is never stored or reported, so it cannot leak into the split.
 */
export function forcedComeBackVariant(search: string = window.location.search): ComeBackVariant | null {
  const value = new URLSearchParams(search).get("come-back");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
