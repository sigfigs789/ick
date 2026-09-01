import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import legacyRarityData from "../data/rarity-legacy.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
import boundResidueData from "../data/bound-residues.json";
import measurementUnitData from "../data/measurement-units.json";
import wordRejectionData from "../data/word-rejections.json";
import sameRootPinData from "../data/same-root-pins.json";
import derivedRejectionData from "../data/derived-rejections.json";
import {
  baseForm,
  boundBaseCandidates,
  degreeBaseCandidates,
  derivedFormCandidates,
  derivedBaseCandidates,
  inflectedFormCandidates,
  inflectionalBaseCandidates,
  measurementBaseCandidates,
  prefixBaseCandidates,
  superlativeBaseCandidates,
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
 *   - on/after 2026-08-24: two independent changes, like 2026-08-21 before it.
 *       * The derivational families whose ending is *bound* fold as well --
 *         "-ically" -> "-ic", "-ably"/"-ibly" -> "-able"/"-ible", "-ologist" ->
 *         "-ology", "-cked"/"-cking" -> "-c", "-eaux" -> "-eau" (see
 *         `derivedBaseCandidates`). Ungated by MEASURED_FLOOR, like the bound
 *         suffixes of 2026-08-16: nothing accidental ends that way, so there is
 *         no coincidence for a gate to catch. 2,003 words score lower and none
 *         score higher; 1,024 of them were holding a Mythic-or-better score for
 *         an ending, 692 a Legend.
 *       * The fold runs in both directions. Until now it only ever asked "what
 *         is this word a form of", so a word was capped by its base and never by
 *         the forms built on it -- which left the lemma of a participle-dominant
 *         verb scoring as a deep-tail find because nobody writes it in the bare
 *         form ("belove" 9.75 against "beloved" 5.24, "infatuate" 9.46 against
 *         "infatuated" 7.11). A word is now also capped at its own regular
 *         inflections (see `inflectedFormFolds`).
 *     Neither moves a label mapping.
 *   - on/after 2026-08-26: three changes replacing the fold's remaining
 *     frequency guesses with reviewed morphology (see REVIEWED_FOLD_START). No
 *     label mapping moves.
 *   - on/after 2026-08-27: the measured band bends by
 *     SCORE_GAMMA, and its labels key off the shown score's whole point instead
 *     of off Zipf cutoffs (see DECADE_BANDS_START). The first change moves every
 *     measured score up; the second is the only label mapping to move since
 *     2026-08-21.
 *   - on/after 2026-09-02 (the latest system): two independent folds, one
 *     cutover each, in the pattern of 2026-08-24.
 *       * The bare "-est" superlative folds onto its adjective wherever the
 *         "-er" comparative of the same spelling is a word, rather than only
 *         below MEASURED_FLOOR (see SUPERLATIVE_BASE_START).
 *       * A measurement modifier is scored as the unit it counts --
 *         "kilojoules" as `joules`, "gibibyte" as `bytes`. Ungated by
 *         MEASURED_FLOOR on the strength of a reviewed unit table; 302 words
 *         score lower and none higher, 47 of them holding a Legend for a
 *         multiplier (see MEASUREMENT_BASE_START).
 *     Neither moves a label mapping.
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
// The bound derivational families (-ically, -ably/-ibly, -ologist, the c -> ck
// orthography, -eaux) fold from this date. Its own cutover rather than a reuse
// of INFLECTION_BASE_START: those rules are already live in archived puzzles,
// and every score these move must stay frozen where it was played.
const DERIVED_BASE_START = "2026-08-24";
// The transparent prefixes join the gated families (see prefixBaseCandidates).
// Shares 2026-08-24 with DERIVED_BASE_START -- one cutover carrying two
// independent changes -- but kept as its own name so either can move later
// without dragging the other.
//
// Nothing enforces that a cutover date is still in the future when it ships, and
// none of the six above are pinned by a test -- every test here hardcodes its
// own dates, so a stale constant leaves the suite green. That matters because a
// cutover reached in the past re-scores the puzzle in play: words already banked
// keep the scores stored with them (see storage.ts, which persists zipf/rarity at
// submit time), while anything submitted after the deploy is scored under the new
// system, so one session on one puzzle shows a prefixed word at 10.00 and its
// neighbour at 1.88. Set the date to the day after the change is expected to
// land, and if it slips past that date, move it before merging.
const PREFIX_BASE_START = "2026-08-24";
// How common a word had to be to serve as a prefix base, before the reviewed
// residue table replaced the question (see REVIEWED_FOLD_START and
// `boundPrefixResidue`). Frozen for the 2026-08-24 puzzles that were played on
// it; nothing from REVIEWED_FOLD_START on reads it.
const PREFIX_BASE_MIN_ZIPF = 3;

/*
 * 2026-08-26. Three changes, one cutover, because they ship together and no
 * archived puzzle falls between them -- a date each would buy three rungs in
 * `scoringFor` that nothing can reach and three profiles differing from
 * LATEST_SCORING by a flag nothing selects. The *flags* stay separate, which is
 * what a later split actually needs: give one its own constant then, and add its
 * rung with it.
 *
 * What they have in common is what they remove. Each of the three was a place
 * the fold reached for a frequency number to answer a question frequency cannot
 * answer:
 *
 *   `paradigmFolds`     Which reading a form settles on, asked of candidates
 *                       that were never rival readings -- so a lemma and its own
 *                       participle stopped being one word the moment a forward
 *                       rule learned to climb past them.
 *   `prefixResidues`    Whether a residue is a word or a bound fragment, asked
 *                       as "is it commoner than Zipf 3". Not the same question:
 *                       "snob" (2.96) and "aural" (2.78) are ordinary words it
 *                       refused, and "dont" (4.74) is a fragment it admitted.
 *   `derivedFormFolds`  Which member of a family a score should come from, when
 *                       the noun is a technical rarity and the adjective built
 *                       on it is the word anyone writes ("neolith" 0.98 against
 *                       "neolithic" 2.99).
 *
 * All three replace the number with a reviewed answer -- a narrower question, a
 * vetted table, and a checkable derivation.
 */
const REVIEWED_FOLD_START = "2026-08-26";

/*
 * 2026-08-27. Two changes, one cutover, because neither is worth reading without
 * the other: a curve that lifts the measured band, and band boundaries that land
 * on whole points. Separate flags, one date -- the split rule is the one above.
 *
 *   `scoreCurve`    The measured band was a straight line from 0 at MAX_ZIPF to
 *                   the ceiling at MEASURED_FLOOR, which is a fine map of the
 *                   Zipf scale and a poor map of what anyone plays: the words
 *                   players actually reach for cluster around Zipf 3..5, the
 *                   flat middle of that line, so a typical find came back 7.2
 *                   and the top three points of the scale went almost unused.
 *                   Bending the line (score = ceiling * x^GAMMA, x the same
 *                   normalised distance from MAX_ZIPF) lifts that middle while
 *                   pinning both ends, so no score falls and none exceeds the
 *                   ceiling. Measured against the 990 answers played 2026-08-21
 *                   to 2026-08-26, the mean shown score goes 7.17 -> 7.39.
 *   `decadeBands`   The measured labels keyed off Zipf cutoffs chosen so their
 *                   *scores* would not straddle a shown tenth (2.13, 3.15, 1.59
 *                   ...), which kept every seam legal and left every seam
 *                   arbitrary: 8.9 gave no hint it was a tenth off the next rank
 *                   up, because the rank changed at 9.1. The bands now key off
 *                   the shown score's whole point -- Extremely Rare is 8.x, Rare
 *                   7.x, Uncommon 6.x, Common 5.x -- so the leading digit *is*
 *                   the rank and the distance to the next one is readable off
 *                   the score. Elusive keeps the half band above them (9.0..9.4,
 *                   Mythic taking 9.5), and Very Common takes everything under
 *                   5.0. A boundary on a whole point cannot land mid-tenth, so
 *                   the straddle that the Zipf cutoffs were shaped to avoid is
 *                   now impossible rather than merely avoided.
 *
 * Together they move labels up, never down -- every band floor lands at or above
 * where it sat before, so no word a player has already found comes back worse.
 * A test pins that.
 */
const DECADE_BANDS_START = "2026-08-27";
// How far the measured band bends. 1 is the straight line every system before
// DECADE_BANDS_START used; below 1 lifts the middle. 0.9 rather than something
// lower because the lift lands almost entirely on Extremely Rare, and purple
// being the default outcome is what the 2026-08-21 retune existed to fix: it
// goes 14% of answers to 19% here, where 0.8 would make it 24% and 0.7 31%.
//
// Lowering it later is a one-line change, but two tests move with it: the
// whole-point band edges, and the window where Common demotes to Very Common.
// That window is the thing to watch, because it is the only place this system
// takes a rank away -- it is Zipf 4.62..4.84 at 0.9, and 0.85 halves it (4.76 up)
// while adding 0.12 to the mean shown score. It closes entirely at 0.8.
const SCORE_GAMMA = 0.9;

/*
 * 2026-09-02. The bare "-est" superlative folds onto its adjective wherever the
 * "-er" comparative of the same spelling is a word, measured or not -- the
 * paired-degree check of `degreeBaseCandidates` applied to the spelling the
 * floor gate had been holding. See `superlativeBaseCandidates` for why "-est"
 * takes the check and bare "-er" cannot.
 *
 * The gap it closes is the one the "-ier"/"-iest" cutover left: a superlative a
 * corpus measures never reached the gated strip, so 307 of them scored rarer
 * than the ordinary word they are the top degree of, 81 of those at Mythic or
 * better ("beautifulest" 9.81, "perfectest" 9.85, "blindest" 9.85).
 */
const SUPERLATIVE_BASE_START = "2026-09-02";

/*
 * 2026-09-02, the second of that day's two changes. A word carrying a
 * measurement modifier -- an SI decimal prefix or its binary counterpart -- is
 * scored as the unit it is counting: "kilojoules" as `joules`, "megabytes" as
 * `bytes`, "zeptosecond" as `second`. A modified unit *is* the unit, so this is
 * the transparent-prefix argument ("codriver" is a driver) applied to the one
 * family where the residue can be checked rather than guessed at.
 *
 * Ungated by MEASURED_FLOOR, unlike `prefixBaseCandidates`, and the reviewed
 * unit table is what pays for that (see `measurementUnit`). The gate is what a
 * prefix family needs when its residue is drawn from the whole dictionary; a
 * residue drawn from a closed list of units is not that.
 *
 * 283 words fold and 272 score lower, none higher. What they were holding was
 * the compound nobody measures: "zeptoseconds" and "gigameter" at a flat 10.00
 * Legend, "exahertz" and "kilocoulomb" the same, 44 more at Mythic or better --
 * every one of them an ordinary unit with a multiplier bolted on. The change is
 * not confined to the deep tail, which is the point of running above the floor:
 * "kilojoules" was measured at Zipf 1.62 and scored 9.08 Elusive against 7.92
 * for the joules it counts, and "milliseconds" 7.37 against 4.60 for "seconds".
 */
const MEASUREMENT_BASE_START = "2026-09-02";

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
/** A hand-reviewed exemption: `word` does not fold from `since` on. */
interface FoldExemption {
  since: string;
  /**
   * Which reading the entry refuses. Absent means all of them -- the word folds
   * nowhere and no chain passes through it. `"prefix"` refuses only the
   * transparent-prefix hop, for the commonest shape in this file by far: a word
   * whose residue is a real word and whose *split* is wrong ("antiphonic" is
   * antiphon + -ic, not anti- + `phonic`).
   *
   * That distinction is worth a field because a blanket entry on one of those
   * takes the word's ordinary inflectional folds down with it, and they were
   * never in question. `transferals` is trans- + `ferals` only by accident, but
   * it really is the plural of `transferal`, and an entry that stopped both left
   * it scoring 0.32 above its own singular and a rank higher -- a plural
   * out-scoring its base, which is the one thing the fold exists to prevent.
   */
  scope?: "prefix";
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

/** Whether `word` is exempt from every fold under `date`'s puzzle. */
function foldExempt(word: string, date?: string): boolean {
  const exemption = exemptionFor(word, date);
  return exemption !== undefined && exemption.scope === undefined;
}

/** Whether `word` is exempt from the transparent-prefix hop specifically. */
function prefixFoldExempt(word: string, date?: string): boolean {
  return exemptionFor(word, date) !== undefined;
}

/** The exemption in force for `word` under `date`, whatever its scope. */
function exemptionFor(word: string, date?: string): FoldExemption | undefined {
  const exemption = FOLD_EXEMPTIONS.get(word);
  if (!exemption) return undefined;
  if (date !== undefined && date < exemption.since) return undefined;
  return exemption;
}

// -- Bound prefix residues (src/data/bound-residues.json) --------------------
/** A hand-reviewed residue: not a word a prefix fold may land on, from `since`. */
interface BoundResidue {
  since: string;
  /** Review notes only -- nothing here reads it. */
  reason?: string;
}

/**
 * The residues a transparent prefix can be stripped down to that are not words:
 * bound combining forms a large dictionary lists as entries because they head
 * their own family of compounds, not because anyone writes them.
 *
 * This is the prefix half of what the bound *suffix* rules get for free. A
 * suffix family is safe when its ending is one English only ever produces by
 * attaching that suffix, and that is checkable from the string -- which is why
 * `derivedBaseCandidates` can fold "-ically" and "-ologist" with no gate at all.
 * A prefix has no such property, because the thing that has to be bound is not
 * the affix but the *residue*, and the residue is drawn from the whole
 * dictionary. So the closed list a suffix family gets from its ending, a prefix
 * family has to get from a table.
 *
 * Keyed on residues rather than words, which is what makes it a rule and not a
 * pile of exceptions: one entry for "lith" covers "neolith", "monolith",
 * "batholith", "otolith" and anything a later dictionary adds, where
 * fold-exemptions.json would need a line each. The two files divide cleanly --
 * a residue that is never a word belongs here, a *word* whose residue is a real
 * word but the wrong bracketing ("antiphonic" is antiphon + -ic, not anti- +
 * "phonic") belongs there, because nothing about "phonic" is wrong in general.
 *
 * Deny rather than allow, so a dictionary addition folds by default. That is the
 * generous direction on purpose: a missing entry costs one word a visible wrong
 * base, which review catches, while an allow-list would silently stop folding
 * every new word and nothing would report it.
 *
 * Dated like the exemptions and for the same reason: adding an entry *raises*
 * the scores of the words that folded through it, so an archived puzzle must not
 * see a residue reviewed after it was played.
 */
const BOUND_RESIDUES: ReadonlyMap<string, BoundResidue> = new Map(
  Object.entries(boundResidueData as Record<string, BoundResidue>)
);

/** Whether `residue` is a bound form rather than a word, under `date`'s puzzle. */
function boundPrefixResidue(residue: string, date?: string): boolean {
  const entry = BOUND_RESIDUES.get(residue);
  if (!entry) return false;
  return date === undefined || date >= entry.since;
}

// -- Measurement units (src/data/measurement-units.json) ---------------------
/** A hand-reviewed unit of measure: a spelling a modifier may fold onto, from `since`. */
interface MeasurementUnit {
  since: string;
  /** Review notes only -- nothing here reads it. */
  note?: string;
}

/**
 * The units a measurement modifier can be counting. "kilojoule" is a joule,
 * "megabytes" are bytes, a "zeptosecond" is a second -- so the unit is what the
 * modified word should be scored as, exactly as "codriver" is scored as a
 * driver.
 *
 * An *allow*-list, where the prefix families next door deny (see
 * `BOUND_RESIDUES`), and the direction is the whole design. A measurement
 * modifier is as transparent an affix as English has, but the letters it is
 * spelled with open a great many ordinary words -- "decadent", "decimate",
 * "examine", "hectoring", "petaline", "picoline", "teratoma" -- and stripping
 * the modifier off those lands on "dent", "mate", "mine", "ring", "line",
 * "line" and "toma", every one a real dictionary word. `prefixBaseCandidates`
 * survives that with the MEASURED_FLOOR gate: its own coincidences ("preface"
 * -> "face", "understand" -> "stand") are all ordinary words sitting far above
 * the floor, so the gate excludes them and asks nothing of the residue.
 *
 * This family cannot use that gate, because the words it exists for are
 * measured: "kilojoules" carries a real Zipf of 1.62 and "milliseconds" 2.88,
 * both well clear of the floor and both scoring rarer than the unit they count.
 * So the check moves to the residue instead, and asking "is this a unit" is a
 * question with a closed, reviewable answer in a way that "is this a base"
 * never was. It is also the strictly better check: it refuses "decadent" and
 * "megaphone" on the merits rather than on how common they happen to be, and it
 * is unmoved by a frequency refresh.
 *
 * Both spellings of a unit that has two ("meter"/"metre", "gram"/"gramme") and
 * the plurals, because the plural is a residue in its own right --
 * "kilojoules" strips to "joules", not to "joule". Listing them beats deriving
 * them: the "-es" strip that would turn "tones" into "ton" folded "microtones"
 * onto the mass unit, and a microtone is a musical interval.
 *
 * Three units are deliberately absent, each because the spelling it shares with
 * an ordinary word is the whole of what a corpus measures, so the fold would
 * hand a real unit the frequency of something else entirely. "are" (100 square
 * metres) is the verb, and folding "centiares" onto it took a Legend to 1.76.
 * "ares" goes with it: leaving the plural in was no help, since the chain walks
 * it straight to the singular. "base" is the base pair, a clipping rather than a
 * unit spelling of its own, and "kilobase" came back scored as `based`.
 *
 * The collisions that *are* admitted are the ones where the ordinary word and
 * the unit are the same word: a kilobar is a thousand bars of pressure, a
 * gigabit a billion bits, a millisecond a thousandth of a second. Those fold
 * onto a common word and score low for it, which is the rule working rather
 * than failing.
 *
 * Dated like the other reviewed tables, and here an entry *lowers* the scores of
 * everything folding through it, so an archived puzzle must not see a unit
 * reviewed after it was played.
 */
const MEASUREMENT_UNITS: ReadonlyMap<string, MeasurementUnit> = new Map(
  Object.entries(measurementUnitData as Record<string, MeasurementUnit>)
);

/** Whether `residue` is a reviewed unit of measure, under `date`'s puzzle. */
function measurementUnit(residue: string, date?: string): boolean {
  const entry = MEASUREMENT_UNITS.get(residue);
  if (!entry) return false;
  return date === undefined || date >= entry.since;
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
  // Whether the bound derivational families in `derivedBaseCandidates` fold --
  // "-ically" -> "-ic", "-ably"/"-ibly" -> "-able"/"-ible", "-ologist" ->
  // "-ology", "-cked"/"-cking" -> "-c", "-eaux" -> "-eau". Ungated by
  // MEASURED_FLOOR, like the bound suffixes in `boundBaseCandidates`: the
  // ending is what makes them safe, not the frequency. Introduced with the
  // 2026-08-24 cutover; off for earlier systems so past puzzles' scores stay
  // frozen (see DERIVED_BASE_START).
  derivedBases: boolean;
  // Whether a below-floor word may be stripped of a transparent prefix to reach
  // the word it was built on ("outwill" -> "will"). Introduced with the
  // 2026-08-24 cutover; off for earlier systems so past puzzles' scores stay
  // frozen (see PREFIX_BASE_START).
  prefixBases: boolean;
  // Whether a word is also capped at the regular inflections built *on* it --
  // the fold's reverse direction, so the bare lemma of a verb only ever written
  // as a participle stops scoring as a deep-tail find (see
  // `inflectedFormFolds`). Shipped with the same 2026-08-24 cutover as
  // `derivedBases`; off for earlier systems so past puzzles' scores stay frozen
  // (see DERIVED_BASE_START).
  inflectionForms: boolean;
  // Whether the reverse fold keeps a paradigm together. Three repairs to
  // `inflectedFormFolds`, one flag because they are one claim -- the members of
  // a paradigm settle on one base, and they all reach it. The round trip asks
  // its question of the form's *inflectional* readings alone; a confirmed form
  // is walked onward through the rungs above it rather than read at its raw
  // Zipf; and a form below MEASURED_FLOOR is no longer skipped for being rarer
  // than the word, since that is precisely where it can climb. 2026-08-26; see
  // REVIEWED_FOLD_START.
  paradigmFolds: boolean;
  // Whether a prefix base is decided by the reviewed residue table rather than
  // the flat Zipf-3 floor -- the difference between "is this residue common
  // enough" and "is this residue a word" (see `boundPrefixResidue`). 2026-08-26.
  prefixResidues: boolean;
  // Whether a word is also capped at the bound derivational forms built on it --
  // "neolith" at "neolithic", the reverse direction extended past the regular
  // inflections to the adjective that is the form anyone actually writes (see
  // `derivedFormFolds`). 2026-08-26.
  derivedFormFolds: boolean;
  // Whether a bare "-est" superlative folds onto its adjective on the strength
  // of the paired "-er" comparative, rather than only below MEASURED_FLOOR (see
  // `superlativeBaseCandidates`). 2026-09-02; off for earlier systems so past
  // puzzles' scores stay frozen (see SUPERLATIVE_BASE_START).
  superlativeBases: boolean;
  // Whether a measurement modifier folds onto the unit it counts ("kilojoules"
  // -> "joules"), ungated by MEASURED_FLOOR on the strength of the reviewed unit
  // table. 2026-09-02; off for earlier systems so past puzzles' scores stay
  // frozen (see MEASUREMENT_BASE_START).
  measurementBases: boolean;
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
/**
 * Flags selecting which dated behaviours a scoring profile carries. A named
 * object rather than trailing booleans: this list reached eight positional
 * parameters ending in five interchangeable `boolean`s, and three separate
 * changes adding a flag to it collided in a row -- each time producing code that
 * type-checked while feeding the wrong argument into the wrong slot, because
 * every value and every parameter had the same type. Adding a field here cannot
 * silently shift another.
 */
interface ScoringFlags {
  boundBaseForms: boolean;
  legend: boolean;
  chainedBaseForms?: boolean;
  inflectionBases?: boolean;
  derivedBases?: boolean;
  prefixBases?: boolean;
  inflectionForms?: boolean;
  paradigmFolds?: boolean;
  prefixResidues?: boolean;
  derivedFormFolds?: boolean;
  superlativeBases?: boolean;
  measurementBases?: boolean;
  // Whether the retuned measured Zipf bands apply -- see measuredRarity. Labels
  // only; no score moves. Off for earlier systems so archived puzzles keep the
  // labels they were played with (see NARROW_BANDS_START).
  narrowBands?: boolean;
  // Whether the measured band bends by SCORE_GAMMA rather than running straight.
  // Scores only; no label mapping moves with it. See DECADE_BANDS_START.
  scoreCurve?: boolean;
  // Whether the measured labels key off the shown score's whole point rather
  // than off Zipf cutoffs (see decadeRarity). Labels only. Supersedes
  // `narrowBands`, which stays set on these profiles for the archived puzzles
  // that read it. See DECADE_BANDS_START.
  decadeBands?: boolean;
}

function twoBandScoring(ceiling: number, tailFloor: number, flags: ScoringFlags): Scoring {
  const {
    boundBaseForms,
    legend,
    chainedBaseForms = false,
    inflectionBases = false,
    derivedBases = false,
    prefixBases = false,
    inflectionForms = false,
    paradigmFolds = false,
    prefixResidues = false,
    derivedFormFolds = false,
    superlativeBases = false,
    measurementBases = false,
    narrowBands = false,
    scoreCurve = false,
    decadeBands = false,
  } = flags;
  const score = (zipf: number): number => {
    if (zipf >= MEASURED_FLOOR) {
      // How far into the measured band the word sits: 0 at the commonest word in
      // the data, 1 at the measurement floor. `scoreCurve` bends it (see
      // SCORE_GAMMA); without it the band is the straight line it always was,
      // which is the same expression at gamma 1.
      const x = (MAX_ZIPF - zipf) / (MAX_ZIPF - MEASURED_FLOOR);
      // Floored at 0 before the exponent, because a Zipf above the data's
      // maximum makes x negative and a negative base under a fractional power is
      // NaN. No dictionary word is up there, but a live-validated word carries
      // whatever frequency Datamuse attests, and the straight line answered that
      // case with a small negative score rather than a broken one.
      const s = ceiling * (scoreCurve ? Math.pow(Math.max(x, 0), SCORE_GAMMA) : x);
      // The Legend system carries two decimals across the whole band so its
      // fixed rank cutoffs land on the shown value; the 2026-08-15 system kept
      // the measured band at one decimal.
      return legend ? roundToCents(s) : Math.round(s * 10) / 10;
    }
    const clamped = Math.max(zipf, tailFloor);
    const s =
      ceiling + ((10 - ceiling) * (MEASURED_FLOOR - clamped)) / (MEASURED_FLOOR - tailFloor);
    return legend ? roundToCents(Math.min(s, 10)) : Math.round(Math.min(s, 10) * 100) / 100;
  };
  return {
    zipfAt: (i) => zipfHundredths[i] / 100,
    score,
    rarity: legend
      ? // Latest system: rank the top by the shown two-decimal score against the
        // fixed Legend/Mythic cutoffs; below 9.5 takes a measured label -- off
        // the shown score's whole point from DECADE_BANDS_START, off the Zipf
        // bands before it.
        (zipf) =>
          topRankForScore(score(zipf)) ??
          (decadeBands ? decadeRarity(score(zipf)) : measuredRarity(zipf, narrowBands))
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
    derivedBases,
    prefixBases,
    inflectionForms,
    paradigmFolds,
    prefixResidues,
    derivedFormFolds,
    superlativeBases,
    measurementBases,
  };
}

// The 2026-08-15 system: measured band 0..9.5, deep tail 9.5..10 anchored at the
// data's live minimum, single Mythic top rank, no bound-suffix folding.
const CURRENT_SCORING: Scoring = twoBandScoring(9.5, MIN_ZIPF, {
  boundBaseForms: false,
  legend: false,
});
// The 2026-08-16 system: measured band 0..9.9, deep tail 9.9..10 clamped at a
// fixed 0, Legend + Mythic ranks, bound-suffix folding on, single-hop bases.
const WIDE_SCORING: Scoring = twoBandScoring(9.9, 0, { boundBaseForms: true, legend: true });
// The 2026-08-19 system: the same bands and ranks, with base forms resolved
// through their own bases.
const CHAINED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
});
// The 2026-08-21 system. Carries both of that day's changes: the retuned
// measured Zipf bands (labels), and a fold that weighs every plausible base
// spelling and keeps the most common one (scores). The flags are commented
// because seven positional arguments, three of them trailing booleans, are
// otherwise unreadable.
const RETUNED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  narrowBands: true,
});
// The 2026-08-24 system with the bound derivational families and the fold's
// second direction on, but not the prefixes. Reached only if PREFIX_BASE_START
// is ever moved later than DERIVED_BASE_START; while the two dates are equal,
// scoringFor steps straight past it to LATEST_SCORING.
const DERIVED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  narrowBands: true,
});
// The 2026-08-24 system: all three of that day's changes -- the bound
// derivational families in `derivedBaseCandidates`, the fold's second direction
// toward the inflections built on a word, and the transparent prefixes in
// `prefixBaseCandidates` -- with every prefix base gated on a flat Zipf-3 floor.
const PREFIX_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  narrowBands: true,
});
// The 2026-08-26 system: the three changes that replace the fold's remaining
// frequency guesses with reviewed morphology. See REVIEWED_FOLD_START.
const REVIEWED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  narrowBands: true,
});
// The 2026-08-27 system: the same folds, with the measured band bent by
// SCORE_GAMMA and its labels read off the shown score's whole point. See
// DECADE_BANDS_START. `narrowBands` stays on but is now unreachable here --
// `decadeBands` answers the label question ahead of it -- and is kept so the
// flag set still describes the profile rather than only its live edges.
const DECADE_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-02 system with the bare "-est" superlative folding onto its
// adjective wherever the "-er" comparative attests the reading, but not the
// measurement modifiers. Reached only if MEASUREMENT_BASE_START is ever moved
// later than SUPERLATIVE_BASE_START; while the two dates are equal, scoringFor
// steps straight past it to LATEST_SCORING -- the same ladder DERIVED_SCORING
// and PREFIX_SCORING form for 2026-08-24. See SUPERLATIVE_BASE_START.
const SUPERLATIVE_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The latest system (2026-09-02): both of that day's changes -- the bare "-est"
// superlative, and a measurement modifier scored as the unit it counts. See
// MEASUREMENT_BASE_START.
const LATEST_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});

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
  derivedBases: false,
  prefixBases: false,
  inflectionForms: false,
  paradigmFolds: false,
  prefixResidues: false,
  derivedFormFolds: false,
  superlativeBases: false,
  measurementBases: false,
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
 * was played with, Quotidian included. Neither is what a puzzle from
 * DECADE_BANDS_START on reads -- those label off the shown score (see
 * `decadeRarity`) and reach this only through the archived profiles.
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

