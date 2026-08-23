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
  inflectionalBaseCandidates,
  prefixBaseCandidates,
  unmeasuredBaseCandidates,
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

 *   - on/after 2026-08-19: base forms are resolved through their own bases (the
 *     fold chain) instead of one hop, and every fold caps rather than inherits.
 *   - on/after 2026-08-21 (the latest system): two independent changes that
 *     happened to ship the same day.
 *       * Labels: the measured Zipf bands retuned -- Elusive added between
 *         Extremely Rare and Mythic, Quotidian folded into Very Common (see
 *         measuredRarity). No score moves.
 *       * Scores: a fold consults every plausible base spelling at once rather
 *         than the one `baseForm` commits to, so a plural or third-person form
 *         can no longer out-score the word it came from (see
 *         `inflectionalBaseCandidates`). Suffixes whose spelling is not decisive
 *         -- comparatives, Latin plurals, -ize/-able -- fold too, but only for a
 *         word below MEASURED_FLOOR, where its score is a stand-in rather than a
 *         measurement (see `unmeasuredBaseCandidates`). No label mapping moves.
 * The puzzle date selects the `Scoring` profile; callers that omit a date get
 * the newest system.
 */
const NEW_SCORING_START = "2026-08-15";
const WIDE_BAND_START = "2026-08-16";
const CHAINED_BASE_START = "2026-08-19";
const NARROW_BANDS_START = "2026-08-21";
// The base-form widening shipped on the same day as the retuned bands. Named
// separately, and derived rather than repeated, because they are separate
// concerns -- one changes which label a score wears, the other changes the score
// -- and either could move to its own date later without disturbing the other.
const INFLECTION_BASE_START = NARROW_BANDS_START;
// The transparent prefixes join the gated families (see prefixBaseCandidates).
// Its own date, so every archived puzzle keeps the scores it was played with.
const PREFIX_BASE_START = "2026-08-24";
// How common a word must be to serve as a prefix base. Set at the top of the
// deep tail rather than at MEASURED_FLOOR: the bound combining forms this keeps
// out ("lith", "crat", "pathy", "phyte") are all measured, just barely, and sit
// between Zipf 1.0 and 3.0 along with the handful of real bases the cutoff
// costs ("gild", "emote", "ripen", "allot" -- each worth under 3 points of
// demotion, against some forty wrong folds removed).
const PREFIX_BASE_MIN_ZIPF = 3;

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
 * Words a spelling rule cannot cap correctly, reviewed one at a time and pinned
 * to the base they should score as.
 *
 * Most entries are words that carry no measured frequency at all, where the
 * unattested sentinel hands out a perfect 10.00 / Legend. The sentinel is the
 * right score for a genuine find the corpora simply haven't caught up with
 * ("enshittification"). It is the wrong score for a mechanical derivation of an
 * ordinary word -- "iratest" is the unattested superlative of "irate" (Zipf
 * 2.78). The 2026-08-21 cutover folds superlatives like that one on its own, but
 * only below MEASURED_FLOOR, so anything the corpora *do* measure still needs a
 * reviewed entry here.
 *
 * The rest are measured words whose only reachable base is a coincidence:
 * "theses" is the plural of "thesis", but the spelling rules can only see
 * "these" (Zipf 6.04), which would score it as a function word. An override
 * replaces the guesses outright rather than joining them, so it is also the way
 * to *stop* a wrong fold, not only to add a missing one.
 *
 * Which gaps belong here and which belong in a rule is a question of whether the
 * spelling is decisive, and -- where it is not -- of whether the word has a real
 * measurement to protect. `inflectionalBaseCandidates` covers number inflection
 * outright, because a wrong candidate there loses to the right one on frequency.
 * `unmeasuredBaseCandidates` covers the comparatives and Latin plurals only below
 * MEASURED_FLOOR, where the score is a stand-in anyway. What is left for this
 * file is everything neither rule can reach: a measured word whose ending
 * misleads ("tempest" is not a form of "temp"), the plurals whose true singular
 * no rule can see ("whatsises" -> "whatsis", "abatises" -> "abatis"), and the
 * "-en" verbs, whose folds are right often enough to tempt and wrong often enough
 * to disqualify ("dudeen" -> "dude"). A word the rules misread that has no base
 * at all ("momser" is not a form of "mom") goes in fold-exemptions.json instead
 * -- see FOLD_EXEMPTIONS below.
 *
 * An earlier note in this spot argued no widening was affordable at all, on the
 * grounds that a blanket bare-`s` strip re-scored ~10,900 words and stripped
 * 2,189 of a perfect 10. The count was right and the conclusion was not: those
 * re-scores were the point, and once every fold became a cap
 * (CHAINED_BASE_START) a widening could only ever pull a word toward common.
 * Thirty-one of the entries below are "-es" plurals the rules now handle on their
 * own, and six more are "-er"/"-est" forms; they are harmless (an override just
 * reaches the same base first) but they are no longer load-bearing.
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

