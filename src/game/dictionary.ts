import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import legacyRarityData from "../data/rarity-legacy.json";
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
 * Rarity scoring changed on 2026-08-15 (the frequency waterfall + two-band
 * scale). Puzzles dated on or after that use the new system; earlier puzzles
 * keep the old flat-1.4-unknown data and single-band formula so their scores
 * never shift retroactively. The puzzle date selects the `Scoring` profile;
 * callers that omit a date get the current system.
 */
const NEW_SCORING_START = "2026-08-15";
function usesLegacyScoring(date?: string): boolean {
  return date !== undefined && date < NEW_SCORING_START;
}

// -- Current frequency data (see scripts/generate-data.py) ------------------
// Stored as hundredths of a Zipf value (integers) so the compressed deep-tail
// band still has the resolution for two-decimal scores. Values can be negative
// for the rarest words. Index-aligned with dictionary.json.
const zipfHundredths: number[] = rarityData.zipfHundredths;
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
// Scores split into two bands at wordfreq's measurement floor. Words wordfreq
// can measure sit at Zipf >= MEASURED_FLOOR and fill 0..NORMAL_CEILING; the
// deep tail -- words only Norvig/Google Books attest, plus words no corpus
// attests -- sits below it and gets its own elite NORMAL_CEILING..10 band.
const MEASURED_FLOOR = 1;
const NORMAL_CEILING = 9.5;

// -- Legacy frequency data (puzzles before NEW_SCORING_START) ---------------
// One-decimal Zipf values with unknown-frequency words floored flat to 1.4,
// scored against a single 1.0..MAX range. Also index-aligned with
// dictionary.json (the word list has not changed).
const legacyZipfTenths: number[] = legacyRarityData.zipfTenths;
let maxLegacyTenths = -Infinity;
for (const z of legacyZipfTenths) {
  if (z > maxLegacyTenths) maxLegacyTenths = z;
}
const LEGACY_MAX_ZIPF = maxLegacyTenths / 10;
const LEGACY_MIN_ZIPF = 1; // wordfreq's measured lower bound
const LEGACY_UNKNOWN_ZIPF = 1.4;

/** A dated scoring system: how to read a word's Zipf, score it, and label it. */
interface Scoring {
  zipfAt(index: number): number;
  score(zipf: number): number;
  rarity(zipf: number): Rarity;
  format(score: number): string;
}

const CURRENT_SCORING: Scoring = {
  zipfAt: (i) => zipfHundredths[i] / 100,
  score: (zipf) => {
    if (zipf >= MEASURED_FLOOR) {
      const score = (NORMAL_CEILING * (MAX_ZIPF - zipf)) / (MAX_ZIPF - MEASURED_FLOOR);
      return Math.round(score * 10) / 10;
    }
    const score =
      NORMAL_CEILING +
      ((10 - NORMAL_CEILING) * (MEASURED_FLOOR - zipf)) / (MEASURED_FLOOR - MIN_ZIPF);
    return Math.round(Math.min(score, 10) * 100) / 100;
  },
  // The deep-tail library (Zipf < MEASURED_FLOOR) is its own top rank.
  rarity: (zipf) => (zipf < MEASURED_FLOOR ? "Mythic" : measuredRarity(zipf)),
  // The narrow deep-tail band shows two decimals so its gradient is visible.
  format: (score) => (score >= NORMAL_CEILING ? score.toFixed(2) : score.toFixed(1)),
};

const LEGACY_SCORING: Scoring = {
  zipfAt: (i) => legacyZipfTenths[i] / 10,
  score: (zipf) =>
    Math.round(((LEGACY_MAX_ZIPF - zipf) / (LEGACY_MAX_ZIPF - LEGACY_MIN_ZIPF)) * 100) / 10,
  rarity: (zipf) => {
    // Missing corpus data is not evidence that a word is genuinely Mythic.
    if (zipf === LEGACY_UNKNOWN_ZIPF) return "Extremely Rare";
    if (LEGACY_SCORING.score(zipf) >= 9.5) return "Mythic";
    return measuredRarity(zipf);
  },
  format: (score) => score.toFixed(1),
};