/**
 * The measured labels from DECADE_BANDS_START on, read off the score the player
 * is shown rather than off the Zipf behind it: whatever whole point the score
 * displays in *is* the rank. So a word showing 8.7 is Extremely Rare and three
 * tenths off Elusive, and the player can see that without being told -- which is
 * the whole reason the bands moved.
 *
 * Elusive keeps a half band (9.0..9.4, Mythic starts at 9.5) because it is meant
 * to read as closing in on the top rather than as one more rung, and Very Common
 * takes the whole bottom half (under 5.0) because nothing below "this is an
 * everyday word" needs telling apart. The rounding is the display's own (see
 * `format`), so the label can never disagree with the number beside it.
 */
function decadeRarity(score: number): Rarity {
  const shown = roundToTenths(score);
  if (shown >= 9) return "Elusive";
  if (shown >= 8) return "Extremely Rare";
  if (shown >= 7) return "Rare";
  if (shown >= 6) return "Uncommon";
  if (shown >= 5) return "Common";
  return "Very Common";
}

function scoringFor(date?: string): Scoring {
  if (date === undefined) return LATEST_SCORING; // newest system
  if (date < NEW_SCORING_START) return LEGACY_SCORING;
  if (date < WIDE_BAND_START) return CURRENT_SCORING;
  if (date < CHAINED_BASE_START) return WIDE_SCORING;
  // The two names below it are the same date. This rung picks a *scoring*
  // profile, so it reads the scoring one; `usesRetunedTiers` asks the label
  // question and reads NARROW_BANDS_START. The profile beyond carries both.
  if (date < INFLECTION_BASE_START) return CHAINED_SCORING;
  // Two rungs for 2026-08-24, because the prefixes kept a date constant of
  // their own while the fold's second direction did not. Laddered so either can
  // move later without the other following; while the dates are equal the
  // middle rung is stepped over. The profile beyond carries all three of that
  // day's changes: the derivational families, the fold's second direction, and
  // the prefixes.
  if (date < DERIVED_BASE_START) return RETUNED_SCORING;
  if (date < PREFIX_BASE_START) return DERIVED_SCORING;
  if (date < REVIEWED_FOLD_START) return PREFIX_SCORING;
  if (date < DECADE_BANDS_START) return REVIEWED_SCORING;
  if (date < SUPERLATIVE_BASE_START) return DECADE_SCORING;
  // Two rungs for 2026-09-02, laddered like the pair for 2026-08-24 so either
  // change can move to a later date without dragging the other. While the dates
  // are equal the middle rung is stepped over.
  if (date < MEASUREMENT_BASE_START) return SUPERLATIVE_SCORING;
  return LATEST_SCORING;
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
 * Reviewed rejections, each with the reason a player sees when they try the word.
 * Two kinds, told apart by whether the word is on the curated list: a word that
 * stays in the dictionary but is no longer playable from `since` on, and a word
 * that never made the list at all -- a misspelling, a brand name, a coinage a
 * player reached for -- where the entry changes no verdict but names the fault
 * instead of falling back to the generic "not in the curated list" message, and
 * spares the live Merriam-Webster lookup a word that has already been judged.
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
 * Every curated word that carries a rejection reason, grouped by the date its
 * rejection takes effect and then by reason (src/data/derived-rejections.json,
 * written by generate-data.py). The rule is simply that a word with a reason is
 * unplayable and the player is told which -- see WordRulesModal, which has always
 * said so. The filter it came from only ever kept a classified word from
 * *entering* the list, so the ones already on it stayed playable, and an obsolete
 * spelling scored on its own vanishing frequency: "ranck" (an obsolete form of
 * "rank") came out a 9.58 Mythic where "rank" scores 4.80.
 *
 * The reasons are Wiktionary's, and they divide in two. The out-of-use trio
 * (obsolete / archaic / dated) means every ordinary sense of the word has fallen
 * out of use, and only qualifies below Zipf 2.5. That frequency gate is the guard
 * the trio needs, because its false positives are precisely the common words:
 * "halt" (3.93), "fraught" (3.12) and "guerilla" (2.90) are each tagged obsolete
 * off one dead sense, "thy" and "unto" archaic, "yea" and "fortnight" dated.
 * Nothing corpora still measure in live use is out of use, whatever a sense label
 * says. Below the gate the tag is reliable -- a 24-word random sample checked
 * against Wiktionary came back 24 for 24, the "voyce"/"performe"/"sherriff"
 * family the rule is aimed at. The structural reasons (abbreviation, proper noun,
 * misspelling) take no gate: Wiktionary gives those to a headword with no ordinary
 * sense at all, and "cd" being common says nothing about whether it is an
 * abbreviation.
 *
 * Grouped by date rather than carrying one date for the file so a later data
 * refresh can reject newly-classified words from *its* date without retroactively
 * invalidating the words an archived puzzle accepted. A word that should stay
 * playable despite its label goes in scripts/playable-exemptions.txt, which keeps
 * it out of this file for good.
 */
const DERIVED_REJECTIONS: ReadonlyMap<string, { reason: RejectionReason; since: string }> =
  new Map(
    Object.entries(derivedRejectionData as Record<string, Record<string, readonly string[]>>)
      .flatMap(([since, byReason]) =>
        Object.entries(byReason).flatMap(([reason, words]) =>
          words.map(
            (word): [string, { reason: RejectionReason; since: string }] => [
              word,
              { reason: reason as RejectionReason, since },
            ]
          )
        )
      )
  );

/**
 * The reason `word` is unplayable under `date`'s puzzle, or undefined when no
 * rejection applies. An omitted date means the newest system, where every
 * rejection is in force.
 *
 * A hand-reviewed rejection wins over the derived ones: it is a decision about
 * this exact word, and it can name a more specific fault (a misspelling of a
 * particular word) than a sense label can.
 */
export function curatedRejection(word: string, date?: string): RejectionReason | undefined {
  const normalized = word.toLowerCase();
  const rejection = WORD_REJECTIONS.get(normalized);
  if (rejection && (date === undefined || date >= rejection.since)) return rejection.reason;
  // Falls through when the reviewed rejection isn't in force yet: the derived list
  // can carry an earlier date than the hand entry, and the earlier verdict is
  // still a verdict.
  const derived = DERIVED_REJECTIONS.get(normalized);
  if (derived && (date === undefined || date >= derived.since)) return derived.reason;
  return undefined;
}

/**
 * Whether a submission is allowed. Membership in the curated dictionary, minus
 * the rejections above -- reviewed and obsolete alike. A rejected word is still in
 * `dictionary.json` (and still carries its rarity entry, so past puzzles keep
 * scoring), but it is not playable from its rejection date on.
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

// -- Same-root duplicate detection ------------------------------------------
// The date the same-root rule started reading the number and tense inflections
// `baseForm` cannot reach, so a puzzle can no longer take "indicate",
// "indicates", "indicated" and "indicating" as four separate finds. Gated on the
// *puzzle* date, not the release date: `viewedDate` reaches `evaluateSubmission`
// for archive play, so an old drop played today keeps the rules it was played
// with when it was current, and the score somebody posted for it stays
// reachable. Only forward puzzles get the tighter rule.
const SAME_ROOT_INFLECTION_START = "2026-08-24";

/**
 * Whether the curated dictionary has `word` at all, playable or not. Duplicate
 * detection keys on this rather than on `isValidWord`: a reviewed rejection makes
 * a word unsubmittable, not unreal, and it is still the right bucket label for
 * its own paradigm. Keying on playability instead broke exactly the paradigms
 * whose lemma is rejected -- "bitched", "bitches" and "bitching" each kept their
 * own key, so a puzzle could take all three.
 */
export function isDictionaryWord(word: string): boolean {
  return WORD_INDEX.has(word);
}

/**
 * The most common dictionary word among `candidates`, for duplicate detection.
 * Thin wrapper on the same `mostCommonBase` scoring folds through, so "which
 * spelling is the base" is answered the same way in both.
 */
export function mostCommonSameRootBase(
  word: string,
  candidates: readonly string[],
  date?: string
): string | undefined {
  return mostCommonBase(candidates, word, scoringFor(date));
}

/** Whether the widened same-root inflections apply to `date`'s puzzle. */
export function sameRootInflectionsActive(date?: string): boolean {
  return date === undefined || date >= SAME_ROOT_INFLECTION_START;
}

/**
 * A hand-reviewed identity: `word` shares a root with `root` and with nothing
 * else, from `since` on. A pin to the word itself means "this word has no root
 * but its own".
 */
interface SameRootPin {
  root: string;
  since: string;
  /** Review notes only -- nothing here reads it. */
  reason?: string;
}

/**
 * The words no spelling rule can key correctly, reviewed one at a time.
 *
 * Three shapes, and nothing else belongs here -- a rule needing many entries is a
 * rule that does not belong in duplicate detection at all:
 *
 *   - a decisive strip landing on an unrelated word, where frequency picks it
 *     too and so nothing but a review can settle it ("theses" -> "these").
 *   - a word that merely ends in "-men", which the one stem-changing family in
 *     play reads as a plural ("germen" -> "german", "dolmen" -> "dolman").
 *   - an irregular plural whose "-ve"/"-ce" variant spelling is itself curated,
 *     so tier 1 settles on the variant and the stem-changing reading is never
 *     reached ("wolves" -> "wolve", never "wolf"; "indices" -> "indice", never
 *     "index"). Only the plurals a player actually meets are pinned; the
 *     technical tail ("dialyses", "fibroses") is left to leak.
 *
 * Separate from `score-overrides.json` on purpose, and the two can disagree
 * about the same word: an override caps what "theses" is *worth* (at "these", to
 * deny it an unearned Legend), while identity has to keep the two words apart so
 * a player who found one may still play the other. Reading the overrides as
 * identities would turn every reviewed demotion into a refusal.
 */
const SAME_ROOT_PINS: ReadonlyMap<string, SameRootPin> = new Map(
  Object.entries(sameRootPinData as Record<string, SameRootPin>)
);

/** The reviewed root for `word` under `date`'s puzzle, if one is pinned. */
export function pinnedSameRoot(word: string, date?: string): string | undefined {
  const pin = SAME_ROOT_PINS.get(word);
  if (!pin) return undefined;
  return date === undefined || date >= pin.since ? pin.root : undefined;
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
      return {
        word: normalized,
        base: chained.base,
        ownZipf,
        baseZipf: chained.zipf,
      };
    }
    return undefined;
  }

  const override = overrideBase(normalized, date);
  if (override) {
    return {
      word: normalized,
      base: override,
      ownZipf,
      baseZipf: zipfFor(override, scoring),
    };
  }

  const tenseBase = tenseBaseForm(normalized, scoring);
  if (tenseBase && tenseBase !== normalized) {
    return {
      word: normalized,
      base: tenseBase,
      ownZipf,
      baseZipf: zipfFor(tenseBase, scoring),
    };
  }

  const base = scoringBaseForm(normalized, scoring);
  if (base && base !== normalized) {
    const baseZipf = zipfFor(base, scoring);
    if (baseZipf > ownZipf) return { word: normalized, base, ownZipf, baseZipf };
  }
  return undefined;
}

