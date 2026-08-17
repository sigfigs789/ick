import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import legacyRarityData from "../data/rarity-legacy.json";
import { baseForm, boundBaseCandidates } from "./stem";
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
 *     filling 0..9.5 and the deep tail 9.5..10 (anchored at the data's live
 *     minimum), with the deep tail labeled Mythic. No Legend tier.
 *   - 2026-08-16 and 2026-08-17: the two-band scale widened so measured words
 *     fill 0..9.9 and the deep tail 9.9..10, with every word at/below Zipf 0
 *     clamped to a flat 10. The top of the scale is split by score into two
 *     ranks: Legend (>= 9.9) and Mythic (9.5..9.89). This is also where the
 *     bound-suffix base-form adjustment turns on.
 *   - on/after 2026-08-18 (the latest system): identical to the wide-band scale,
 *     except words no corpus attests (the sentinel Zipf) no longer earn the
 *     perfect 10 -- they floor to the elite-band bottom, 9.90 (still Legend), so
 *     the perfect 10 is reserved for words with genuine deep-tail frequency data.
 * The puzzle date selects the `Scoring` profile; callers that omit a date get
 * the newest system.
 */
const NEW_SCORING_START = "2026-08-15";
const WIDE_BAND_START = "2026-08-16";
const SENTINEL_FLOOR_START = "2026-08-18";

// Rank/format cutoffs for the latest (Legend) system, fixed on the score scale
// (not derived from the band ceiling). The rank keys off the score's two-decimal
// value: Legend at 9.9+, Mythic at 9.5..9.89, and everything below keeps its
// measured Zipf-band label. Because scores round to two decimals first, a hair
// under the line rounds up and flips the rank -- a raw 9.895 becomes 9.90
// (Legend) and a raw 9.495 becomes 9.50 (Mythic) -- while 9.85..9.89 stay Mythic.
// The two top ranks also show two decimals; below shows one.
const LEGEND_MIN_SCORE = 9.9;
const MYTHIC_MIN_SCORE = 9.5;

// Round to two decimals, nudging exact half-cent values up despite binary-float
// error so decimal rounding holds (9.895 -> 9.90, 9.495 -> 9.50). Scores are
// non-negative, so a positive bias is always the right direction.
function roundToCents(n: number): number {
  return Math.round(n * 100 + 1e-6) / 100;
}

// Round to one decimal with the same upward nudge, so 9.45 -> 9.5 despite
// binary-float error. Used where the rank and display key off the one-decimal
// value rather than the two-decimal one.
function roundToTenths(n: number): number {
  return Math.round(n * 10 + 1e-6) / 10;
}

/**
 * The score-based top ranks, each keyed off the value the player actually sees:
 * Legend at 9.9+ (Mythic and Legend show two decimals, so it keys off the
 * two-decimal score, 9.895 -> 9.90 -> Legend) and Mythic wherever the score
 * *displays* as 9.5 or higher. Extremely Rare and below show one decimal, so the
 * Mythic cutoff keys off the one-decimal value: anything that rounds to 9.5
 * (raw >= 9.45) is Mythic. Anything lower returns undefined, so the caller falls
 * back to the measured Zipf-band label (Extremely Rare and below).
 */
export function topRankForScore(score: number): Extract<Rarity, "Legend" | "Mythic"> | undefined {
  if (roundToCents(score) >= LEGEND_MIN_SCORE) return "Legend";
  if (roundToTenths(score) >= MYTHIC_MIN_SCORE) return "Mythic";
  return undefined;
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
// attests). The 2026-08-15 system anchored the top of its deep-tail band here;
// the latest system clamps at a fixed 0 instead.
const MIN_ZIPF = minZipfHundredths / 100;
// Scores split into two bands at wordfreq's measurement floor. Words wordfreq
// can measure sit at Zipf >= MEASURED_FLOOR and fill 0..ceiling; the deep tail
// -- words only Norvig/Google Books attest, plus words no corpus attests --
// sits below it and gets its own elite ceiling..10 band.
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
  // Whether the bound derivational suffixes (-ization/-isation, -ability/
  // -ibility) inherit their base word's frequency. Introduced with the
  // 2026-08-16 wide-band cutover, so it's off for earlier systems to keep past
  // puzzles' scores frozen (see WIDE_BAND_START).
  boundBaseForms: boolean;
}

