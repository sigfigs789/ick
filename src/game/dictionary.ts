import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import legacyRarityData from "../data/rarity-legacy.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
import wordRejectionData from "../data/word-rejections.json";
import {
  baseForm,
  boundBaseCandidates,
  degreeBaseCandidates,
  degreeCounterpart,
  inflectionBaseCandidates,
} from "./stem";
import { nearMissEditBudget, withinEditDistance } from "./nearMiss";
import type { AcceptedWord, Rarity, RarityInfo, RejectionReason } from "./types";

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
 *   - 2026-08-16 onward: the two-band scale widened so
 *     measured words fill 0..9.9 and the deep tail 9.9..10, with every word
 *     at/below Zipf 0 clamped to a flat 10. The top of the scale is split by
 *     score into two ranks: Legend (>= 9.9) and Mythic (9.5..9.89). This is also
 *     where the bound-suffix base-form adjustment turns on.
 *   - on/after 2026-08-21 (the latest system): two independent changes landing on
 *     the same date. The measured Zipf bands are retuned -- Elusive added between
 *     Extremely Rare and Mythic, Quotidian folded into Very Common (see
 *     measuredRarity), which moves labels but no scores. And the fold considers
 *     every plausible spelling of a base instead of the one its stemmer happened
 *     to produce, so a conjugation can no longer outscore the word it is a
 *     conjugation of (see `foldCandidates`), which moves scores but adds no
 *     labels. They are gated on separate constants so either can be rolled back
 *     without the other.
 * The puzzle date selects the `Scoring` profile; callers that omit a date get
 * the newest system.
 */
const NEW_SCORING_START = "2026-08-15";
const WIDE_BAND_START = "2026-08-16";
const CHAINED_BASE_START = "2026-08-19";
const NARROW_BANDS_START = "2026-08-21";
const INFLECTION_FOLD_START = "2026-08-21";

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
 * *displays* as 9.5 or higher. Elusive and below show one decimal, so the
 * Mythic cutoff keys off the one-decimal value: anything that rounds to 9.5
 * (raw >= 9.45) is Mythic. Anything lower returns undefined, so the caller falls
 * back to the measured Zipf-band label (Elusive and below).
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

// -- Curated base-form overrides (src/data/score-overrides.json) -------------
/**
 * A hand-reviewed demotion: `word` scores no rarer than `base` from `since` on.
 * `reason` is review notes only -- nothing here reads it -- kept beside the entry
 * so the data file explains itself.
 */
interface ScoreOverride {
  base: string;
  since: string;
  reason?: string;
}

/**
 * Words that carry no measured frequency at all and were reviewed as *not*
 * deserving the perfect 10.00 / Legend the unattested sentinel hands out.
 *
 * The sentinel is the right score for a genuine find the corpora simply haven't
 * caught up with ("enshittification"). It is the wrong score for a mechanical
 * derivation of an ordinary word -- "iratest" is the unattested superlative of
 * "irate" (Zipf 2.78), and `scoringBaseForm` below has no -est rule, so nothing
 * caps it. Widening the stemmer instead is not an option at this scale: a blanket
 * bare-`s` strip re-scores ~10,900 words and strips 2,189 of a perfect 10, which
 * destroys far more good answers than it fixes. So each unattested word is
 * reviewed one at a time (see .claude/skills/audit-unscored-legends) and pinned
 * here to the base it should have scored as.
 *
 * Every entry carries its own `since` date rather than riding one global cutover,
 * because the list grows a batch per day: a demotion applies from the puzzle it
 * was reviewed for onward, and every earlier puzzle keeps the score it showed.
 *
 * Scoring only. Same-root duplicate detection (submit.ts's `rootKey`) is
 * deliberately untouched, matching the -ness/-ly bases in `scoringBaseForm`:
 * scoring a word as its base is not a claim that a player may only have one of
 * them.
 */
const SCORE_OVERRIDES: ReadonlyMap<string, ScoreOverride> = new Map(
  Object.entries(scoreOverrideData as Record<string, ScoreOverride>)
);

