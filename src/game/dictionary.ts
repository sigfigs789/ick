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
// Stored as hundredths of a Zipf value (integers) so the compressed deep-tail
// band still has the resolution for two-decimal scores. Values can be negative
// for the rarest words (see scripts/generate-data.py).
const zipfHundredths: number[] = rarityData.zipfHundredths;

/** The dictionary's Zipf bounds, computed once from the loaded data. */
// Plain loop rather than Math.min/max(...) -- spreading ~200k elements as call
// arguments risks blowing the stack on some engines (e.g. Safari).
let maxZipfHundredths = -Infinity;
let minZipfHundredths = Infinity;
for (const z of zipfHundredths) {
  if (z > maxZipfHundredths) maxZipfHundredths = z;
  if (z < minZipfHundredths) minZipfHundredths = z;
}
const MAX_ZIPF = maxZipfHundredths / 100;
// The rarest Zipf in the data (the sentinel assigned to words no corpus
// attests); it anchors the top of the deep-tail band at a perfect 10.0.
const MIN_ZIPF = minZipfHundredths / 100;
// Scores split into two bands at wordfreq's measurement floor (see
// scripts/generate-data.py). Words wordfreq can measure sit at Zipf >=
// MEASURED_FLOOR and fill the 0..NORMAL_CEILING range. The deep tail -- words
// only Norvig/Google Books attest, plus words no corpus attests -- sits below
// MEASURED_FLOOR and gets its own elite NORMAL_CEILING..10 band, so any
// deep-tail word always outscores any merely-measured one.
const MEASURED_FLOOR = 1;
const NORMAL_CEILING = 9.5;

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

export function rarityFor(word: string): RarityInfo | undefined {
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const zipf = adjustedZipf(normalized, zipfHundredths[i] / 100);
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
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  if (word.length > 4 && word.endsWith("ying")) {
    candidates.push(`${word.slice(0, -4)}y`, `${word.slice(0, -4)}ie`);
  } else if (word.length > 5 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  // Prefer the most common valid base so that a rare homograph of a candidate
  // spelling can't hijack the form: "played" scores as "play" (5.6), not the
  // obscure "playe"; "rated" still scores as "rate" (5.1), not "rat".
  let base: string | undefined;
  let baseZipf = -Infinity;
  for (const candidate of candidates) {
    if (!WORD_INDEX.has(candidate)) continue;
    const zipf = zipfFor(candidate);
    if (zipf > baseZipf) {
      base = candidate;
      baseZipf = zipf;
    }
  }
  return base;
}

function zipfFor(word: string): number {
  return zipfHundredths[WORD_INDEX.get(word)!] / 100;
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
  if (zipf < MEASURED_FLOOR) return "Mythic"; // the deep-tail library is its own top rank
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
 * rarity score). It splits into two bands at MEASURED_FLOOR: words wordfreq
 * can measure spread across 0..NORMAL_CEILING (rarest measured word tops out
 * at NORMAL_CEILING, one decimal of resolution), while the deep-tail library
 * fills NORMAL_CEILING..10 -- so a word only the fallback corpora attest always
 * beats a measured one. The deep-tail band normalizes against MIN_ZIPF (the
 * rarest word in the data), so only words no corpus attests reach a perfect 10;
 * attested-but-vanishingly-rare words land just below. Because that band is
 * narrow, it carries two decimals of resolution. Internal ranking (see rank.ts)
 * still compares raw Zipf directly; this is purely a display transform.
 */
export function rarityScore(zipf: number): number {
  if (zipf >= MEASURED_FLOOR) {
    const score = (NORMAL_CEILING * (MAX_ZIPF - zipf)) / (MAX_ZIPF - MEASURED_FLOOR);
    return Math.round(score * 10) / 10;
  }
  const score =
    NORMAL_CEILING + ((10 - NORMAL_CEILING) * (MEASURED_FLOOR - zipf)) / (MEASURED_FLOOR - MIN_ZIPF);
  return Math.round(Math.min(score, 10) * 100) / 100;
}

/**
 * Format a rarity-score value for display: scores in the compressed deep-tail
 * band (NORMAL_CEILING..10) show two decimals so its fine gradient is visible,
 * while the measured band keeps a single decimal. Applies to a single word's
 * score (or the top score), not to summed totals.
 */
export function formatScore(score: number): string {
  return score >= NORMAL_CEILING ? score.toFixed(2) : score.toFixed(1);
}

/** Format a word's rarity score for display, keyed off its Zipf. */
export function formatRarityScore(zipf: number): string {
  return formatScore(rarityScore(zipf));
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