// -- Curated fold exemptions (src/data/fold-exemptions.json) -----------------
/** A hand-reviewed exemption: `word` does not fold at all from `since` on. */
interface FoldExemption {
  since: string;
  /** Review notes only -- nothing here reads it. */
  reason?: string;
}

/**
 * The one thing an override cannot say. `score-overrides.json` replaces the
 * spelling guesses with a reviewed base, so it can redirect a fold -- but every
 * entry still pins the word to *some* base, and a few words have none: `momser`
 * is a Yiddish loanword the bare -er strip reads as "more mom", and no entry in
 * the override file can mean "score this word on its own data". A word listed
 * here contributes no fold candidates, which both stops it folding and stops a
 * chain passing *through* it -- the second half matters, because a bad fold
 * usually reaches a plausible word via a junk intermediate, and because it lets
 * one entry cover a paradigm (`rightsize` carries `rightsized`, `rightsizes`
 * and `rightsizing`, which can only reach the gated strips through their verb).
 *
 * Dated like the overrides, so an exemption applies from the puzzle it was
 * reviewed for onward. Deliberately short: a rule that needs many entries here
 * needs a tighter guard instead. A word must not appear in both files -- the
 * exemption would win, silently -- and a test pins that.
 */
const FOLD_EXEMPTIONS: ReadonlyMap<string, FoldExemption> = new Map(
  Object.entries(foldExemptionData as Record<string, FoldExemption>)
);

/**
 * Whether `word` may be read as a Latin plural at all.
 *
 * The "-a"/"-i"/"-ae" endings are ambiguous the way bare "-er" is: they are how
 * Latin pluralises, and also how English spells a pile of ordinary singulars.
 * The frequency gate is no help here -- "alba" (Zipf 3.33) is *more* common than
 * "curricula" and "formulae", so any threshold dropping the bad folds would drop
 * the good ones with them. What separates them is whether the word takes an
 * English plural of its own: a Latin plural has no "-s" form (no "podias", no
 * "memorandas"), so a word that has one is being used as an English singular
 * whatever its ending. "alba"/"albas" (the white garment) stays; "taxi"/"taxis"
 * stays; the metal-oxide family goes in one stroke, since materials science
 * pluralises them freely ("aluminas", "magnesias", "titanias"). The words this
 * deliberately gives up are the ones that genuinely are English singulars as
 * well as Latin plurals -- "stadia" (the surveying instrument, hence "stadias")
 * -- which keep their own scores rather than folding.
 */
function latinPluralsAllowed(word: string): boolean {
  return !WORD_INDEX.has(word + "s");
}