// -- Curated fold exemptions (src/data/fold-exemptions.json) -----------------
/** A hand-reviewed exemption: `word` does not fold at all from `since` on. */
interface FoldExemption {
  since: string;
  /** Review notes only -- nothing here reads it. */
  reason?: string;
}

/**
 * The escape hatch for the one thing an override cannot express.
 *
 * `score-overrides.json` can only push a word *down* to a base. When a spelling
 * rule folds a word it shouldn't, the fix has to push the other way -- and there
 * is no "score this on its own data" override. So a word listed here contributes
 * no fold candidates: it neither folds onto a base of its own nor passes a chain
 * through to one. That second half is what makes it useful, since the usual bad
 * fold is a legitimate word reached through a junk intermediate.
 *
 * Dated like the overrides and rejections, so an exemption applies from the
 * puzzle it was reviewed for onward and no earlier puzzle re-scores. Deliberately
 * a short list: a rule that needs many entries is a rule that needs a tighter
 * guard instead.
 */
const FOLD_EXEMPTIONS: ReadonlyMap<string, FoldExemption> = new Map(
  Object.entries(foldExemptionData as Record<string, FoldExemption>)
);

/** Whether `word`'s score is exempt from folding under `date`'s puzzle. */
function foldExempt(word: string, date?: string): boolean {
  const exemption = FOLD_EXEMPTIONS.get(word);
  if (!exemption) return false;
  return date === undefined || date >= exemption.since;
}

/**
 * The curated base for `word` under `date`'s system, or undefined when no
 * override applies. An omitted date means the newest system, where every
 * override is active. A base missing from the dictionary is ignored rather than
 * trusted -- a test pins that this never happens in the shipped data.
 */
function overrideBase(word: string, date?: string): string | undefined {
  const override = SCORE_OVERRIDES.get(word);
  if (!override) return undefined;
  if (date !== undefined && date < override.since) return undefined;
  return WORD_INDEX.has(override.base) ? override.base : undefined;
}

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
  // Whether a base form is resolved through its *own* base rather than read as a
  // raw frequency -- see mostCommonFold. Also makes the tense rule cap instead of
  // inherit outright, and widens the -ied guard to reach five-letter forms.
  // Introduced with the 2026-08-19 cutover; off for earlier systems so past
  // puzzles' scores stay frozen (see CHAINED_BASE_START).
  chainedBaseForms: boolean;
  // Whether the fold considers every plausible spelling of a base rather than the
  // one spelling `baseForm` happens to produce, and covers the inflections the
  // single-spelling rules missed entirely (plurals that need a bare -s off an -es
  // word, Latin plurals, comparatives, superlatives). Introduced with the
  // 2026-08-21 cutover; off for earlier systems so past puzzles' scores stay
  // frozen (see INFLECTION_FOLD_START).
  inflectionFolds: boolean;
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
function twoBandScoring(
  ceiling: number,
  tailFloor: number,
  boundBaseForms: boolean,
  legend: boolean,
  chainedBaseForms = false,
  // Whether the retuned measured Zipf bands apply -- see measuredRarity. Labels
  // only; no score moves. Off for earlier systems so archived puzzles keep the
  // labels they were played with (see NARROW_BANDS_START).
  narrowBands = false,
  inflectionFolds = false
): Scoring {
  const score = (zipf: number): number => {
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
        (zipf) => topRankForScore(score(zipf)) ?? measuredRarity(zipf, narrowBands)
      : // 2026-08-15 system: the deep-tail library (Zipf < 1) is a single Mythic
        // top rank, with no Legend above it.
        (zipf) => (zipf < MEASURED_FLOOR ? "Mythic" : measuredRarity(zipf, narrowBands)),
    format: legend
      ? // Mythic and Legend (score >= 9.5) show two decimals; below shows one,
        // rounded with the same upward nudge so a raw 9.45 reads "9.5" -- the
        // value the Mythic cutoff keys off (see topRankForScore).
        (s) => (s >= MYTHIC_MIN_SCORE ? s.toFixed(2) : roundToTenths(s).toFixed(1))
      : // Only the deep-tail band (score >= ceiling) shows two decimals.
        (s) => (s >= ceiling ? s.toFixed(2) : s.toFixed(1)),
    boundBaseForms,
    chainedBaseForms,
    inflectionFolds,
  };
}