/**
 * The smallest drop in the *shown* score worth putting a note under, in points.
 * A rank change alone can be almost nothing on the number: the Legend cutoff
 * sits at 9.9 and Mythic runs to 9.89, so a fold across that line can move the
 * badge while moving the score by a single cent. This floor keeps the note tied
 * to something the player can see in both places.
 */
export const BASE_FORM_NOTICE_DROP = 0.3;

/**
 * The fold behind `word`'s score, but only when it cost the word a rank --
 * Legend down to Mythic, Mythic down to Rare, and so on -- moved the shown score
 * by at least BASE_FORM_NOTICE_DROP, and reached a form no longer than the word
 * played. Undefined otherwise, including when the word scored on its own data.
 *
 * A rank change rather than a threshold on the number alone, because the ranks
 * are where the scale's own sense of "meaningfully rarer" already lives, and
 * they carry it across both bands. A fixed gap cannot: the measured band spends
 * 9.9 points over six Zipf while the deep tail spends a tenth of a point over
 * one, so any constant that reads as a real loss in the middle of the scale is
 * twenty-odd times too lenient at the top, where the folds are largest and the
 * scores players care most about sit. A demoted badge is also the thing the
 * player actually noticed -- the note answers a question the badge just raised.
 *
 * Both halves are read off what the player sees: the ranks as rendered, and the
 * scores as *formatted* rather than raw, so the drop the floor measures is the
 * one visible on the two badges.
 *
 * Every fold is a cap (see `chainedBase`), so a rank that moved always moved
 * downward; the comparison is written as a rank *drop* anyway, so nothing here
 * quietly starts reporting a promotion if that invariant ever slips.
 *
 * The length condition is about the note, not the score: 8,257 folds reach a
 * longer form, and they keep the score that form gives them -- they just stop
 * announcing it. See the guard below for why.
 */