// The Zipf-band labels for the measured range are identical across systems.
function measuredRarity(zipf: number): Rarity {
  if (zipf >= 6.4) return "Quotidian";
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  return "Extremely Rare";
}

function scoringFor(date?: string): Scoring {
  return usesLegacyScoring(date) ? LEGACY_SCORING : CURRENT_SCORING;
}

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

export function rarityFor(word: string, date?: string): RarityInfo | undefined {
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const scoring = scoringFor(date);
  const zipf = adjustedZipf(normalized, scoring.zipfAt(i), scoring);
  return { rarity: scoring.rarity(zipf), zipf };
}

/**
 * The single rarest dictionary word containing `drop` as a substring -- the
 * best a player could theoretically submit for this drop. Lower Zipf means
 * rarer, so this is a min-scan over the whole dictionary, same containment
 * rule as submit.ts's containsDropInOrder.
 */
export function bestWordForDrop(drop: string, date?: string): AcceptedWord | undefined {
  const needle = drop.toLowerCase();
  let best: AcceptedWord | undefined;
  for (let i = 0; i < WORDS.length; i++) {
    if (!WORDS[i].includes(needle)) continue;
    const info = rarityFor(WORDS[i], date)!;
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
function adjustedZipf(word: string, zipf: number, scoring: Scoring): number {
  const tenseBase = tenseBaseForm(word, scoring);
  if (tenseBase) return zipfFor(tenseBase, scoring);

  const base = scoringBaseForm(word);
  if (!base) return zipf;
  return Math.max(zipf, zipfFor(base, scoring));
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
function tenseBaseForm(word: string, scoring: Scoring): string | undefined {
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
    const zipf = zipfFor(candidate, scoring);
    if (zipf > baseZipf) {
      base = candidate;
      baseZipf = zipf;
    }
  }
  return base;
}

function zipfFor(word: string, scoring: Scoring): number {
  return scoring.zipfAt(WORD_INDEX.get(word)!);
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
 * rarity score). The current system splits into two bands at MEASURED_FLOOR:
 * measured words fill 0..NORMAL_CEILING and the deep-tail library fills
 * NORMAL_CEILING..10, with two decimals of resolution there. Puzzles before
 * NEW_SCORING_START use the legacy single-band 1.0..MAX map instead. Internal
 * ranking (see rank.ts) still compares raw Zipf directly; this is purely a
 * display transform.
 */
export function rarityScore(zipf: number, date?: string): number {
  return scoringFor(date).score(zipf);
}

/**
 * Format a rarity-score value for display. Under the current system the
 * compressed deep-tail band (NORMAL_CEILING..10) shows two decimals; the
 * measured band and all legacy scores keep a single decimal. Applies to a
 * single word's score (or the top score), not to summed totals.
 */
export function formatScore(score: number, date?: string): string {
  return scoringFor(date).format(score);
}

/** Format a word's rarity score for display, keyed off its Zipf. */
export function formatRarityScore(zipf: number, date?: string): string {
  const scoring = scoringFor(date);
  return scoring.format(scoring.score(zipf));
}

/** Sum the displayed rarity scores earned during one game session. */
export function totalRarityScore(
  words: readonly Pick<AcceptedWord, "zipf">[],
  date?: string
): number {
  const scoring = scoringFor(date);
  const total = words.reduce((sum, word) => sum + scoring.score(word.zipf), 0);
  return Math.round(total * 10) / 10;
}

/** Highest displayed rarity score earned in the current puzzle. */
export function topRarityScore(
  words: readonly Pick<AcceptedWord, "zipf">[],
  date?: string
): number {
  const scoring = scoringFor(date);
  return words.reduce((top, word) => Math.max(top, scoring.score(word.zipf)), 0);
}