// The 2026-08-15 system: measured band 0..9.5, deep tail 9.5..10 anchored at the
// data's live minimum, single Mythic top rank, no bound-suffix folding.
const CURRENT_SCORING: Scoring = twoBandScoring(9.5, MIN_ZIPF, false, false);
// The 2026-08-16 system: measured band 0..9.9, deep tail 9.9..10 clamped at a
// fixed 0, Legend + Mythic ranks, bound-suffix folding on, single-hop bases.
const WIDE_SCORING: Scoring = twoBandScoring(9.9, 0, true, true);
// The 2026-08-19 system: the same bands and ranks, with base forms resolved
// through their own bases.
const CHAINED_SCORING: Scoring = twoBandScoring(9.9, 0, true, true, true);
// The 2026-08-21 band retune: identical scoring, with the retuned measured Zipf
// bands (see measuredRarity). Kept as its own profile even though the fold
// widening below lands on the same date -- it is what a puzzle scores against if
// INFLECTION_FOLD_START is ever moved past NARROW_BANDS_START to roll the fold
// back on its own.
const NARROW_BAND_SCORING: Scoring = twoBandScoring(9.9, 0, true, true, true, true);
// The latest system (from INFLECTION_FOLD_START): the retuned bands, with the
// fold widened to every plausible spelling of a base.
const INFLECTION_SCORING: Scoring = twoBandScoring(9.9, 0, true, true, true, true, true);

const LEGACY_SCORING: Scoring = {
  zipfAt: (i) => legacyZipfTenths[i] / 10,
  // The legacy scale is defined over LEGACY_MIN_ZIPF..LEGACY_MAX_ZIPF and has no
  // clamp of its own, so a Zipf below its floor scores past 10. A live-validated
  // word carries the *current* data's unattested sentinel (MIN_ZIPF, well below
  // 1.0) whatever date it is played on, which scored 13.8 on an archived
  // pre-NEW_SCORING_START puzzle. Clamping the input rather than the score keeps
  // the value inside the scale's domain and maps the sentinel to exactly 10.0.
  // Every curated legacy word already sits at or above the floor (the data's
  // minimum is exactly 1.0), so no archived puzzle's scores move.
  score: (zipf) =>
    Math.round(
      ((LEGACY_MAX_ZIPF - Math.max(zipf, LEGACY_MIN_ZIPF)) / (LEGACY_MAX_ZIPF - LEGACY_MIN_ZIPF)) *
        100
    ) / 10,
  rarity: (zipf) => {
    // Missing corpus data is not evidence that a word is genuinely Mythic.
    if (zipf === LEGACY_UNKNOWN_ZIPF) return "Extremely Rare";
    if (LEGACY_SCORING.score(zipf) >= 9.5) return "Mythic";
    return measuredRarity(zipf, false);
  },
  format: (score) => score.toFixed(1),
  boundBaseForms: false,
  chainedBaseForms: false,
  inflectionFolds: false,
};

/**
 * The Zipf-band labels for the measured range. Two sets, because the original
 * cutoffs left Extremely Rare covering everything from Zipf 2.5 down to the
 * Mythic line -- 1.75 score points wide against Mythic's 0.39, and better than a
 * third of the words any drop can reach, which made purple the default outcome
 * for anything that was not an everyday word rather than a find worth having.
 *
 * The retuned bands (NARROW_BANDS_START on) fix that by splitting the crowded
 * top of the measured range three ways instead of two. Scores 6.8..9.4 hold
 * roughly 45% of everything a drop can reach, and Rare/Extremely Rare/Elusive
 * now split it so no single band bulges and Rare stops reaching into the high
 * 8s. Elusive takes the smallest slice deliberately -- ~13% against their ~16%
 * each -- so hitting it reads as closing in on Mythic rather than as one more
 * step up the ladder. Below them Uncommon and Common are unchanged in spirit,
 * and Very Common absorbs what used to be a separate Quotidian tier at the very
 * bottom. Scores are untouched throughout -- this only changes which label a
 * score wears.
 *
 * Both sets stay live: a puzzle played before the cutover keeps the tiers it
 * was played with, Quotidian included.
 */
