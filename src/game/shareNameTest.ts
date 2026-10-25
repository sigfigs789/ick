import { isTester } from "./testers";

/**
 * The share name test: whether a shared result should say who played it
 * ("Playing as StormyFox47") for a player who has never set the results
 * panel's "Show username" toggle (see shareName.ts).
 *
 * Split 50/50: `shown` keeps the name on by default, `hidden` starts with it
 * off. Only a player with no saved choice is drawn -- one who has set the
 * toggle either way keeps what they chose, in or out of the test. A player is
 * drawn the first time a share is built (the Share beside the guess log, or
 * the share panel), which is the moment the two arms start to differ, and
 * keeps the arm for good, even after setting the toggle. The draw is reported
 * once, as `share_name_assigned`, and /experimentsV2 reads the arms from that
 * day on, new and returning players apart (see the analytics_v2_experiment
 * migration).
 */

export type ShareNameVariant = "shown" | "hidden";

/** The share of players whose name is on by default. */
export const SHARE_NAME_SHOW_SHARE = 0.5;

const ASSIGNMENT_KEY = "ick:share-name-test";

/**
 * Stored in place of an arm for a player kept out of the test for good: one
 * who had already set the toggle when this version first loaded, before the
 * test could reach them (see `excludeShareNameIfChosen` in shareName.ts).
 */
const EXCLUDED = "excluded";

function isVariant(value: unknown): value is ShareNameVariant {
  return value === "shown" || value === "hidden";
}

/**
 * Keep the player out of the test for good, unless they already hold an arm,
 * which they keep. Never reported: an excluded player was never in the split.
 */
export function excludeFromShareNameTest(): void {
  try {
    if (localStorage.getItem(ASSIGNMENT_KEY) === null) localStorage.setItem(ASSIGNMENT_KEY, EXCLUDED);
  } catch {
    // Storage that cannot be written cannot keep a draw either (see below).
  }
}

/** Whether the player was kept out of the test for good. */
export function isExcludedFromShareNameTest(): boolean {
  try {
    return localStorage.getItem(ASSIGNMENT_KEY) === EXCLUDED;
  } catch {
    return false;
  }
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null for an excluded player, and
 * when storage cannot keep the draw: a player re-drawn on every open is not in
 * the test, so that browser keeps the old default and is left out.
 */
export function assignShareNameArm(
  random: () => number = Math.random
): { variant: ShareNameVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    if (stored === EXCLUDED) return null;
    const variant: ShareNameVariant = random() < SHARE_NAME_SHOW_SHARE ? "shown" : "hidden";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/** The arm already drawn, or null before the draw -- read without drawing. */
export function drawnShareNameArm(): ShareNameVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?share-name=hidden` (or `=shown`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to hidden, the new default. A forced arm is never stored or reported, so it
 * cannot leak into the split.
 */
export function forcedShareNameVariant(search: string = window.location.search): ShareNameVariant | null {
  const value = new URLSearchParams(search).get("share-name");
  if (isVariant(value)) return value;
  return isTester() ? "hidden" : null;
}