export function baseFormRankDrop(
  word: string,
  date?: string
): BaseFormSubstitution | undefined {
  const substitution = baseFormSubstitution(word, date);
  if (!substitution) return undefined;
  // A common form longer than the word played is one the fold reached by
  // building the word up rather than stripping it down -- "abaci" scored as
  // "abacus", "infatuate" as "infatuated". Naming it reads as a correction of
  // the word the player found, as if a shorter word were an incomplete attempt
  // at a longer one, and the note is meant to explain a badge rather than to
  // second-guess the find. The score is unchanged; only the explanation is
  // withheld.
  if (substitution.base.length > substitution.word.length) return undefined;
  const scoring = scoringFor(date);

  const own = RARITY_ORDER.indexOf(scoring.rarity(substitution.ownZipf));
  const base = RARITY_ORDER.indexOf(scoring.rarity(substitution.baseZipf));
  // RARITY_ORDER runs rarest first, so a larger index is the more common rank.
  if (base <= own) return undefined;

  const shown = (zipf: number) => Number(scoring.format(scoring.score(zipf)));
  const drop = roundToCents(shown(substitution.ownZipf) - shown(substitution.baseZipf));
  return drop >= BASE_FORM_NOTICE_DROP ? substitution : undefined;
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
  // The word's own frequency, so the reverse fold can skip a form that could not
  // beat it -- see the `floor` argument to `inflectedFormFolds`.
  const own = WORD_INDEX.has(word) ? zipfFor(word, scoring) : -Infinity;

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
      // The other direction, and the reason it is applied here rather than as
      // another entry in `nextBaseForms`: a word is capped at the inflections
      // built on it, but the walk does not continue *through* them (see
      // `inflectedFormFolds`). Every node gets the treatment, not just the word
      // the walk started from, so a form reaches its paradigm's cap through its
      // own base: "infatuates" folds to "infatuate", which caps at
      // "infatuated", and all three end up scoring alike.
      // The same direction one family further out: the bound "-ic"/"-ous"
      // adjective of a technical noun, which is the half of the pair anyone
      // writes. Terminal like the inflections and for a stronger reason -- there
      // is no round trip behind it, only the floor and the length (see
      // `derivedFormCandidates`), so the cap is taken and the walk stops.
      for (const form of derivedFormFolds(current, scoring, date)) {
        const zipf = zipfFor(form, scoring);
        if (!best || zipf > best.zipf) best = { base: form, zipf };
      }
      for (const form of inflectedFormFolds(
        current,
        scoring,
        date,
        Math.max(own, best ? best.zipf : -Infinity)
      )) {
        const zipf = zipfFor(form, scoring);
        if (!best || zipf > best.zipf) best = { base: form, zipf };
        // Terminal for the *inflectional* hops and transparent to the rest, from
        // REVIEWED_FOLD_START. Reading only the form's raw Zipf is the mistake
        // `chainedBase` was built to fix, still made in this one direction: the
        // form may itself have folded, and then the cap is a number the engine
        // has already discarded. "semiweekly" is measured at 1.16, just above
        // the floor, so no prefix rule may touch it -- but "semiweeklies" is
        // below the floor, folds to "weekly" (4.42), and the lemma was capped at
        // its raw 0.55 instead, leaving the two 6.5 points apart.
        //
        // Only the rungs *above* the paradigm are followed, never another
        // reading of the form itself, which is what the terminal-hop guard was
        // protecting: "cleanses" is both "cleanse" + "-s" and "cleans" + "-es",
        // and walking its rival reading onward lands "cleanse" on "clean". Those
        // rivals are exactly the inflectional hops, so dropping them keeps the
        // guard while letting a paradigm reach the base its own members found.
        if (scoring.paradigmFolds) {
          for (const above of nonInflectionalBaseForms(form, scoring, date)) {
            if (seen.has(above)) continue;
            seen.add(above);
            next.push(above);
            const aboveZipf = zipfFor(above, scoring);
            if (!best || aboveZipf > best.zipf) best = { base: above, zipf: aboveZipf };
          }
        }
      }
    }
    frontier = next;
  }
  return best;
}

