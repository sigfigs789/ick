import { rarityForScore, rawTotalRarityScore } from "./dictionary";
import { isTester } from "./testers";
import type { AcceptedWord, Rarity } from "./types";

/**
 * The share flames test: whether setting the Share buttons alight, in the
 * colour of the tier the player's words average, gets more results shared.
 *
 * Split 50/50: `shown` sees the flames, `hidden` the plain buttons as before.
 * Only an average of Extremely Rare or better burns, and each tier up burns
 * larger (see `shareFlameTier`). A player is drawn the first time their
 * average reaches Extremely Rare with a Share button on the page -- the moment
 * the two arms start to differ -- and keeps the arm for good. The draw is
 * reported once, as `share_flames_assigned`, and /experimentsV2 reads the arms
 * from that day on (see the analytics_v2_experiment migration).
 */

export type ShareFlamesVariant = "shown" | "hidden";

/** The tiers that burn, weakest first; each later one burns larger. */
export const FLAME_TIERS = ["Extremely Rare", "Elusive", "Mythic", "Legend"] as const;

export type FlameTier = (typeof FLAME_TIERS)[number];

/** The share of players who see the flames. */
export const SHARE_FLAMES_SHOW_SHARE = 0.5;

const ASSIGNMENT_KEY = "ick:share-flames-test";

function isVariant(value: unknown): value is ShareFlamesVariant {
  return value === "shown" || value === "hidden";
}

function isFlameTier(rarity: Rarity | null): rarity is FlameTier {
  return (FLAME_TIERS as readonly (Rarity | null)[]).includes(rarity);
}

/**
 * The tier the average score of `words` earns, when it is one that burns; null
 * below Extremely Rare, for no words, and for a puzzle whose tiers a score
 * alone cannot name (see `rarityForScore`).
 */
export function shareFlameTier(words: readonly Pick<AcceptedWord, "zipf">[], date: string): FlameTier | null {
  if (words.length === 0) return null;
  const tier = rarityForScore(rawTotalRarityScore(words, date) / words.length, date);
  return isFlameTier(tier) ? tier : null;
}

/** How large `tier` burns: 1 for Extremely Rare up to 4 for Legend. */
export function flameLevel(tier: FlameTier): number {
  return FLAME_TIERS.indexOf(tier) + 1;
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser keeps the plain buttons and is left out.
 */
export function assignShareFlamesArm(
  random: () => number = Math.random
): { variant: ShareFlamesVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: ShareFlamesVariant = random() < SHARE_FLAMES_SHOW_SHARE ? "shown" : "hidden";
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
export function drawnShareFlamesArm(): ShareFlamesVariant | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?share-flames=shown` (or `=hidden`), for seeing either
 * without waiting on a draw; a hand-picked tester (see testers.ts) is forced
 * to shown. A forced arm is never stored or reported, so it cannot leak into
 * the split.
 */
export function forcedShareFlamesVariant(search: string = window.location.search): ShareFlamesVariant | null {
  const value = new URLSearchParams(search).get("share-flames");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