/** Whether `word`'s score is exempt from folding under `date`'s puzzle. */
function foldExempt(word: string, date?: string): boolean {
  const exemption = FOLD_EXEMPTIONS.get(word);
  if (!exemption) return false;
  return date === undefined || date >= exemption.since;
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
  // raw frequency -- see chainedBase. Also makes the tense rule cap instead of
  // inherit outright, and widens the -ied guard to reach five-letter forms.
  // Introduced with the 2026-08-19 cutover; off for earlier systems so past
  // puzzles' scores stay frozen (see CHAINED_BASE_START).
  chainedBaseForms: boolean;
  // Whether a fold considers every plausible base spelling rather than the one
  // `baseForm` commits to: the number inflections (plural / third-person
  // singular) unconditionally, an "-ied" past tense's plain "-ed" bases, and --
  // only for a word below MEASURED_FLOOR, where its score is a stand-in rather
  // than a measurement -- the comparatives and Latin plurals in
  // `unmeasuredBaseCandidates`. Introduced with the 2026-08-21 cutover; off for
  // earlier systems so past puzzles' scores stay frozen (see
  // INFLECTION_BASE_START).
  inflectionBases: boolean;
  // Whether a below-floor word may be stripped of a transparent prefix to reach
  // the word it was built on ("outwill" -> "will"). Introduced with the
  // 2026-08-24 cutover; off for earlier systems so past puzzles' scores stay
  // frozen (see PREFIX_BASE_START).
  prefixBases: boolean;
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
  inflectionBases = false,
  prefixBases = false,
  // Whether the retuned measured Zipf bands apply -- see measuredRarity. Labels
  // only; no score moves. Off for earlier systems so archived puzzles keep the
  // labels they were played with (see NARROW_BANDS_START).
  narrowBands = false
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
    inflectionBases,
    prefixBases,
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
// The latest system (2026-08-21). Carries both of that day's changes: the
// retuned measured Zipf bands (labels), and a fold that weighs every plausible
// base spelling and keeps the most common one (scores). The flags are commented
// because seven positional arguments, three of them trailing booleans, are
// otherwise unreadable.
const RETUNED_SCORING: Scoring = twoBandScoring(
  9.9,
  0,
  /* boundBaseForms */ true,
  /* legend */ true,
  /* chainedBaseForms */ true,
  /* inflectionBases */ true,
  /* prefixBases */ false,
  /* narrowBands */ true
);
// The latest system (2026-08-24): RETUNED_SCORING plus the transparent prefixes
// in the gated family (see prefixBaseCandidates in stem.ts).
const PREFIX_SCORING: Scoring = twoBandScoring(
  9.9,
  0,
  /* boundBaseForms */ true,
  /* legend */ true,
  /* chainedBaseForms */ true,
  /* inflectionBases */ true,
  /* prefixBases */ true,
  /* narrowBands */ true
);

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
  inflectionBases: false,
  prefixBases: false,
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
  if (date === undefined) return PREFIX_SCORING; // newest system
  if (date < NEW_SCORING_START) return LEGACY_SCORING;
  if (date < WIDE_BAND_START) return CURRENT_SCORING;
  if (date < CHAINED_BASE_START) return WIDE_SCORING;
  // The two names below it are the same date. This rung picks a *scoring*
  // profile, so it reads the scoring one; `usesRetunedTiers` asks the label
  // question and reads NARROW_BANDS_START. The profile beyond carries both.
  if (date < INFLECTION_BASE_START) return CHAINED_SCORING;
  if (date < PREFIX_BASE_START) return RETUNED_SCORING;
  return PREFIX_SCORING;
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
    const chained = chainedBase(normalized, scoring, date);
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

  const base = scoringBaseForm(normalized, scoring);
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
    const chained = chainedBase(word, scoring, date);
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

  const base = scoringBaseForm(word, scoring);
  if (!base) return zipf;
  return Math.max(zipf, zipfFor(base, scoring));
}

/** A base reached by folding, and the Zipf it lends the word that folded onto it. */
interface ChainedBase {
  base: string;
  zipf: number;
}

// A fold chain runs at most four links in the current dictionary
// ("notednesses" -> "notedness" -> "noted" -> "not"). The cap is a backstop
// against a future dictionary growing a longer one, not a tuned limit.
const MAX_FOLD_DEPTH = 8;

/**
 * The most common word reachable from `word` by folding, or undefined if nothing
 * folds. Each link is a hop `nextBaseForms` offers, applied again to whatever it
 * lands on: "materialnesses" -> "materialness" -> "material".
 *
 * Reading the *raw* Zipf of one hop is what left "materialnesses" at Legend --
 * "materialness" is itself an unattested word the engine had already re-scored as
 * "material" (4.95), so folding onto its raw 0.65 inherited a number the engine
 * had discarded. Walking the chain uses the score the base actually displays.
 *
 * The winner is the most common word reached, not the deepest: the caller caps
 * against it, so a chain can only ever make a word more common. That monotonicity
 * is what keeps a hop like "abashed" -> "abash" (whose base is rarer) from
 * dragging a derived form *down* into the top ranks.
 *
 * Every branch is explored, not just the most common first hop. Committing to one
 * hop can prune the path the chain actually needed: "cleanses" offers both
 * "cleanse" (the more common hop, which folds no further) and "cleans" (which
 * carries on to "clean", more common than either). Taking the most common hop
 * would have stopped at "cleanse" and scored "cleanses" *rarer* than the older
 * system did -- a fold that raises a score, which the cap exists to prevent.
 *
 * `seen` breaks cycles: two words can fold onto each other ("axes" -> "axis" ->
 * "axes"), and no word is visited twice. Revisiting could not raise the maximum
 * anyway, so one shared set across the whole walk is enough.
 */