/**
 * The answer both candidate sets below share before any spelling rule runs: an
 * exemption's silence, an override's single pick, or the one base the systems
 * before INFLECTION_BASE_START allowed. `undefined` means the spelling rules
 * decide, and the caller carries on.
 *
 * Factored out because `nextBaseForms` and `inflectionalBaseForms` differ only
 * in which spelling families they consult, and must not differ at all in how a
 * reviewed decision about the word overrides them.
 */
function decidedBaseForms(
  word: string,
  scoring: Scoring,
  date?: string,
): string[] | undefined {
  // A reviewed exemption silences every rule below, the override included --
  // the two files must never share a word (pinned by a test).
  if (scoring.inflectionBases && foldExempt(word, date)) return [];

  const override = overrideBase(word, date);
  if (override) return [override];

  if (!scoring.inflectionBases) {
    const single = tenseBaseForm(word, scoring) ?? scoringBaseForm(word, scoring);
    return single ? [single] : [];
  }

  return undefined;
}

/**
 * The *inflectional* readings of `word`: the rival analyses of one ending, where
 * every candidate is a different guess at the same fold and at most one of them
 * can be right. "wives" is either "wife", "wif", "wiv" or "wive"; "singes" is
 * either "singe" or "sing". Picking between them is a question about the
 * spelling, and `mostCommonBase` answers it.
 *
 * Kept apart from the derivational and prefix families `nextBaseForms` adds on
 * top, which are not rivals at all -- they are further rungs of the same ladder.
 * "overripening" reads as an inflection of "overripen" *and* as a prefixed
 * "ripening", and those two are not competing analyses: "ripening" is where
 * "overripen" would itself fold if it could. Only `inflectedFormFolds` cares
 * about the distinction, and it is the whole difference between a paradigm
 * holding together and coming apart -- see the round-trip note there.
 */