function measuredRarity(zipf: number, narrowBands: boolean): Rarity {
  if (narrowBands) {
    if (zipf >= 4.85) return "Very Common";
    if (zipf >= 3.9) return "Common";
    // 3.15 for the same reason Elusive's cutoff is 1.59: it puts the seam exactly
    // on the shown value, so everything displaying 6.8 or rarer is Rare and
    // everything displaying 6.7 or commoner is Uncommon.
    // Every cutoff here is picked that way (hence 4.85 and 2.13 rather than 4.9
    // and 2.1): a score is shown to one decimal, so a boundary landing mid-tenth
    // would let two words show the same number in different colors, which reads
    // as a bug even though each label is correct for its Zipf. A test pins that
    // no displayed value straddles a band.
    if (zipf >= 3.15) return "Uncommon";
    if (zipf >= 2.13) return "Rare";
    // 1.59 rather than a rounder 1.6 so the seam lands exactly on the shown
    // value: every Zipf below it displays 9.1 or rarer, every Zipf at or above
    // it displays 9.0 or commoner. Elusive is 9.1..9.4 and purple 8.3..9.0, with
    // no score able to show on the wrong side of the line. (The cutoff has to
    // clear the cents rounding that happens before the tenths rounding, which
    // is why 1.58 -- raw 9.047, shown 9.1 -- sits on the Elusive side.)
    if (zipf >= 1.59) return "Extremely Rare";
    return "Elusive";
  }
  // The original bands, frozen for archived puzzles -- Quotidian and all.
  if (zipf >= 6.4) return "Quotidian";
  if (zipf >= 5.2) return "Very Common";
  if (zipf >= 4.2) return "Common";
  if (zipf >= 3.3) return "Uncommon";
  if (zipf >= 2.5) return "Rare";
  return "Extremely Rare";
}

function scoringFor(date?: string): Scoring {
  if (date === undefined) return INFLECTION_SCORING; // newest system
  if (date < NEW_SCORING_START) return LEGACY_SCORING;
  if (date < WIDE_BAND_START) return CURRENT_SCORING;
  if (date < CHAINED_BASE_START) return WIDE_SCORING;
  if (date < NARROW_BANDS_START) return CHAINED_SCORING;
  // The two 2026-08-21 changes are gated separately, so this branch only serves a
  // date range if one of them is rolled back past the other. With both constants
  // on the same day it selects nothing.
  if (date < INFLECTION_FOLD_START) return NARROW_BAND_SCORING;
  return INFLECTION_SCORING;
}

// -- Curated rejections (src/data/word-rejections.json) ----------------------
/** A hand-reviewed rejection: `word` is unplayable from `since` on, with `reason`. */
interface WordRejection {
  reason: CuratedRejectionReason;
  since: string;
  /** Review notes only -- nothing here reads it. */
  note?: string;
}

/**
 * The reasons a reviewed rejection can carry: the specific messages `submit.ts`
 * already knows how to show, plus the generic curated-list message for a word
 * with no more specific fault.
 */
export const CURATED_REJECTION_REASONS = [
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "misspelling",
  "obsolete",
  "archaic",
  "dated",
  "not-a-word",
] as const;
export type CuratedRejectionReason = (typeof CURATED_REJECTION_REASONS)[number];