// The two-band system. `ceiling` is where the measured band tops out and the
// deep-tail band begins. `tailFloor` is the Zipf that maps to a perfect 10.0:
// anything at or below it is clamped there. Pinning it to a fixed 0 (rather than
// the data's live minimum) keeps deep-tail scores stable when even-rarer words
// are added later, and bounds the scale below -- Zipf is a log scale with no
// natural floor.
// `legend` selects the latest system's top-of-scale treatment: the Legend/Mythic
// score cutoffs, two-decimal precision across the measured band, and the
// score-based two-decimal display. Without it (the 2026-08-15 system) the deep
// tail is a single Mythic rank, the measured band keeps one decimal, and only
// deep-tail scores show two.
// `floorUnattested` (the 2026-08-18 system) stops words no corpus attests from
// earning the perfect 10: a word still sitting at the sentinel Zipf after any
// base-form adjustment scores exactly `ceiling` (9.90, the elite-band bottom),
// keeping the perfect 10 for words with genuine deep-tail frequency data.
function twoBandScoring(
  ceiling: number,
  tailFloor: number,
  boundBaseForms: boolean,
  legend: boolean,
  floorUnattested: boolean
): Scoring {
  const score = (zipf: number): number => {
    // A word left at the sentinel (min) Zipf is unattested -- adjustedZipf
    // already raised anything with a more-common base form above it. It floors
    // to the elite-band bottom rather than the perfect 10.
    if (floorUnattested && zipf === MIN_ZIPF) return roundToCents(ceiling);
    if (zipf >= MEASURED_FLOOR) {
      const s = (ceiling * (MAX_ZIPF - zipf)) / (MAX_ZIPF - MEASURED_FLOOR);
      // The Legend system carries two decimals across the whole band so its
      // fixed rank cutoffs land on the shown value; the 2026-08-15 system kept
      // the measured band at one decimal.
      return legend ? roundToCents(s) : Math.round(s * 10) / 10;
    }
    const clamped = Math.max(zipf, tailFloor);
    const s = ceiling + ((10 - ceiling) * (MEASURED_FLOOR - clamped)) / (MEASURED_FLOOR - tailFloor);
    return legend ? roundToCents(Math.min(s, 10)) : Math.round(Math.min(s, 10) * 100) / 100;
  };
  return {
    zipfAt: (i) => zipfHundredths[i] / 100,
    score,
    rarity: legend
      ? // Latest system: rank the top by the shown two-decimal score against the
        // fixed Legend/Mythic cutoffs; below 9.5 keeps its measured Zipf label.
        (zipf) => topRankForScore(score(zipf)) ?? measuredRarity(zipf)
      : // 2026-08-15 system: the deep-tail library (Zipf < 1) is a single Mythic
        // top rank, with no Legend above it.
        (zipf) => (zipf < MEASURED_FLOOR ? "Mythic" : measuredRarity(zipf)),
    format: legend
      ? // Mythic and Legend (score >= 9.5) show two decimals; below shows one,
        // rounded with the same upward nudge so a raw 9.45 reads "9.5" -- the
        // value the Mythic cutoff keys off (see topRankForScore).
        (s) => (s >= MYTHIC_MIN_SCORE ? s.toFixed(2) : roundToTenths(s).toFixed(1))
      : // Only the deep-tail band (score >= ceiling) shows two decimals.
        (s) => (s >= ceiling ? s.toFixed(2) : s.toFixed(1)),
    boundBaseForms,
  };
}

// The 2026-08-15 system: measured band 0..9.5, deep tail 9.5..10 anchored at the
// data's live minimum, single Mythic top rank, no bound-suffix folding.
const CURRENT_SCORING: Scoring = twoBandScoring(9.5, MIN_ZIPF, false, false, false);
// The 2026-08-16 system: measured band 0..9.9, deep tail 9.9..10 clamped at a
// fixed 0, Legend + Mythic ranks, bound-suffix folding on. Unattested words
// still earn the perfect 10.
const WIDE_SCORING: Scoring = twoBandScoring(9.9, 0, true, true, false);
// The latest system (from SENTINEL_FLOOR_START): the wide-band scale, but
// unattested words floor to 9.90 (Legend) instead of the perfect 10.
const SENTINEL_FLOOR_SCORING: Scoring = twoBandScoring(9.9, 0, true, true, true);

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
  boundBaseForms: false,
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
  if (date === undefined) return SENTINEL_FLOOR_SCORING; // newest system
  if (date < NEW_SCORING_START) return LEGACY_SCORING;
  if (date < WIDE_BAND_START) return CURRENT_SCORING;
  if (date < SENTINEL_FLOOR_START) return WIDE_SCORING;
  return SENTINEL_FLOOR_SCORING;
}

export function isValidWord(word: string): boolean {
  return WORD_INDEX.has(word.toLowerCase());
}