function inflectionalBaseForms(
  word: string,
  scoring: Scoring,
  date?: string,
): string[] {
  const decided = decidedBaseForms(word, scoring, date);
  if (decided) return decided;

  const out: string[] = [];
  addInflectionalBaseForms(word, scoring, candidateAdder(out, word));
  return out;
}

/** The shared body of the two sets above, so neither can drift from the other. */
function addInflectionalBaseForms(
  word: string,
  scoring: Scoring,
  add: (candidate: string | undefined) => void,
): void {
  add(tenseBaseForm(word, scoring));
  add(baseForm(word));
  for (const candidate of inflectionalBaseCandidates(word, latinPluralsAllowed(word))) {
    add(candidate);
  }
  // "-ier"/"-iest" comparatives, ungated: unlike bare "-er"/"-est", the "-y"
  // rewrite is checkable, and the check is the base's *other* degree. "happy"
  // has "happiest", so "happier" folds onto it even though both carry real
  // measurements; "copy" has no "copiest", so "copier" -- an agent noun -- keeps
  // its own score. Running above the floor is the point: every measured
  // comparative ("angrier", "earliest", "prettiest") scored rarer than its own
  // adjective while the only degree rules lived behind the gate.
  for (const { base, counterpart } of degreeBaseCandidates(word)) {
    if (WORD_INDEX.has(counterpart)) add(base);
  }
  // Bare "-est", on the same check and for the same reason: the comparative in
  // the same spelling is what tells a superlative ("realest", so "realer") from
  // a word that merely ends that way ("contest", but no "conter"). Its "-er"
  // half stays behind the floor gate -- see `superlativeBaseCandidates`.
  if (scoring.superlativeBases) {
    for (const { base, counterpart } of superlativeBaseCandidates(word)) {
      if (WORD_INDEX.has(counterpart)) add(base);
    }
  }
}

