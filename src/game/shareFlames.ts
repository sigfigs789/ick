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

const FLAME_SHARES_KEY = "ick:flame-shares";

/** The first puzzle each burning tier was shared from, by tier. */
export type FlameShares = Partial<Record<FlameTier, string>>;

/** The tiers this browser has shared burning, each with its first puzzle's date. */
export function flameSharesMade(): FlameShares {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FLAME_SHARES_KEY) ?? "{}");
    if (!stored || typeof stored !== "object") return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([tier, date]) => isFlameTier(tier as Rarity) && typeof date === "string"
      )
    ) as FlameShares;
  } catch {
    return {};
  }
}

/**
 * Note a share taken while the button burned in `tier`, for the badges each
 * colour of fire earns (see game/achievements.ts). Only the first share of a
 * tier is kept; true when this was it.
 */
export function recordFlameShare(date: string, tier: FlameTier): boolean {
  const made = flameSharesMade();
  if (made[tier]) return false;
  try {
    localStorage.setItem(FLAME_SHARES_KEY, JSON.stringify({ ...made, [tier]: date }));
    return true;
  } catch {
    // Unwritable storage only means the badge waits for a share that sticks.
    return false;
  }
}
