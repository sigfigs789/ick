import { isTester } from "./testers";

/**
 * The play tab test: whether the header's row of page icons starts with a
 * Play icon, the way back to the puzzle, or leaves the puzzle to the wordmark
 * as it always has.
 *
 * Split 80/20: `hidden`, for 80% of players, keeps the bar as it was;
 * `shown`, for the other 20%, puts the Play icon first. A player is drawn the
 * first time the header is drawn -- every page has one, so that is the first
 * load -- and keeps the arm for good. The draw is reported once, as
 * `play_tab_assigned`, and /experimentsV2 reads the arms from that day on (see
 * the analytics_v2_experiment migration).
 */

export type PlayTabVariant = "shown" | "hidden";

/** The share of players who see the Play icon in the header. */
export const PLAY_TAB_SHOW_SHARE = 0.2;

const ASSIGNMENT_KEY = "ick:play-tab-test";

function isVariant(value: unknown): value is PlayTabVariant {
  return value === "shown" || value === "hidden";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser keeps the bar without the icon and is left out.
 */
export function assignPlayTabArm(
  random: () => number = Math.random
): { variant: PlayTabVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: PlayTabVariant = random() < PLAY_TAB_SHOW_SHARE ? "shown" : "hidden";
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
export function drawnPlayTabArm(): PlayTabVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?play-tab=shown` (or `=hidden`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to hidden. A forced arm is never stored or reported, so it cannot leak into
 * the split.
 */
export function forcedPlayTabVariant(search: string = window.location.search): PlayTabVariant | null {
  const value = new URLSearchParams(search).get("play-tab");
  if (isVariant(value)) return value;
  return isTester() ? "hidden" : null;
}