/**
 * Every base `word` could fold onto in one hop, in the same precedence the
 * single-hop path uses -- a reviewed override first, then a tense inflection,
 * then a transparent or bound suffix. Under the chained system every one of these
 * is a cap rather than an inheritance, so the caller can treat them alike.
 *
 * One direction only: these are the words `word` could be a *form of*. The
 * inflections built *on* it are `inflectedFormFolds`, which `chainedBase`
 * consults separately because they must not be walked onward -- see the note
 * there on terminal hops.
 *
 * A reviewed override replaces the guesses rather than joining them: it is a
 * decision about this exact word, so the spelling rules are not consulted at all.
 *
 * Before INFLECTION_BASE_START this returned one base -- the first rule that
 * matched, each rule having already narrowed to its own most common candidate.
 * The latest system returns the whole set instead and lets `chainedBase` explore
 * it, because "which base is most common" and "which base leads to the most
 * common word" are different questions (see `chainedBase`). The set is a superset
 * of the older systems' single pick.
 */
function nextBaseForms(word: string, scoring: Scoring, date?: string): string[] {
  const decided = decidedBaseForms(word, scoring, date);
  if (decided) return decided;

  const out: string[] = [];
  const add = candidateAdder(out, word);
  addInflectionalBaseForms(word, scoring, add);
  addNonInflectionalBaseForms(word, scoring, date, add);
  add(scoringBaseForm(word, scoring));
  return out;
}

/**
 * The half of `nextBaseForms` that is not a rival reading of an ending: the
 * gated suffix and prefix families, and the bound derivational ones. These are
 * rungs *above* the word rather than guesses about it, which is why the reverse
 * fold may follow them out of a confirmed form and must not follow the others
 * (see `chainedBase`).
 */
function addNonInflectionalBaseForms(
  word: string,
  scoring: Scoring,
  date: string | undefined,
  add: (candidate: string | undefined) => void
): void {
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
      // A prefix base must be a *word*, not a fragment. Unlike the suffix
      // families, stripping a prefix routinely lands on a bound combining form
      // that a 225k-word dictionary happens to list as an entry -- "neolith" ->
      // "lith", "monocrat" -> "crat", "autophyte" -> "phyte", "prelect" ->
      // "lect", "subduce" -> "duce". Every one is a real dictionary word and
      // none is a base anything was built on. Since #207 the fold is *shown* --
      // "Scored as its common form, 'material'" -- so this is not a question about
      // how much frequency a base supplies but about whether a player would
      // accept it: "Scored as its common form, 'lith'" reads as a bug, and a
      // visible wrong fold is worse than a quietly generous score.
      //
      // That question is answered by `boundPrefixResidue`, a reviewed table, and
      // for good until REVIEWED_FOLD_START it was answered by a Zipf-3 floor
      // instead. The floor was not a proxy for it -- it is a different question
      // with different answers in both directions. "snob" (2.96), "aural"
      // (2.78), "ripen" (2.73), "swum" (2.43) and "emote" (2.46) are ordinary
      // words it refused; "dont" (4.74) is a fragment it admitted, and is in
      // fold-exemptions.json to this day because nothing else could catch it.
      // Sixty-one such residues were being refused to keep out about twenty
      // fragments, and the fragments were not the rare ones -- "duce" at 2.51
      // and "lect" at 1.80 sit either side of "gird" at 2.22.
      const spellings = prefixBaseCandidates(word);
      // A reviewed entry scoped to the prefix refuses this hop and leaves the
      // word's ordinary folds alone -- see FoldExemption.scope. Asked after the
      // spellings, not before: it reads the word's inflectional base, and most
      // words have no prefix candidate for it to refuse.
      const refused =
        spellings.length > 0 &&
        // A superlative's prefix belongs to the adjective inside it, not to the
        // degree form: "uncleanest" is the superlative of "unclean", and
        // stripping un- off it reads the word inside out. See
        // `hasSuperlativeReading`.
        (hasSuperlativeReading(word, scoring) ||
          (scoring.prefixResidues && prefixFoldExemptParadigm(word, scoring, date)));
      for (const candidate of refused ? [] : spellings) {
        if (!WORD_INDEX.has(candidate)) continue;
        if (scoring.prefixResidues) {
          if (!boundPrefixResidue(candidate, date)) add(candidate);
        } else if (zipfFor(candidate, scoring) >= PREFIX_BASE_MIN_ZIPF) {
          add(candidate);
        }
      }
    }
  }
  // The measurement modifiers, ungated for the same reason and on a different
  // guarantee: not the ending but the *residue* is what is closed here, to a
  // reviewed list of units (see MEASUREMENT_UNITS). "kilojoules" folds onto
  // "joules" though both are measured, because a kilojoule is a joule.
  if (scoring.measurementBases) {
    for (const candidate of measurementBaseCandidates(word)) {
      if (measurementUnit(candidate, date)) add(candidate);
    }
  }
  // The bound derivational families: an ending English only ever produces by
  // attaching that suffix, so -- like the "-ization"/"-ability" pair in
  // `scoringBaseForm` -- there is nothing accidental for the rule to catch and
  // no frequency gate is needed. "catholically" folds onto "catholic" though
  // both are measured, the same way "happier" folds onto "happy".
  if (scoring.derivedBases) {
    for (const candidate of derivedBaseCandidates(word)) add(candidate);
  }
}

/**
 * The rungs above `word` on its own ladder, with none of the rival readings of
 * its ending -- `addNonInflectionalBaseForms` as a list, plus the same reviewed
 * short-circuits every other candidate set honours.
 */
function nonInflectionalBaseForms(word: string, scoring: Scoring, date?: string): string[] {
  const decided = decidedBaseForms(word, scoring, date);
  if (decided) return decided;
  const out: string[] = [];
  addNonInflectionalBaseForms(word, scoring, date, candidateAdder(out, word));
  return out;
}

/**
 * Whether the prefix hop is refused for `word` or for the word it inflects.
 *
 * A blanket exemption covers a paradigm for free, because no chain may pass
 * through the exempt word and its forms can only reach the gated strips by way
 * of it. A prefix-scoped one has no such reach: "previsor" is pre- + `visor` by
 * accident, but so is "previsors" by its own strip, and an entry naming only the
 * singular left the plural folding and then dragged the singular after it
 * through the reverse hop. Reading one step back keeps the file's promise that
 * an entry covers the paradigm, rather than asking review to list every
 * inflection of every wrong bracketing.
 */
/**
 * Whether `word` reads as a bare "-est" superlative of a word the dictionary
 * attests -- the base is a word and the comparative in the same spelling
 * vouches for it (see `superlativeBaseCandidates`).
 *
 * Asked of the prefix hop, which is a question about *bracketing*: "uncleanest"
 * is un- + "cleanest" only by accident, and it really is the superlative of
 * "unclean". The degree suffix is the outer layer, so the prefix belongs to the
 * adjective inside it, and stripping the prefix off the superlative reads the
 * word inside out -- "most unclean" came back scored as `clean`, its own
 * opposite. Whether that adjective then sheds its prefix is a question asked at
 * the adjective, once, on the adjective's own measurement: "unclean" is measured
 * and keeps its score, so the chain stops there.
 *
 * The same shape as a `scope: "prefix"` exemption ("antiphonic" is antiphon +
 * -ic, not anti- + `phonic`), as a rule rather than an entry each. Eight words
 * need it, all of them prefixed adjectives the superlative fold newly reaches:
 * "uncleanest", "unclearest", "uncommonest", "unfairest", "unjustest",
 * "unsoundest", "unstablest", "unchastest".
 */
function hasSuperlativeReading(word: string, scoring: Scoring): boolean {
  if (!scoring.superlativeBases) return false;
  return superlativeBaseCandidates(word).some(
    ({ base, counterpart }) => WORD_INDEX.has(base) && WORD_INDEX.has(counterpart)
  );
}

