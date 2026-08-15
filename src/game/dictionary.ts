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
 * Rarity scoring has evolved across two cutovers, each date-gated so past
 * puzzles never shift retroactively:
 *   - before 2026-08-15: the legacy flat-1.4-unknown data + single-band formula.
 *   - 2026-08-15 only: the frequency waterfall + two-band scale, measured words
 *     filling 0..9.5 and the deep tail 9.5..10.
 *   - on/after 2026-08-16: the same two-band scale widened so measured words
 *     fill 0..9.8 and the deep tail 9.8..10, with every word at/below Zipf 0
 *     clamped to a flat 10 (so the scale is bounded below and stable when
 *     rarer words are added later).
 * The puzzle date selects the `Scoring` profile; callers that omit a date get
 * the newest system.
 */
const NEW_SCORING_START = "2026-08-15";
const WIDE_BAND_START = "2026-08-16";

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
// can measure sit at Zipf >= MEASURED_FLOOR and fill 0..ceiling; the deep tail
// -- words only Norvig/Google Books attest, plus words no corpus attests --
// sits below it and gets its own elite ceiling..10 band. The band ceiling moved
// from 9.5 to 9.9 at WIDE_BAND_START (see twoBandScoring).
const MEASURED_FLOOR = 1;

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

// The two-band system. `ceiling` is where the measured band tops out and the
// deep-tail band begins (9.5 originally, 9.9 from WIDE_BAND_START). `tailFloor`
// is the Zipf that maps to a perfect 10.0: anything at or below it is clamped
// there. Pinning it to a fixed 0 (rather than the data's live minimum) keeps
// deep-tail scores stable when even-rarer words are added later, and bounds the
// scale below -- Zipf is a log scale with no natural floor.
function twoBandScoring(ceiling: number, tailFloor: number): Scoring {
  return {
    zipfAt: (i) => zipfHundredths[i] / 100,
    score: (zipf) => {
      if (zipf >= MEASURED_FLOOR) {
        const score = (ceiling * (MAX_ZIPF - zipf)) / (MAX_ZIPF - MEASURED_FLOOR);
        return Math.round(score * 10) / 10;
      }
      const clamped = Math.max(zipf, tailFloor);
      const score =
        ceiling + ((10 - ceiling) * (MEASURED_FLOOR - clamped)) / (MEASURED_FLOOR - tailFloor);
      return Math.round(Math.min(score, 10) * 100) / 100;
    },
    // The deep-tail library (Zipf < MEASURED_FLOOR) is its own top rank.
    rarity: (zipf) => (zipf < MEASURED_FLOOR ? "Legend" : measuredRarityModern(zipf)),
    // The narrow deep-tail band shows two decimals so its gradient is visible.
    format: (score) => (score >= ceiling ? score.toFixed(2) : score.toFixed(1)),
  };
}

// The original two-band system (2026-08-15) anchored the top of the deep tail
// at the data's live minimum, so it kept negative Zipf resolution; the widened
// system (from WIDE_BAND_START) clamps everything at/below Zipf 0 to a flat 10.
const CURRENT_SCORING: Scoring = twoBandScoring(9.5, MIN_ZIPF);
const WIDE_SCORING: Scoring = twoBandScoring(9.9, 0);

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

// The Zipf-band labels for the measured range, used by the legacy single-band
// system. The legacy top rank ("Mythic") is score-derived (see LEGACY_SCORING),
// so this fallback tops out at "Extremely Rare".
function measuredRarity(zipf: number): Rarity {
  if (zipf >= 6.4) return "Quotidian";
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  return "Extremely Rare";
}

// The modern (two-band) measured labels. The deep-tail library is its own top
// rank ("Legend", see twoBandScoring), so the rarest *measured* slice becomes
// "Mythic" -- one notch below Legend -- and "Extremely Rare" keeps the band
// beneath it. The Zipf thresholds from Rare down are identical to the legacy
// scale; only the top of the old "Extremely Rare" band (Zipf 1.0-1.3, ~score
// 9.5-9.9 under the widened ceiling) is split off into "Mythic".
function measuredRarityModern(zipf: number): Rarity {
  if (zipf >= 6.4) return "Quotidian";
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  if (zipf >= 1.3) return "Extremely Rare";
  return "Mythic";
}

function scoringFor(date?: string): Scoring {
  if (date === undefined) return WIDE_SCORING; // newest system
  if (date < NEW_SCORING_START) return LEGACY_SCORING;
  if (date < WIDE_BAND_START) return CURRENT_SCORING;
  return WIDE_SCORING;
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
  "Legend",
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
 * measured words fill 0..ceiling and the deep-tail library fills ceiling..10,
 * with two decimals of resolution there (ceiling is 9.8 from WIDE_BAND_START,
 * 9.5 before it). Puzzles before NEW_SCORING_START use the legacy single-band
 * 1.0..MAX map instead. Internal
 * ranking (see rank.ts) still compares raw Zipf directly; this is purely a
 * display transform.
 */
export function rarityScore(zipf: number, date?: string): number {
  return scoringFor(date).score(zipf);
}

/**
 * Format a rarity-score value for display. Under the current system the
 * compressed deep-tail band (ceiling..10) shows two decimals; the
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
