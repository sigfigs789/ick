import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import { baseForm } from "./stem";
import type { AcceptedWord, Rarity, RarityInfo } from "./types";

/**
 * The curated dictionary decides whether a submission is allowed at all.
 * Kept as its own dataset (see scripts/generate-data.py) so it can be
 * hand-edited independently of frequency data.
 */
const WORDS: readonly string[] = dictionaryWords as string[];
const WORD_INDEX: ReadonlyMap<string, number> = new Map(WORDS.map((w, i) => [w, i]));

/**
 * Frequency data, precomputed offline from wordfreq's Zipf values --
 * gameplay never needs a live lookup. Index-aligned with dictionary.json
 * (same word order) rather than keyed by word, which keeps the payload
 * small (no word repeated as both a dictionary entry and a JSON object key).
 */
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
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const zipf = adjustedZipf(normalized, zipfTenths[i] / 10);
  return { rarity: rarityForZipf(zipf), zipf };
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
    const info = rarityFor(WORDS[i])!;
    if (!best || info.zipf < best.zipf) {
      best = { word: WORDS[i], ...info };
    }
  }
  return best;
}

/**
 * Frequency data can undercount familiar derived forms such as "alertly"
 * even when their base words are common. Cap those forms at the base word's
 * frequency so a transparent suffix cannot turn an everyday word into a
 * top-tier answer.
 */
function adjustedZipf(word: string, zipf: number): number {
  const base = scoringBaseForm(word);
  if (!base) return zipf;

  const baseIndex = WORD_INDEX.get(base);
  if (baseIndex === undefined) return zipf;
  return Math.max(zipf, zipfTenths[baseIndex] / 10);
}

function scoringBaseForm(word: string): string | undefined {
  const inflected = baseForm(word);
  if (inflected !== word && WORD_INDEX.has(inflected)) return inflected;

  for (const suffix of ["ness", "ly"]) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    const candidates = [stem, stem.endsWith("i") ? `${stem.slice(0, -1)}y` : ""];
    const base = candidates.find((candidate) => candidate && WORD_INDEX.has(candidate));
    if (base) return base;
  }
  return undefined;
}

function rarityForZipf(zipf: number): Rarity {
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  if (zipf >= 1.6) return "Extremely Rare";
  return "Mythic";
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

/** Sum the displayed rarity scores earned during one game session. */
export function totalRarityScore(words: readonly Pick<AcceptedWord, "zipf">[]): number {
  const total = words.reduce((sum, word) => sum + rarityScore(word.zipf), 0);
  return Math.round(total * 10) / 10;
}