function prefixFoldExemptParadigm(word: string, scoring: Scoring, date?: string): boolean {
  if (prefixFoldExempt(word, date)) return true;
  return inflectionalBaseForms(word, scoring, date).some((base) => prefixFoldExempt(base, date));
}

/** The dedupe-and-check every candidate set adds through. */
function candidateAdder(out: string[], word: string) {
  return (candidate: string | undefined) => {
    if (!candidate || candidate === word) return;
    if (!WORD_INDEX.has(candidate) || out.includes(candidate)) return;
    out.push(candidate);
  };
}

/**
 * The regular inflections of `word` that the engine's own forward rules read as
 * forms of it -- the fold's second direction.
 *
 * Every other rule in this file asks "what is this word a form of", which caps a
 * form at its base and stops a plural out-scoring its singular. Nothing asked
 * the reverse, so a base was never capped at its own forms -- and English has a
 * large class of verbs where that is the wrong way round. The bare lemma of a
 * participle-dominant verb is genuinely rare in text ("belove" at Zipf 1.10,
 * "infatuate" at 1.30) while the participle everyone actually writes is
 * ordinary ("beloved" 4.17, "infatuated" 2.90), so the engine sold the rarest
 * inflection of a familiar word as a deep-tail find: 2,087 words displayed
 * Mythic or better and are capped by their own "-ed"/"-ing" form once this runs --
 * "disgruntle" 9.91, "outstand" 9.65, "unbridle" 9.83, "overjoy" 9.87. The
 * `tenseBaseForm` note below records the same pairing from the other side: once
 * folds became caps, "beloved" -> "belove" went inert, because a cap cannot pull
 * a word toward *rare*. This direction is what the inert half left undone.
 *
 * The first guard is a round trip. `inflectedFormCandidates` over-generates
 * spellings, and a candidate counts only if it is a dictionary word whose own
 * forward fold comes back to `word` -- not merely offering it among its
 * candidates, but *choosing* it, by the same most-common-base rule the forward
 * direction uses. That reuses the reviewed forward rules, overrides and
 * exemptions included, as the definition of the relation, rather than asserting a
 * second inverse set of spelling rules that could disagree with them.
 *
 * Requiring the chosen base rather than a candidate is what makes the difference
 * on the coincidences, because the forward rules propose every plausible
 * spelling and then narrow. "wives" proposes "wife", "wif", "wiv" and "wive", so
 * a candidate check would have scored the archaic verb "wive" as the plural of
 * "wife"; "wife" wins the pick, so the pair never links and "wive" keeps its own
 * score. Same for "singe", which reaches "singes" and "singing" by spelling but
 * loses both picks to the far commoner "sing".
 *
 * The pick runs over the form's *inflectional* readings only, from
 * INFLECTION_ROUND_TRIP_START (see `inflectionalBaseForms`). Asking it of the
 * whole candidate set made the guard read a ladder as a rivalry: "overripening"
 * offers "overripen" (its lemma) and "ripening" (itself, minus the prefix), and
 * the second is not a competing analysis but the next rung -- where "overripen"
 * would itself fold if the prefix rule could reach a measured word. Letting it
 * win the pick unlinked the pair, and the lemma floated back up to a score its
 * own forms had just left: "overripen" 9.95 Legend beside "overripening" 7.36
 * Rare, "unwreathe" 10.00 beside "unwreathed" 6.43. Every rung above the word is
 * reached anyway, through the chain, once the pair holds.
 *
 * This is a guard against the *forward* rules improving, which is the shape that
 * makes it worth naming: any widening of `nextBaseForms` moves some forms' pick
 * one rung further up, and under the old reading that silently took paradigms
 * apart. The narrower question -- "is `word` the inflectional reading this form
 * settles on" -- has an answer that does not move when a rule above it learns to
 * climb.
 *
 * The second guard is that these hops are *terminal* -- `chainedBase` caps
 * against a form but never walks on from it. Without that, one reverse hop and
 * one forward hop compose into a link between two words in different paradigms,
 * because a form can be shared: "singe" reaches its own "singes" (a legitimate
 * reverse hop, since "-es" strips to either "singe" or "sing"), and walking on
 * from "singes" would then have landed on "sing" and scored a rare verb as an
 * everyday one. The same composition dragged "thee" onto "the". A cap needs only
 * the form's own frequency, so refusing to expand costs nothing the rule was for.
 *
 * Deliberately *not* gated to below MEASURED_FLOOR, unlike the other rules whose
 * spelling is not decisive. The gate rescues a family when its false positives
 * land on common words, and here they would be the common words: the whole point
 * is to cap a *measured* lemma ("infatuate" at 1.30 is above the floor) at a
 * more common form. A gate would leave every word that prompted the change
 * exactly where it was. The round trip is the guard instead.
 *
 * A reviewed override on `word` suppresses this the way it suppresses the
 * forward rules: it is a decision about this exact word, and the spelling rules
 * -- in either direction -- do not get to add to it.
 */
/**
 * The bound derivational forms built on `word` that may cap it: its "-ic",
 * "-ical" or "-ous" adjective, where that adjective is the half of the pair the
 * language actually uses. See `derivedFormCandidates` for the spellings and for
 * why this family has a gate where the inflections have a round trip.
 *
 * Two conditions beyond the spelling. `word` must sit below MEASURED_FLOOR, the
 * line every non-decisive rule in this file respects: below it a score is a
 * stand-in and a relative is better information, at or above it there is a real
 * measurement no spelling guess may overrule -- and every accidental "-ic" pair
 * ("pan"/"panic", "top"/"topic") lives far above it. The adjective must itself
 * be measured, because the whole point is to inherit a measurement: an
 * unattested adjective would cap a deep-tail noun at another deep-tail number
 * and move nothing but the explanation shown for it.
 *
 * A reviewed override or exemption on `word` suppresses this the way it
 * suppresses every other rule -- it is a decision about this exact word.
 */
function derivedFormFolds(word: string, scoring: Scoring, date?: string): string[] {
  if (!scoring.derivedFormFolds) return [];
  if (foldExempt(word, date) || overrideBase(word, date)) return [];
  const index = WORD_INDEX.get(word);
  if (index === undefined || scoring.zipfAt(index) >= MEASURED_FLOOR) return [];

  const out: string[] = [];
  for (const form of derivedFormCandidates(word)) {
    const formIndex = WORD_INDEX.get(form);
    if (formIndex === undefined) continue;
    if (scoring.zipfAt(formIndex) < MEASURED_FLOOR) continue;
    out.push(form);
  }
  return out;
}

function inflectedFormFolds(
  word: string,
  scoring: Scoring,
  date?: string,
  floor = -Infinity
): string[] {
  if (!scoring.inflectionForms) return [];
  if (foldExempt(word, date) || overrideBase(word, date)) return [];

  const out: string[] = [];
  for (const form of inflectedFormCandidates(word)) {
    const index = WORD_INDEX.get(form);
    if (index === undefined) continue;
    // The frequency test before the round trip, not after. A cap can only pull
    // toward common, so a form no commoner than what the caller already has
    // cannot change the answer -- and confirming the link is the expensive half
    // (a full candidate generation for every spelling offered). Skipping those
    // is what keeps this off the drop-scan hot path: `bestWordForDrop` walks the
    // whole dictionary, and most words' inflections are rarer than the word.
    //
    // From REVIEWED_FOLD_START the "cannot change the answer" half only holds
    // above MEASURED_FLOOR. A form below the floor may be rarer than the word
    // and still lead somewhere commoner, because that is exactly where the gated
    // families fire: "semiweeklies" is unattested, so it looks useless beside
    // "semiweekly" at 1.16 -- and it strips its prefix to reach "weekly" at
    // 4.42, which the measured lemma may not do for itself. Skipping it left the
    // pair 6.5 points apart. The floor is what keeps the extra work bounded:
    // above it nothing has changed, and the forms below it are the deep tail.
    const formZipf = scoring.zipfAt(index);
    if (formZipf <= floor && !(scoring.paradigmFolds && formZipf < MEASURED_FLOOR)) continue;
    const readings = scoring.paradigmFolds
      ? inflectionalBaseForms(form, scoring, date)
      : nextBaseForms(form, scoring, date);
    if (mostCommonBase(readings, form, scoring) !== word) continue;
    out.push(form);
  }
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
