import { isTester } from "./testers";

/**
 * The come-back test: whether the line under the streak strip that says what
 * tomorrow is worth (see comeBack.ts) brings players back.
 *
 * Split 50/50: `show` sees the line, `hide` sees nothing in its place. A
 * player is drawn the first time the line would appear -- today's puzzle, a
 * word banked -- which is the moment the two arms start to differ, and keeps
 * the arm for good. The /analyticsV2 scorecard is read per arm from that day
 * on (see the analytics_v2 come-back migration, which finds each player's arm
 * on the `come_back_assigned` event).
 */

export type ComeBackVariant = "show" | "hide";

/** The share of players who see the line. */
export const COME_BACK_SHOW_SHARE = 0.5;

const ASSIGNMENT_KEY = "ick:come-back-test";

function isVariant(value: unknown): value is ComeBackVariant {
  return value === "show" || value === "hide";
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
    const variant: ComeBackVariant = random() < COME_BACK_SHOW_SHARE ? "show" : "hide";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?come-back=show` (or `=hide`), for seeing either without
 * waiting on a draw; a hand-picked tester (see testers.ts) is forced to show.
 * A forced arm is never stored or reported, so it cannot leak into the split.
 */
export function forcedComeBackVariant(search: string = window.location.search): ComeBackVariant | null {
  const value = new URLSearchParams(search).get("come-back");
  if (isVariant(value)) return value;
  return isTester() ? "show" : null;
}