/**
 * Words that stay in the dictionary but are no longer playable, each with the
 * reason a player sees when they try it.
 *
 * Rejecting by *removal* was the older approach and it lost information. The five
 * index-aligned structures (`dictionary[]`, `zipfHundredths[]`, `codes`,
 * `zipfTenths[]`, legacy `codes`) had to be edited in lockstep; the verdict ended
 * up split across `blocklist.txt`, `rejection-metadata.json` and
 * `wiktionary-reasons.json` depending on the reason; and because a full rebuild
 * re-derives the dictionary from its sources, keeping a word out meant keeping it
 * out in whichever of those files happened to be regen-proof for that reason.
 *
 * Recording the verdict here instead means the word is judged exactly once. This
 * file is hand-maintained and never regenerated, so the rejection cannot be
 * undone by a data refresh, and the audit that produced it skips anything already
 * listed rather than re-assessing it.
 *
 * Dated like the score overrides: a rejection applies from the puzzle it was
 * reviewed for onward, so an archived puzzle still validates the words it
 * validated on the day it was played.
 */
const WORD_REJECTIONS: ReadonlyMap<string, WordRejection> = new Map(
  Object.entries(wordRejectionData as Record<string, WordRejection>)
);

/**
 * The reviewed reason `word` is unplayable under `date`'s puzzle, or undefined
 * when no rejection applies. An omitted date means the newest system, where every
 * rejection is in force.
 */
export function curatedRejection(word: string, date?: string): RejectionReason | undefined {
  const rejection = WORD_REJECTIONS.get(word.toLowerCase());
  if (!rejection) return undefined;
  if (date !== undefined && date < rejection.since) return undefined;
  return rejection.reason;
}

/**
 * Whether a submission is allowed. Membership in the curated dictionary, minus
 * the reviewed rejections above -- a rejected word is still in `dictionary.json`
 * (and still carries its rarity entry, so past puzzles keep scoring), but it is
 * not playable from its rejection date on.
 */
export function isValidWord(word: string, date?: string): boolean {
  const normalized = word.toLowerCase();
  return WORD_INDEX.has(normalized) && curatedRejection(normalized, date) === undefined;
}

/**
 * The Zipf that stands for "no corpus attests this word" -- the sentinel sitting
 * at the bottom of rarity.json. Words validated live (see game/liveValidate.ts)
 * are absent from the curated list, so rarity.json has no entry for them: it is
 * a positional array index-aligned with dictionary.json, not a word map. A live
 * word therefore scores from whatever frequency the live lookup can find, and
 * from this sentinel when it finds none -- the rarest-word value, which scores a
 * perfect 10 / Legend.
 */
export function unattestedZipf(): number {
  return MIN_ZIPF;
}

/**
 * Whether `zipf` is the unattested sentinel -- the word carries no measured
 * frequency at all and its score is the system's stand-in value rather than
 * anything derived from data -- the perfect 10 the sentinel Zipf earns is a
 * stand-in, not a measurement. Deliberately date-blind: every scoring system
 * substitutes some artificial score here, and they all count the same for
 * monitoring.
 *
 * Test the post-adjustment Zipf, which is what `rarityFor` returns: a sentinel
 * word with a more-common base form is raised above MIN_ZIPF by `adjustedZipf`
 * and scores on real data, so it is not a stand-in.
 */
