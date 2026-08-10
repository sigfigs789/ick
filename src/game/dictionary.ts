import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import type { Rarity, RarityInfo } from "./types";

/**
 * The curated dictionary decides whether a submission is allowed at all.
 * Kept as its own dataset (see scripts/generate-data.py) so it can be
 * hand-edited independently of frequency data.
 */
const WORDS: readonly string[] = dictionaryWords as string[];
const WORD_INDEX: ReadonlyMap<string, number> = new Map(WORDS.map((w, i) => [w, i]));

/**
 * Frequency-derived rarity, precomputed offline from wordfreq's Zipf
 * frequency values -- gameplay never needs a live lookup. Index-aligned
 * with dictionary.json (same word order) rather than keyed by word, which
 * keeps the payload small (no word repeated as both a dictionary entry and
 * a JSON object key).
 */
const CODE_TO_RARITY: Record<string, Rarity> = {
  V: "Very Common",
  C: "Common",
  U: "Uncommon",
  R: "Rare",
  X: "Extremely Rare",
  M: "Mythic",
};

const rarityCodes: string = rarityData.codes;
const zipfTenths: number[] = rarityData.zipfTenths;

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

export function rarityFor(word: string): RarityInfo | undefined {
  const i = WORD_INDEX.get(word.toLowerCase());
  if (i === undefined) return undefined;
  return { rarity: CODE_TO_RARITY[rarityCodes[i]], zipf: zipfTenths[i] / 10 };
}

export const RARITY_ORDER: Rarity[] = [
  "Mythic",
  "Extremely Rare",
  "Rare",
  "Uncommon",
  "Common",
  "Very Common",
];

/**
 * A player-facing "rarity score" derived from Zipf frequency, but with the
 * polarity flipped: wordfreq's Zipf scale runs *higher* for more common
 * words (e.g. "the" ~7.7, "aardvark" ~2.4), which reads backwards for a
 * rarity score -- here, bigger number = rarer, matching the loot-tier
 * intuition ("higher rarity" should feel like "higher number"). Internal
 * ranking (see rank.ts's bestWord) still compares raw Zipf directly; this
 * is purely a display transform.
 */
export function rarityScore(zipf: number): number {
  return Math.round((10 - zipf) * 10) / 10;
}