/**
 * The Zipf that stands for "no corpus attests this word" -- the sentinel sitting
 * at the bottom of rarity.json. Words validated live (see game/liveValidate.ts)
 * are absent from the curated list, so rarity.json has no entry for them: it is
 * a positional array index-aligned with dictionary.json, not a word map. A live
 * word therefore scores from whatever frequency the live lookup can find, and
 * from this sentinel when it finds none -- which under the current system floors
 * to 9.90 (Legend) rather than the perfect 10 (see SENTINEL_FLOOR_START).
 */
export function unattestedZipf(): number {
  return MIN_ZIPF;
}

/**
 * Whether the bound-suffix base-form folding is active for a puzzle date. Used
 * by both rarity scoring and same-root duplicate detection so a word's base is
 * defined identically in both, and only from the 2026-08-16 wide-band cutover.
 */
export function boundBaseFormsActive(date?: string): boolean {
  return scoringFor(date).boundBaseForms;
}

export function rarityFor(word: string, date?: string): RarityInfo | undefined {
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const scoring = scoringFor(date);
  const zipf = adjustedZipf(normalized, scoring.zipfAt(i), scoring);
  return { rarity: scoring.rarity(zipf), zipf };
}

/** A word whose rarity was inherited from a base form rather than its own data. */
export interface BaseFormSubstitution {
  /** The word the player actually submitted. */
  word: string;
  /** The base word whose frequency its score used instead. */
  base: string;
  /** The submitted word's own Zipf, before the base-form adjustment. */
  ownZipf: number;
  /** The base word's Zipf -- what the score was actually computed from. */
  baseZipf: number;
}

/**
 * If `word`'s rarity came from a base form rather than its own frequency, report
 * the substitution (submitted word, base, and both Zipfs). Returns undefined when
 * the word scored on its own data. Mirrors adjustedZipf: a tense base is used
 * outright; a transparent/bound base only when it's more common than the word.
 */
export function baseFormSubstitution(
  word: string,
  date?: string
): BaseFormSubstitution | undefined {
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const scoring = scoringFor(date);
  const ownZipf = scoring.zipfAt(i);

  const tenseBase = tenseBaseForm(normalized, scoring);
  if (tenseBase && tenseBase !== normalized) {
    return { word: normalized, base: tenseBase, ownZipf, baseZipf: zipfFor(tenseBase, scoring) };
  }

  const base = scoringBaseForm(normalized, scoring.boundBaseForms);
  if (base && base !== normalized) {
    const baseZipf = zipfFor(base, scoring);
    if (baseZipf > ownZipf) return { word: normalized, base, ownZipf, baseZipf };
  }
  return undefined;
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

  const base = scoringBaseForm(word, scoring.boundBaseForms);
  if (!base) return zipf;
  return Math.max(zipf, zipfFor(base, scoring));
}

function scoringBaseForm(word: string, includeBound: boolean): string | undefined {
  const inflected = baseForm(word);
  if (inflected !== word && WORD_INDEX.has(inflected)) return inflected;

  for (const suffix of ["ness", "ly"]) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    const candidates = [stem, stem.endsWith("i") ? `${stem.slice(0, -1)}y` : ""];
    const base = candidates.find((candidate) => candidate && WORD_INDEX.has(candidate));
    if (base) return base;
  }

  // Bound derivational suffixes (-ization/-isation, -ability/-ibility), gated to
  // the wide-band era. Capped at the base like the transparent suffixes above:
  // "aggrandization" scores as "aggrandize", never rarer than it.
  if (includeBound) {
    const bound = boundBaseCandidates(word).find((candidate) => WORD_INDEX.has(candidate));
    if (bound) return bound;
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
 * rarity score). The latest system splits into two bands at MEASURED_FLOOR:
 * measured words fill 0..9.9 and the deep-tail library fills 9.9..10, with two
 * decimals of resolution at the top (score >= 9.5, where Mythic and Legend sit).
 * The 2026-08-15 system used a narrower 0..9.5 measured band, and puzzles before
 * NEW_SCORING_START use the legacy single-band 1.0..MAX map instead. Internal
 * ranking (see rank.ts) still compares raw Zipf directly; this is purely a
 * display transform.
 */
export function rarityScore(zipf: number, date?: string): number {
  return scoringFor(date).score(zipf);
}

/**
 * The rarity label a raw Zipf earns under a given date's system -- the same
 * mapping `rarityFor` applies internally, exposed for sweeping the scale by Zipf
 * (e.g. checking that a mid-band Zipf lands in the expected rank).
 */
export function rarityForZipf(zipf: number, date?: string): Rarity {
  return scoringFor(date).rarity(zipf);
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