function chainedBase(word: string, scoring: Scoring, date?: string): ChainedBase | undefined {
  const seen = new Set([word]);
  let frontier = [word];
  let best: ChainedBase | undefined;

  for (let depth = 0; depth < MAX_FOLD_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const candidate of nextBaseForms(current, scoring, date)) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        next.push(candidate);
        const zipf = zipfFor(candidate, scoring);
        if (!best || zipf > best.zipf) best = { base: candidate, zipf };
      }
    }
    frontier = next;
  }
  return best;
}

/**
 * Every base `word` could fold onto in one hop, in the same precedence the
 * single-hop path uses -- a reviewed override first, then a tense inflection,
 * then a transparent or bound suffix. Under the chained system every one of these
 * is a cap rather than an inheritance, so the caller can treat them alike.
 *
 * A reviewed override replaces the guesses rather than joining them: it is a
 * decision about this exact word, so the spelling rules are not consulted at all.
 *
 * Before INFLECTION_BASE_START this returned one base -- the first rule that
 * matched, each rule having already narrowed to its own most common candidate.
 * The latest system returns the whole set instead and lets `chainedBase` explore
 * it, because "which base is most common" and "which base leads to the most
 * common word" are different questions (see `chainedBase`). The set is a superset
 * of the older systems' single pick, and the caller only ever takes a maximum
 * over it, so widening it can never make a word score rarer than it used to.
 */
function nextBaseForms(word: string, scoring: Scoring, date?: string): string[] {
  // A reviewed exemption silences every rule below, the override included --
  // the two files must never share a word (pinned by a test).
  if (scoring.inflectionBases && foldExempt(word, date)) return [];

  const override = overrideBase(word, date);
  if (override) return [override];

  if (!scoring.inflectionBases) {
    const single = tenseBaseForm(word, scoring) ?? scoringBaseForm(word, scoring);
    return single ? [single] : [];
  }

  const out: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate || candidate === word) return;
    if (!WORD_INDEX.has(candidate) || out.includes(candidate)) return;
    out.push(candidate);
  };
  add(tenseBaseForm(word, scoring));
  add(baseForm(word));
  for (const candidate of inflectionalBaseCandidates(word, latinPluralsAllowed(word))) {
    add(candidate);
  }
  // "-ier"/"-iest" comparatives, ungated: unlike bare "-er"/"-est" below, the
  // "-y" rewrite is checkable, and the check is the base's *other* degree.
  // "happy" has "happiest", so "happier" folds onto it even though both carry
  // real measurements; "copy" has no "copiest", so "copier" -- an agent noun --
  // keeps its own score. Running above the floor is the point: every measured
  // comparative ("angrier", "earliest", "prettiest") scored rarer than its own
  // adjective while the only degree rules lived behind the gate.
  for (const { base, counterpart } of degreeBaseCandidates(word)) {
    if (WORD_INDEX.has(counterpart)) add(base);
  }
  // Suffixes whose spelling is not decisive, admitted only where the word's own
  // frequency is a stand-in rather than a measurement. Below MEASURED_FLOOR the
  // score comes from the deep-tail band -- for an unattested word, from the
  // sentinel outright -- so a plausible base is better information than what the
  // word would otherwise get. At or above the floor there is a real measurement,
  // and a guess from an ending must not overrule it: that line is the whole
  // reason "specialest" can fold to "special" while "tempest" keeps its own
  // score. See `unmeasuredBaseCandidates` for the families and the words that
  // would break without the gate.
  if (WORD_INDEX.has(word) && zipfFor(word, scoring) < MEASURED_FLOOR) {
    // A tensed "-ize"/"-ise" form is deliberately absent from this set: it
    // folds through its own verb -- already a candidate via the tense and
    // number rules above -- so the gate is applied *at the verb*, once per
    // paradigm. That is what keeps "womanizes" from reaching "woman" through
    // a strip its own measured verb is barred from (it displayed 6 points
    // more common than the word it conjugates), and what stops the -is noun
    // plurals being read as verb tenses ("whatsises" reached "what";
    // "appendicitises" now folds to "appendicitis" like any other plural).
    for (const candidate of unmeasuredBaseCandidates(word)) add(candidate);
    // Prefixes, under the same gate and for the same reason. Suffix rules alone
    // leave a prefixed word dead-ended on an unattested prefixed stem
    // ("overpeopling" -> "overpeople") when its attested root was one strip
    // further ("people"). See `prefixBaseCandidates` for why the gate is
    // load-bearing.
    if (scoring.prefixBases) {
      // A prefix base must be a word people actually use. Unlike the suffix
      // families, stripping a prefix routinely lands on a *bound combining
      // form* that a 225k-word dictionary happens to list as an entry --
      // "neolith" -> "lith", "monocrat" -> "crat", "autophyte" -> "phyte",
      // "protopathy" -> "pathy", "prelect" -> "lect", "subduce" -> "duce".
      // Every one is a real dictionary word and none is a base anything was
      // built on. They cluster in the deep tail, which is what separates them:
      // a transparent prefix attaches to an ordinary word, so a residue nobody
      // uses is far likelier to be a fragment than a base. Declining them costs
      // almost nothing either way -- the point of the fold is to replace an
      // unmeasured stand-in with a real measurement, and a base this rare
      // barely supplies one. Same argument as the three-letter minimum in
      // `inflectionalBaseCandidates`, one level up: some dictionary entries are
      // not words a fold should ever land on.
      for (const candidate of prefixBaseCandidates(word)) {
        if (WORD_INDEX.has(candidate) && zipfFor(candidate, scoring) >= PREFIX_BASE_MIN_ZIPF) {
          add(candidate);
        }
      }
    }
  }
  add(scoringBaseForm(word, scoring));
  return out;
}