export function isUnattestedZipf(zipf: number): boolean {
  return zipf === MIN_ZIPF;
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
  const zipf = adjustedZipf(normalized, scoring.zipfAt(i), scoring, date);
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
 * the word scored on its own data. Mirrors adjustedZipf in both rule and order:
 * under the chained system, the most common link of the fold chain, reported only
 * when it beat the word's own frequency; under the older systems, a reviewed
 * override first, then a tense base used outright, then a transparent/bound base
 * only when it's more common than the word.
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

  // Under the chained system every fold is a cap, so a substitution happened
  // only where the chain actually beat the word's own frequency. The base
  // reported is the link the score came from -- "materialnesses" reports
  // "material", not the intermediate "materialness" it merely passed through.
  if (scoring.chainedBaseForms) {
    const chained = mostCommonFold(normalized, scoring, date);
    if (chained && chained.zipf > ownZipf) {
      return { word: normalized, base: chained.base, ownZipf, baseZipf: chained.zipf };
    }
    return undefined;
  }

  const override = overrideBase(normalized, date);
  if (override) {
    return { word: normalized, base: override, ownZipf, baseZipf: zipfFor(override, scoring) };
  }

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
 *
 * Skips the reviewed rejections: this word is shown to the player as the drop's
 * ceiling (see DropDisplay), so it has to be one they could actually have
 * submitted. A rejected word is still in WORDS, which is exactly why the check
 * is needed here and not just in submit.
 */
export function bestWordForDrop(drop: string, date?: string): AcceptedWord | undefined {
  const needle = drop.toLowerCase();
  let best: AcceptedWord | undefined;
  for (let i = 0; i < WORDS.length; i++) {
    if (!WORDS[i].includes(needle)) continue;
    if (curatedRejection(WORDS[i], date) !== undefined) continue;
    const info = rarityFor(WORDS[i], date)!;
    if (!best || info.zipf < best.zipf) {
      best = { word: WORDS[i], ...info };
    }
  }
  return best;
}

/**
 * A playable answer for `drop` that `word` is only a letter or two away from, or
 * undefined when the guess isn't close to anything -- the signal behind the
 * "check your spelling" nudge (see game/nearMiss.ts for the rule).
 *
 * Candidates are held to the same bar as a real submission: they contain the
 * drop, they aren't the drop itself, and they aren't one of the reviewed
 * rejections. `excluded` lets the caller drop the rest -- words this puzzle has
 * already taken -- so the nudge never points at a word that couldn't be played.
 *
 * The cheap tests run first so the edit-distance comparison, and then the
 * caller's predicate, only see the few words that get that far.
 */
export function nearMissForDrop(
  word: string,
  drop: string,
  date?: string,
  excluded?: (candidate: string) => boolean
): string | undefined {
  const budget = nearMissEditBudget(word);
  if (budget === 0) return undefined;
  const needle = drop.toLowerCase();
  for (let i = 0; i < WORDS.length; i++) {
    const candidate = WORDS[i];
    if (Math.abs(candidate.length - word.length) > budget) continue;
    if (candidate === word || candidate === needle) continue;
    if (!candidate.includes(needle)) continue;
    if (!withinEditDistance(word, candidate, budget)) continue;
    if (curatedRejection(candidate, date) !== undefined) continue;
    if (excluded?.(candidate)) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Frequency data can undercount familiar derived forms such as "alertly"
 * even when their base words are common. Tense inflections inherit their
 * base word's frequency outright; other transparent suffixes are capped at
 * the base frequency so they cannot turn an everyday word into a top-tier
 * answer.
 */
function adjustedZipf(word: string, zipf: number, scoring: Scoring, date?: string): number {
  // The latest system resolves the whole fold chain and caps against every link,
  // so no rule can leave a word rarer than its own measurement.
  if (scoring.chainedBaseForms) {
    const chained = mostCommonFold(word, scoring, date);
    return chained ? Math.max(zipf, chained.zipf) : zipf;
  }

  // A reviewed override outranks every spelling rule below it: it is a decision
  // about this exact word, not a guess from its ending. Capped rather than
  // inherited outright, like the transparent suffixes -- the override says "no
  // rarer than its base", so a later data refresh that measures the word as
  // *more* common than its base is still free to score it on its own frequency.
  const override = overrideBase(word, date);
  if (override) return Math.max(zipf, zipfFor(override, scoring));

  const tenseBase = tenseBaseForm(word, scoring);
  if (tenseBase) return zipfFor(tenseBase, scoring);

  const base = scoringBaseForm(word, scoring.boundBaseForms);
  if (!base) return zipf;
  return Math.max(zipf, zipfFor(base, scoring));
}

/** A base reached by folding, and the Zipf it lends the word that folded onto it. */
interface ChainedBase {
  base: string;
  zipf: number;
}

// A single-spelling fold chain runs at most four links in the current dictionary
// ("notednesses" -> "notedness" -> "noted" -> "not"). Once every plausible
// spelling is a candidate the search fans out instead of walking a line, so the
// budget counts *words visited*, not chain length. Both are backstops against a
// future dictionary, not tuned limits; the widest closure in the shipped data is
// well inside the larger one.
const MAX_FOLD_DEPTH = 8;
const MAX_FOLD_NODES = 64;

/**
 * The most common word reachable from `word` by folding, or undefined if nothing
 * folds: a breadth-first search over the fold graph, where each edge is a base
 * `foldCandidates` offers. "materialnesses" -> "materialness" -> "material".
 *
 * Reading the *raw* Zipf of one hop is what left "materialnesses" at Legend --
 * "materialness" is itself an unattested word the engine had already re-scored as
 * "material" (4.95), so folding onto its raw 0.65 inherited a number the engine
 * had discarded. Searching the closure uses the score the base actually displays.
 *
 * The winner is the most common word reached, not the deepest or the nearest: the
 * caller caps against it, so folding can only ever make a word more common. That
 * monotonicity does two jobs. It keeps a hop like "abashed" -> "abash" (whose
 * base is rarer) from dragging a derived form *down* into the top ranks. And
 * because a wider candidate set can only reach *more* words, it is what makes the
 * 2026-08-21 widening safe to ship: no word can come out of it rarer than it went
 * in, whatever spelling rule fires (`scoring.test.ts` pins that over the whole
 * dictionary).
 *
 * `visited` breaks cycles -- two words can fold onto each other ("axes" -> "axis"
 * -> "axes"). It is shared across the whole search rather than per path, which is
 * both correct (the maximum over a set does not depend on the order it is
 * reached) and what keeps a branching search linear in the words it visits.
 */
function mostCommonFold(word: string, scoring: Scoring, date?: string): ChainedBase | undefined {
  const budget = scoring.inflectionFolds ? MAX_FOLD_NODES : MAX_FOLD_DEPTH;
  const visited = new Set([word]);
  const queue: string[] = [word];
  let best: ChainedBase | undefined;

  while (queue.length > 0) {
    if (visited.size >= budget) break;
    const current = queue.shift()!;
    for (const candidate of foldCandidates(current, scoring, date)) {
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      const zipf = zipfFor(candidate, scoring);
      if (!best || zipf > best.zipf) best = { base: candidate, zipf };
      queue.push(candidate);
    }
  }
  return best;
}

/**
 * Every base `word` could fold onto: a reviewed override, a tense inflection, a
 * transparent or bound suffix, and -- from 2026-08-21 -- every plausible spelling
 * of an inflectional or degree base. Under the chained system each of these is a
 * cap rather than an inheritance, so the caller can treat them alike and simply
 * take the most common.
 *
 * Before 2026-08-21 this returned the *first* rule to match, and each rule
 * returned the one spelling its stemmer produced. Both narrowings dropped real
 * bases on the floor: `baseForm`'s "-es" branch turns "asphyxiates" into
 * "asphyxiat", so the word never reached "asphyxiate" and scored 9.77 Mythic
 * against its base's 8.75. Offering the union and letting the search pick the
 * most common word it can reach is the fix, and it is strictly safer than
 * choosing between rules by precedence: a cap against the best of several bases
 * is never rarer than a cap against any one of them.
 *
 * A word on the reviewed exemption list contributes nothing, which stops it
 * folding *and* stops a chain passing through it.
 */
function foldCandidates(word: string, scoring: Scoring, date?: string): string[] {
  if (scoring.inflectionFolds && foldExempt(word, date)) return [];

  const override = overrideBase(word, date);
  const tense = tenseBaseForm(word, scoring);
  const suffix = scoringBaseForm(word, scoring.boundBaseForms);

  if (!scoring.inflectionFolds) {
    // The pre-2026-08-21 precedence, preserved exactly: first rule to match wins,
    // and the search degenerates to walking a single chain.
    const single = override ?? tense ?? suffix;
    return single === undefined ? [] : [single];
  }

  const out: string[] = [];
  const add = (base: string | undefined) => {
    if (base !== undefined && base !== word && !out.includes(base) && WORD_INDEX.has(base)) {
      out.push(base);
    }
  };
  add(override);
  add(tense);
  add(suffix);
  for (const candidate of inflectionBaseCandidates(word)) add(candidate);
  // Degree rules apply at every node, not just the submitted word. Confining them
  // to the submitted word looks tempting -- a comparative does not pluralize, so
  // "secreters" -> "secreter" -> "secret" reads an "-er" that only exists because
  // a plural was stripped. But it breaks the fairness property outright: with the
  // degree hop unavailable from an intermediate, "bustiers" caps against
  // "bustier"'s raw frequency while "bustier" itself displays its fold onto
  // "busty", and the plural ends up scoring rarer than its own singular. Twenty
  // words did exactly that. A word reached by folding gets the same rules as the
  // word submitted.
  for (const candidate of degreeBaseCandidates(word, plainDegreesAllowed(word, scoring))) {
    if (gradableFold(word, candidate)) add(candidate);
  }
  return out;
}

/**
 * Whether bare "-er"/"-est" may be read as a degree suffix on `word`.
 *
 * It may not, in general: that spelling is also how English builds agent nouns
 * and a pile of unrelated words, and nothing about the letters separates
 * "evenest" from "digest", or "chiefer" from "privateer". So the rule is confined
 * to words below wordfreq's measurement floor -- words no corpus can really put a
 * number on, whose score is the deep-tail stand-in rather than a measurement.
 * There, reading the ending costs nothing: the alternative is not a measured
 * score, it is a 9.9+ Legend handed to a word for being "special" plus "-est".
 * Every word with a real frequency keeps it, which is what leaves "privateer",
 * "shoulder", "speaker", "modest" and "digest" exactly where they were.
 *
 * The "-ier"/"-iest" spellings need no such gate -- they rewrite a "-y" adjective
 * and are checked against `gradableFold` like everything else.
 */
function plainDegreesAllowed(word: string, scoring: Scoring): boolean {
  const index = WORD_INDEX.get(word);
  // A word absent from the curated list was validated live and carries no
  // positional frequency entry, so there is nothing to call unmeasurable.
  if (index === undefined) return false;
  return scoring.zipfAt(index) < MEASURED_FLOOR;
}

/**
 * Whether `word` may be read as a degree form of `base`: the dictionary also has
 * the other degree, spelled the way `word` spells this one. This is the guard
 * that keeps the degree rules off agent nouns -- "supply" has no "suppliest", so
 * "supplier" is not "more supply" and keeps its own score; "happy" has both, so
 * "happier" folds.
 */
function gradableFold(word: string, base: string): boolean {
  const counterpart = degreeCounterpart(word, base);
  return counterpart !== undefined && WORD_INDEX.has(counterpart);
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
 * (-ing) verb forms: "rated" scores as "rate", and "making" scores as "make".
 *
 * Systems before CHAINED_BASE_START used this base's frequency *exactly*, which
 * cut both ways: where the base was rarer than the word, the inheritance made
 * the word rarer than anything had measured it, and "beloved" (4.17) scored as
 * "belove" (1.10) -- a Mythic. The chained system caps against it instead, so
 * these can only ever pull a word toward common.
 */
function tenseBaseForm(word: string, scoring: Scoring): string | undefined {
  const candidates: string[] = [];

  // Five-letter forms ("tried", "cried", "dried") are -ied words too. The older
  // systems required six, which dropped them into the generic -ed branch below
  // and scored "tried" as "tri"; the chained system counts them properly.
  const iedMin = scoring.chainedBaseForms ? 4 : 5;
  if (word.length > iedMin && word.endsWith("ied")) {
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
  "Elusive",
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
/**
 * Whether `date`'s puzzle uses the retuned tiers -- the Elusive rank, the retired
 * Quotidian, and the black-topped palette that came with them. Archived puzzles
 * keep the tiers and colors they were played with, so anything that renders a
 * rank has to ask. An omitted date means the newest system.
 */
export function usesRetunedTiers(date?: string): boolean {
  return date === undefined || date >= NARROW_BANDS_START;
}

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
