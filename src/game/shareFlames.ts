import { rarityForScore, rawTotalRarityScore } from "./dictionary";
import type { AcceptedWord, Rarity } from "./types";

/**
 * The Share buttons on fire: both are set alight, in the colour of the tier
 * the player's words average, once that average reaches Elusive, and each
 * tier up burns larger (see `shareFlameTier`).
 */

/** The tiers that burn, weakest first; each later one burns larger. */
export const FLAME_TIERS = ["Elusive", "Mythic", "Legend"] as const;

export type FlameTier = (typeof FLAME_TIERS)[number];

function isFlameTier(rarity: Rarity | null): rarity is FlameTier {
  return (FLAME_TIERS as readonly (Rarity | null)[]).includes(rarity);
}

/**
 * The tier the average score of `words` earns, when it is one that burns; null
 * below Elusive, for no words, and for a puzzle whose tiers a score
 * alone cannot name (see `rarityForScore`).
 */
export function shareFlameTier(words: readonly Pick<AcceptedWord, "zipf">[], date: string): FlameTier | null {
  if (words.length === 0) return null;
  const tier = rarityForScore(rawTotalRarityScore(words, date) / words.length, date);
  return isFlameTier(tier) ? tier : null;
}

/** How large `tier` burns: 1 for Elusive up to 3 for Legend. */
export function flameLevel(tier: FlameTier): number {
  return FLAME_TIERS.indexOf(tier) + 1;
}

/**
 * The classes a Share button takes to burn in `tier`: its whole fill turns
 * to the tier's fire, and `share-flames--1` to `--3` size the flames along its
 * top (see components/ShareFlames.tsx). Empty for no tier.
 */
export function shareFlamesClass(tier: FlameTier | null): string {
  if (!tier) return "";
  const slug = tier.toLowerCase().replace(" ", "-");
  return ` share-flames-host share-flames--${flameLevel(tier)} share-flames--${slug}`;
}