/**
 * The base a suffix rule alone would pick: the inflectional stemmer first, then
 * the transparent "-ness"/"-ly" suffixes, then the bound derivational ones.
 *
 * From INFLECTION_BASE_START this is only one of the candidates `nextBaseForms`
 * collects rather than the whole answer -- `nextBaseForms` owns the wider set,
 * so that "which spellings are plausible" lives in exactly one place.
 */
function scoringBaseForm(word: string, scoring: Scoring): string | undefined {
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
  if (scoring.boundBaseForms) {
    const bound = boundBaseCandidates(word).find((candidate) => WORD_INDEX.has(candidate));
    if (bound) return bound;
  }
  return undefined;
}

/**
 * The most common dictionary word among `candidates`, skipping `word` itself and
 * any candidate the dictionary doesn't attest. Undefined when none qualifies.
 *
 * Preferring the most common base is what keeps a rare homograph of a candidate
 * spelling from hijacking the fold: "played" scores as "play" (5.6), not the
 * obscure "playe"; "rated" still scores as "rate" (5.1), not "rat"; and "caves"
 * picks "cave" (4.20) over the coincidental "cafe" (4.09). It is also the safe
 * direction under the chained system, where every fold is a cap -- a more common
 * base can only pull a word further toward common, never make it rarer.
 */
function mostCommonBase(
  candidates: readonly string[],
  word: string,
  scoring: Scoring
): string | undefined {
  let base: string | undefined;
  let baseZipf = -Infinity;
  for (const candidate of candidates) {
    if (candidate === word || !WORD_INDEX.has(candidate)) continue;
    const zipf = zipfFor(candidate, scoring);
    if (zipf > baseZipf) {
      base = candidate;
      baseZipf = zipf;
    }
  }
  return base;
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
  const ied = word.length > iedMin && word.endsWith("ied");
  if (ied) candidates.push(`${word.slice(0, -3)}y`);
  // Before INFLECTION_BASE_START the "-ied" rule *replaced* the "-ed" one, so an
  // "-ied" word whose base ends in "i" had nowhere to land: "taxied" tried only
  // the non-word "taxy" and never reached "taxi", leaving it to score on its own
  // frequency (8.47, against "taxi"'s 5.21). Same for "bikinied", "safaried" and
  // "shanghaied". Adding the "-ed" bases instead of substituting for them costs
  // nothing where the "-y" spelling is right -- the most common base still wins.
  if ((!ied || scoring.inflectionBases) && word.length > 4 && word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  if (word.length > 4 && word.endsWith("ying")) {
    candidates.push(`${word.slice(0, -4)}y`, `${word.slice(0, -4)}ie`);
  } else if (word.length > 5 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    candidates.push(`${stem}e`, stem, stripDoubledConsonant(stem));
  }

  return mostCommonBase(candidates, word, scoring);
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
