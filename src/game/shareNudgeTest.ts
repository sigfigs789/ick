import { rarityForScore, rawTotalRarityScore } from "./dictionary";
import { isTester } from "./testers";
import type { AcceptedWord } from "./types";

/**
 * The share nudge test: whether a small wiggle on the Share beside the guess
 * count, once a great puzzle is finished, gets more of those results shared.
 *
 * Only a finished live puzzle whose words average Extremely Rare (see
 * `earnsShareNudge`) is ever nudged, and only such a finish draws the player,
 * so the test is made of exactly the players it could reach: a player who
 * never finishes in that band is never drawn, whatever else they do. An
 * average of Elusive or better sets the Share on fire instead (see
 * shareFlamesTest.ts), so the two never land on the same finish.
 *
 * Split 50/50: `shown` sees the Share wiggle, `hidden` sees it sit still, as
 * it always has. A player keeps the arm for good. The draw is reported once,
 * as `share_nudge_assigned`, and /experimentsV2 reads the arms from that day
 * on (see the analytics_v2_experiment migration).
 */

export type ShareNudgeVariant = "shown" | "hidden";

/** The share of drawn players who see the Share wiggle. */
export const SHARE_NUDGE_SHOW_SHARE = 0.5;

const ASSIGNMENT_KEY = "ick:share-nudge-test";

function isVariant(value: unknown): value is ShareNudgeVariant {
  return value === "shown" || value === "hidden";
}

/**
 * Whether a puzzle's words average Extremely Rare, each scored on the
 * puzzle's own date, and the average tiered the way a word's own rank is (see
 * dictionary.ts's `rarityForScore`), so 7.95 counts and 7.94 does not. Above
 * the band, from Elusive up, the flames take over (see shareFlamesTest.ts's
 * `shareFlameTier`, which reads the same average). Nothing to average is not
 * a great puzzle.
 */
export function earnsShareNudge(words: readonly Pick<AcceptedWord, "zipf">[], date: string): boolean {
  if (words.length === 0) return false;
  return rarityForScore(rawTotalRarityScore(words, date) / words.length, date) === "Extremely Rare";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser's Share sits still and it is left out.
 */
export function assignShareNudgeArm(
  random: () => number = Math.random
): { variant: ShareNudgeVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: ShareNudgeVariant = random() < SHARE_NUDGE_SHOW_SHARE ? "shown" : "hidden";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/** The arm already drawn, or null before the draw. */
export function drawnShareNudgeArm(): ShareNudgeVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?share-nudge=shown` (or `=hidden`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to shown. A forced arm is never stored or reported, so it cannot leak into
 * the split. It still only shows on a finish that earns it.
 */
export function forcedShareNudgeVariant(search: string = window.location.search): ShareNudgeVariant | null {
  const value = new URLSearchParams(search).get("share-nudge");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
