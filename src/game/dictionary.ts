import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import type { AcceptedWord, Rarity, RarityInfo } from "./types";

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
  M: "Elusive",
};

const rarityCodes: string = rarityData.codes;
const zipfTenths: number[] = rarityData.zipfTenths;

/**
 * The dictionary's actual Zipf range, computed once from the loaded data
 * rather than assumed -- rarityScore normalizes against these so the
 * rarest word in the dictionary always scores exactly 10, whatever the
 * underlying wordfreq values happen to be after a data regeneration.
 */
// Plain loop rather than Math.min(...zipfTenths) -- spreading ~60k elements
// as call arguments risks blowing the stack on some engines (e.g. Safari).
let minZipfTenths = Infinity;
let maxZipfTenths = -Infinity;
for (const z of zipfTenths) {
  if (z < minZipfTenths) minZipfTenths = z;
  if (z > maxZipfTenths) maxZipfTenths = z;
}
const MIN_ZIPF = minZipfTenths / 10;
const MAX_ZIPF = maxZipfTenths / 10;
const ZIPF_RANGE = MAX_ZIPF - MIN_ZIPF;

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

export function rarityFor(word: string): RarityInfo | undefined {
  const i = WORD_INDEX.get(word.toLowerCase());
  if (i === undefined) return undefined;
  return { rarity: CODE_TO_RARITY[rarityCodes[i]], zipf: zipfTenths[i] / 10 };
}

/**
 * The single rarest dictionary word containing `drop` as a substring -- the
 * best a player could theoretically submit for this drop. Lower Zipf means
 * rarer, so this is a min-scan over the whole dictionary, same containment
 * rule as submit.ts's containsDropInOrder.
 */
export function bestWordForDrop(drop: string): AcceptedWord | undefined {
  const needle = drop.toLowerCase();
  let best: AcceptedWord | undefined;
  for (let i = 0; i < WORDS.length; i++) {
    if (!WORDS[i].includes(needle)) continue;
    const zipf = zipfTenths[i] / 10;
    if (!best || zipf < best.zipf) {
      best = { word: WORDS[i], rarity: CODE_TO_RARITY[rarityCodes[i]], zipf };
    }
  }
  return best;
}

export const RARITY_ORDER: Rarity[] = [
  "Elusive",
  "Extremely Rare",
  "Rare",
  "Uncommon",
  "Common",
  "Very Common",
];

/**
 * A player-facing "rarity score" derived from Zipf frequency, with the
 * polarity flipped (wordfreq's Zipf scale runs *higher* for more common
 * words -- e.g. "the" ~7.7, "aardvark" ~2.4 -- which reads backwards for a
 * rarity score) and then normalized against the dictionary's actual Zipf
 * range so scores span the full 0-10 loot-tier scale: the single rarest
 * word in the dictionary scores exactly 10, the most common scores 0,
 * and everything else is scaled proportionally between. Internal ranking
 * (see rank.ts's bestWord) still compares raw Zipf directly; this is
 * purely a display transform.
 */
export function rarityScore(zipf: number): number {
  return Math.round(((MAX_ZIPF - zipf) / ZIPF_RANGE) * 100) / 10;
}
