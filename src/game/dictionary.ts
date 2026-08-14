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
const UNKNOWN_ZIPF = 1.4;
const MIN_MEASURED_ZIPF = 1;

/** The dictionary's upper Zipf bound, computed once from the loaded data. */
// Plain loop rather than Math.min(...zipfTenths) -- spreading ~60k elements
// as call arguments risks blowing the stack on some engines (e.g. Safari).
let maxZipfTenths = -Infinity;
for (const z of zipfTenths) {
  if (z > maxZipfTenths) maxZipfTenths = z;
}
const MIN_ZIPF = MIN_MEASURED_ZIPF;
const MAX_ZIPF = maxZipfTenths / 10;
const ZIPF_RANGE = MAX_ZIPF - MIN_ZIPF;

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

/**
 * A single "did you mean...?" correction for a rejected word, or undefined.
 *
 * Deliberately conservative so it stays a typo-rescuer, not an answer oracle:
 *  - must still contain the drop, so the suggestion is an actionable answer;
 *  - Rare-or-rarer words are never suggested -- we don't hand a player a find
 *    they didn't earn (see RARITY_ORDER; higher rarity = rarer);
 *  - how far a typo may stray depends on the candidate's tier: Common-and-more-
 *    common words tolerate up to two edits (so letter swaps like "freind" ->
 *    "friend" are caught), while Uncommon words demand an exact one-letter fix.
 * The closest spelling wins, ties breaking toward the more common word. Only
 * runs on a rejection, never the accept path, so the scan is off the hot path.
 */
export function suggestionFor(word: string, drop: string): string | undefined {
  const normalized = word.toLowerCase();
  const needle = drop.toLowerCase();
  const uncommonIndex = RARITY_ORDER.indexOf("Uncommon");

  let best: string | undefined;
  let bestDistance = Infinity;
  let bestZipf = -Infinity;
  for (let i = 0; i < WORDS.length; i++) {
    const candidate = WORDS[i];
    if (Math.abs(candidate.length - normalized.length) > 2) continue;
    if (candidate === needle) continue;
    if (!candidate.includes(needle)) continue;

    const info = rarityFor(candidate)!;
    const rank = RARITY_ORDER.indexOf(info.rarity);
    if (rank < uncommonIndex) continue; // Rare or rarer: never suggested.
    const maxDistance = rank === uncommonIndex ? 1 : 2;

    const distance = editDistanceUpTo(normalized, candidate, maxDistance);
    if (distance > maxDistance) continue;

    if (distance < bestDistance || (distance === bestDistance && info.zipf > bestZipf)) {
      bestDistance = distance;
      bestZipf = info.zipf;
      best = candidate;
    }
  }
  return best;
}

/**
 * Levenshtein distance between `a` and `b`, abandoned early once it is known to
 * exceed `max` (returning `max + 1`). Bounding keeps the per-candidate cost
 * tiny -- we only ever care whether a word is within one or two edits.
 */
function editDistanceUpTo(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;

  let prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    const curr = new Array<number>(lb + 1);
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[lb];
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
 * even when their base words are common. Tense inflections inherit their
 * base word's frequency outright; other transparent suffixes are capped at
 * the base frequency so they cannot turn an everyday word into a top-tier
 * answer.
 */
function adjustedZipf(word: string, zipf: number): number {
  const tenseBase = tenseBaseForm(word);
  if (tenseBase) return zipfFor(tenseBase);

  const base = scoringBaseForm(word);
  if (!base) return zipf;
  return Math.max(zipf, zipfFor(base));
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

/**
 * Return a dictionary-backed base for the common past (-ed) and ongoing
 * (-ing) verb forms. These must use the base frequency exactly: "rated"
 * scores as "rate", and "making" scores as "make".
 */
function tenseBaseForm(word: string): string | undefined {
  const candidates: string[] = [];

  if (word.length > 5 && word.endsWith("ied")) {
    candidates.push(`${word.slice(0, -3)}y`);
  } else if (word.length > 4 && word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    // Prefer the silent-e spelling where both candidates are words (rated -> rate, not rat).
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  if (word.length > 4 && word.endsWith("ying")) {
    candidates.push(`${word.slice(0, -4)}y`, `${word.slice(0, -4)}ie`);
  } else if (word.length > 5 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    // Prefer the silent-e spelling where both candidates are words (making -> make, not mak).
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  return candidates.find((candidate) => WORD_INDEX.has(candidate));
}

function zipfFor(word: string): number {
  return zipfTenths[WORD_INDEX.get(word)!] / 10;
}

function stripDoubledConsonant(stem: string): string {
  if (
    stem.length > 3 &&
    stem[stem.length - 1] === stem[stem.length - 2] &&
    /[bcdfghjklmnpqrstvwxyz]/.test(stem[stem.length - 1])
  ) {
    return stem.slice(0, -1);
  }
  return stem;
}

function rarityForZipf(zipf: number): Rarity {
  // Missing corpus data is not evidence that a word is genuinely Mythic.
  if (zipf === UNKNOWN_ZIPF) return "Extremely Rare";
  if (rarityScore(zipf) >= 9.5) return "Mythic";
  if (zipf >= 6.4) return "Quotidian";
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  return "Extremely Rare";
}

export const RARITY_ORDER: Rarity[] = [
  "Mythic",
  "Extremely Rare",
  "Rare",
  "Uncommon",
  "Common",
  "Very Common",
  "Quotidian",
];

/**
 * A player-facing "rarity score" derived from Zipf frequency, with the
 * polarity flipped (wordfreq's Zipf scale runs *higher* for more common
 * words -- e.g. "the" ~7.7, "aardvark" ~2.4 -- which reads backwards for a
 * rarity score) and then normalized between the 1.0 floor for measured
 * wordfreq values and the dictionary's most common word. An unknown-frequency
 * lookup is stored as 1.4 and consequently scores 9.4, while a measured 1.0
 * earns a perfect 10. Internal ranking
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

/** Highest displayed rarity score earned in the current puzzle. */
export function topRarityScore(words: readonly Pick<AcceptedWord, "zipf">[]): number {
  return words.reduce((top, word) => Math.max(top, rarityScore(word.zipf)), 0);
}
