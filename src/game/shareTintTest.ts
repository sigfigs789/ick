import { rarityForScore, rawTotalRarityScore } from "./dictionary";
import { isTester } from "./testers";
import type { AcceptedWord } from "./types";

/**
 * The share tint test: whether filling the Share buttons with the Extremely
 * Rare colour, while the player's words average Extremely Rare, gets more
 * results shared. Elusive and up burn instead (see shareFlames.ts), for
 * everyone, so this test covers only the tier below them.
 *
 * Split 20/80: `shown`, for 20% of players, sees the tinted buttons; `hidden`,
 * for the other 80%, the plain ones. A player is drawn the first time their
 * average is Extremely Rare with a Share button on the page -- the moment the
 * two arms start to differ -- and keeps the arm for good. The draw is reported
 * once, as `share_tint_assigned`, and /experimentsV2 reads the arms from that
 * day on (see the analytics_v2_experiment migration).
 */

export type ShareTintVariant = "shown" | "hidden";

/** The share of players who see the tinted buttons. */
export const SHARE_TINT_SHOW_SHARE = 0.2;

const ASSIGNMENT_KEY = "ick:share-tint-test";

function isVariant(value: unknown): value is ShareTintVariant {
  return value === "shown" || value === "hidden";
}

/**
 * Whether the average score of `words` is Extremely Rare -- not above it, where
 * the buttons burn, nor below. False for no words and for a puzzle whose
 * tiers a score alone cannot name (see `rarityForScore`).
 */
export function shareTinted(words: readonly Pick<AcceptedWord, "zipf">[], date: string): boolean {
  if (words.length === 0) return false;
  return rarityForScore(rawTotalRarityScore(words, date) / words.length, date) === "Extremely Rare";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser keeps the plain buttons and is left out.
 */
export function assignShareTintArm(
  random: () => number = Math.random
): { variant: ShareTintVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: ShareTintVariant = random() < SHARE_TINT_SHOW_SHARE ? "shown" : "hidden";
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
export function drawnShareTintArm(): ShareTintVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?share-tint=shown` (or `=hidden`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to shown. A forced arm is never stored or reported, so it cannot leak into
 * the split.
 */
export function forcedShareTintVariant(search: string = window.location.search): ShareTintVariant | null {
  const value = new URLSearchParams(search).get("share-tint");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
