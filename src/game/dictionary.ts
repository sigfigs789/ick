import {
  FREEFORM_TRIAL_END,
  FREEFORM_TRIAL_START,
  MODE_CHOICE_START,
  freeformForDate,
  type GameMode,
} from "./mode";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import legacyRarityData from "../data/rarity-legacy.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
import foldReviewVerdictData from "../data/fold-review-verdicts.json";
import boundResidueData from "../data/bound-residues.json";
import measurementUnitData from "../data/measurement-units.json";
import wordRejectionData from "../data/word-rejections.json";
import sameRootPinData from "../data/same-root-pins.json";
import derivedRejectionData from "../data/derived-rejections.json";
import revealWordData from "../data/reveal-words.json";
import revealDefinitionData from "../data/reveal-definitions.json";
import {
  baseForm,
  boundBaseCandidates,
  degreeBaseCandidates,
  derivedFormCandidates,
  derivedBaseCandidates,
  doublingTenseStem,
  inflectedFormCandidates,
  inflectionalBaseCandidates,
  measurementBaseCandidates,
  measurementPrefixes,
  prefixBaseCandidates,
  privativeBaseCandidates,
  superlativeBaseCandidates,
  transparentPrefixes,
  ungatedPrefixBaseCandidates,
  unmeasuredBaseCandidates,
} from "./stem";
import { corpusAttests, corpusEntry } from "./corpus";
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
 *   - on/after 2026-09-02 (the latest system): three independent folds sharing
 *     one cutover, in the pattern of 2026-08-24.
 *       * The bare "-est" superlative folds onto its adjective wherever the
 *         "-er" comparative of the same spelling is a word, rather than only
 *         below MEASURED_FLOOR (see SUPERLATIVE_BASE_START).
 *       * A measurement modifier is scored as the unit it counts --
 *         "kilojoules" as `joules`, "gibibyte" as `bytes`. Ungated by
 *         MEASURED_FLOOR on the strength of a reviewed unit table; 302 words
 *         score lower and none higher, 47 of them holding a Legend for a
 *         multiplier (see MEASUREMENT_BASE_START).
 *       * A privative "-less" adjective folds onto the word it is the absence
 *         of, carrying its "-lessly"/"-lessness" derivatives with it through the
 *         "-ly"/"-ness" strips they already took ("kindless" as `kind`). Ungated
 *         for the same reason the bound families are; 1,224 words score lower
 *         and none higher, 372 of them holding a Mythic or better for the
 *         suffix (see PRIVATIVE_BASE_START).
 *     None of the three moves a label mapping.
 *   - on/after 2026-09-05 (the latest system): two retirements, the first fold
 *     rules to be taken away rather than added, sharing a cutover in the pattern
 *     of 2026-08-24.
 *       * "pre-" leaves the transparent prefixes. It was the family whose wrong
 *         readings a player could see, and 808 words score higher for its going
 *         (see PRE_PREFIX_END).
 *       * Every borrowed prefix goes with it -- the classical combining forms
 *         and the Latinate ones alike -- on the distinction the list turns on: a
 *         native prefix takes a free-standing English word, a borrowed one takes
 *         a bound stem as readily, so a residue that is a word can be a
 *         coincidence ("protocol" as `cole`, "subsister" as `sister`). What is
 *         left folding is "counter-", "under-", "anti-", "over-", "out-" and
 *         "un-". 3,746 words score higher (see BORROWED_PREFIX_END).
 *     4,554 words rise between them and none falls. Neither moves a label
 *     mapping.
 *   - on/after 2026-09-10 (the latest system): the bare-stem reading of an
 *     "-ed"/"-ing" ending is dropped where English spells that stem's own forms
 *     with a doubled consonant, leaving the silent-"e" reading the only one on
 *     offer -- "waning" is `wane`, not `wan`, because "wan" conjugates as
 *     "wanning". 181 words were folding onto a stem that only exists doubled,
 *     and the base they took was almost always an unrelated everyday word
 *     ("themed" as `them`, "noted" as `not`, "biting" as `bit`). 229 words score
 *     higher and 23 lower (see DOUBLING_TENSE_START). No label mapping moves.
 *   - 2026-09-14 to 2026-09-21 inclusive -- "Freeform week", a trial rather than
 *     a cutover, and the only entry here that is a *window* rather than a rung.
 *     Every fold above is skipped and each word scores on its own measured
 *     frequency: 115,474 of the 220,078 playable words score higher, 93,283 of
 *     them a full rank higher, and Legend goes from 9.0% of the dictionary to
 *     27.1%. Nothing is demoted, because a fold has only ever been a cap.
 *     Deliberately an off switch rather than a deletion -- the rules stay where
 *     they are, the window steps over them, and 2026-09-22 lands back on the
 *     latest system with every archived puzzle either side of the week still
 *     scoring exactly as it was played. See FREEFORM_START.
 *     The same-root refusal in submit.ts goes with it, since it is this fold
 *     asked a second way: scoring folds "plays" onto "play" to price it, and
 *     same-root folds them together to call them one word. A week that scores a
 *     word on its own terms has to let it be played on them, so "play", "plays"
 *     and "played" are three answers. Submitting one spelling twice is still
 *     refused -- that was never the fold.
 *     The reviewed rejections that refuse a real word for its *register* go too
 *     -- proper nouns, abbreviations, and the obsolete/archaic/dated trio -- on
 *     the same argument: a week about playing however you want does not get to
 *     say which register is allowed. Misspellings and non-words stay refused,
 *     which is the line the curation rules already draw (see
 *     FREEFORM_WAIVED_REJECTIONS).
 *   - on/after 2026-09-27: the fold stops reading the
 *     curated list and reads the expansive corpus instead. The first entry here
 *     that changes the *list* a rule is applied to rather than the rule -- every
 *     fold above is untouched and none is added.
 *     What it fixes is the ceiling `rarityForUncurated` names in its own
 *     docstring: a fold could only ever reach one of the 225,483 curated words,
 *     so a derivation whose base was not on the list scored on the fact that
 *     nobody writes it. 2,877 words score lower for the change and 33 higher,
 *     the promotions being spellings whose fold was never load-bearing (mostly a
 *     Latin-plural guard that a bigger lexicon flips, plus a few words crossing a
 *     band boundary by hundredths).
 *     The lexicon behind it is 790,130 headwords -- everything a lexicon attests
 *     that carries no tag the game treats as a fault. The tag test was learned by
 *     measurement: names ("airi" standing in front of `airy`) and dead spellings
 *     ("destin" for `destined`) handed 58 words a Mythic or better they had not
 *     earned. Frequency is deliberately *not* a condition, since an uncounted
 *     headword can never win `mostCommonBase` and is still a rung the chain walks
 *     through. See `corpusAttests` in corpus.ts and CORPUS_ONLY_START.
 *     No label mapping moves.
 *   - on/after 2026-10-04 (the latest system): Standard stops reading an "-s"
 *     form as inflected a second time. "hearses" is `hearse` + "-s", not `hears`
 *     + "-es", and "finessed" is `finesse` + "-d", not a doubled `fines`. 36
 *     curated words score rarer and "menseless" commoner. See
 *     REINFLECTION_START and `reinflectedResidue`.
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
 * MODE_CHOICE_START: "pre-" folds again.
 *
 * PRE_PREFIX_END below retired it, on an argument this reversal does not
 * dispute: English fossilised "pre-" onto Latin stems that were never English
 * words, nothing in the spelling separates "precaution" from "precooked", and
 * the floor gate cannot help because the fossils are rare. What has changed is
 * not the argument but what can be done about it. That note asked for "a vetted
 * table of which words really carry the prefix" and could not point at one. The
 * table now exists, built by judging every fold the prefix reaches across the
 * corpus: 400 families, of which 50 landed on a base that means something else.
 *
 * Each of those 50 is either pinned to the base it should have reached
 * ("prepositional" to `preposition`, not `positional`; "premillennial" to
 * `millennium`, not the generation; "preachier" to `preachy`, not `achy`) or
 * refused outright where the word is a single lexeme the prefix only appears to
 * open ("prelate", "prescience", "prepuce", "premiss", "precaution"). The three
 * readings the retirement was written about are among them -- "preapply" no
 * longer reaches `app`, "prehearing" no longer reaches `hear`. 17 overrides and
 * 90 prefix-scoped exemptions, and after them no family the prefix reaches lands
 * on a base a reader would reject.
 *
 * It stays *behind* MEASURED_FLOOR -- not in UNGATED_PREFIXES and it cannot be,
 * because "present", "preface" and "pressure" are measured well above the floor
 * and all have the shape.
 *
 * No date constant of its own: it rides MODE_CHOICE_START with the mode switch
 * and the ungated prefixes, which is the argument UNGATED_PREFIX_START already
 * makes -- a player meeting the two systems side by side is the moment for the
 * folding one to be at its best, and one date is one explanation.
 *
 * "re-" was measured alongside it and is not here. It reaches three times as far
 * (932 families) at the same rate of wrong readings, and the corrections would
 * not hold: above MEASURED_FLOOR a prefix-scoped entry does not reach the rung
 * the wrong base arrives on, so "reserve" stayed on `serve` and "remorse" on
 * `morse`, and widening those entries hands "rebater" a 9.93 Legend instead. It
 * stays out until that is answered, which is the standard this date holds
 * "pre-" to.
 */

/*
 * 2026-09-05: "pre-" stops being a foldable prefix, the first of these rules to
 * be taken away rather than added -- and, from MODE_CHOICE_START, the first put
 * back; see the note above, which reverses this judgement on the strength of the
 * reviewed table it could not point at, and inherits every cost counted here. Everything else about the prefix fold stays
 * as it was -- the floor gate, the residue table, the exemptions -- and archived
 * puzzles keep the scores they were played with, so the flag stays on for every
 * system before this date (see `Scoring.prePrefixBases`).
 *
 * "pre-" folded 808 words and got enough of them wrong to be the family a player
 * notices. A wrong prefix fold is not a generous score, which is the failure
 * mode the rest of the fold guards against -- it is a named base and a rank
 * taken away: "preapply" showed 4.60 Very Common as `app`, "prehearing" 4.06 as
 * `hear`, "prelife" 3.08 as `life`, "prefab" 6.67 as `fab`. The prefix reads
 * transparently ("precooked" is cooked) often enough to have earned its place in
 * 2026-08-24, but English also fossilised it onto Latin stems the way it did
 * "de-" and "re-": "precaution" is not a caution taken early, "predominance" not
 * a dominance, "premonish" not a monishing. Nothing in the spelling separates
 * the two readings, and the floor gate does not separate them either. It is not
 * even the guard it reads as: 265 of the 808 are measured at or above
 * MEASURED_FLOOR and folded anyway, laundered through a deep-tail inflection --
 * "presciences" (0.17) strips the prefix to `science`, and the reverse fold then
 * caps the measured "prescience" (2.10) at its own plural. "precaution" (3.40)
 * and "pretext" (3.27) reach their bases the same way. That leak is the prefix
 * rule's, not this prefix's -- 2,160 measured words fold through it with "pre-"
 * already gone ("protocol" -> `cole`, "overtime" -> `time`) -- but it is why the
 * gate could not be the answer here.
 *
 * What it costs: all 808 score higher and none lower, 393 of them landing at
 * Mythic or better and 236 at Legend -- "precook", "prearrange" and "preapprove"
 * among them, every one a fold that was right. That is the trade, and it is
 * deliberate: a quietly generous score on a word nobody plays is cheaper than a
 * visible wrong base on one somebody does.
 *
 * Not to be undone per word. The obvious repair is the route REVIEWED_FOLD_START
 * built -- scoped entries in fold-exemptions.json for the wrong bracketings,
 * prefix restored -- and it is the wrong tool here, because it needs exactly the
 * judgement that failed: deciding which "pre-" words carry the prefix cannot be
 * done from the spelling, and doing it by eye produced calls like "precoding"
 * read as coded-in-advance (it is a transmit-side transform) and "prescience"
 * folded onto `science`. Restoring the prefix behind a curated list means
 * standing behind 808 of those readings. If it ever comes back it comes back on
 * the attested table scripts/fold-disagreements.py exists to build, not on a
 * reviewer.
 */
const PRE_PREFIX_END = "2026-09-05";

/*
 * 2026-09-05, the second retirement of that day and the larger one: every
 * borrowed prefix leaves the transparent list -- the classical combining forms
 * ("proto-", "tele-", "mono-", "poly-", "semi-", "auto-", "neo-", "pseudo-",
 * "photo-", "micro-", "macro-", "ultra-", "hyper-", "quasi-") and the Latinate
 * ones alike ("non-", "mis-", "sub-", "post-", "inter-", "super-", "multi-",
 * "trans-"). What is left folding is "counter-", "under-", "anti-", "over-",
 * "out-" and "un-".
 *
 * What separates the prefixes that work from the ones that do not is whether the
 * residue is a word *by construction*. A native prefix attaches to a
 * free-standing English word, so stripping it lands on a word every time and the
 * fold is right every time -- "overcooked" is cooked, "unemployment" is
 * employment, "undercooked" is cooked. A borrowed prefix attaches to a bound
 * stem as readily as to a word, so a residue that is an English word can be a
 * coincidence, and this rule cannot see a coincidence: "protocol" scored as
 * `cole`, "telephony" as `phony`, "semination" as `nation`, "monopodia" as
 * `podium`, "polygala" as `gala`, "prototrophy" as `trophy`, "postface" as
 * `face`, "subsister" as `sister`, "misprised" as `prize`.
 *
 * src/data/bound-residues.json is the same fact already written down. It exists
 * because prefix strips land on fragments that are not words, and the entries
 * are not spread evenly: "auto-" needs 12, "mono-" 12, "poly-" 11, "tele-" 8,
 * "neo-" 7, "photo-" 6, against *none at all* for "un-", "over-", "out-",
 * "under-", "counter-" and "super-". The table catches the fragments that are
 * not words. The five retired here are where the fragments that are words come
 * from, and no table can catch those without deciding word by word which
 * reading is meant -- the judgement PRE_PREFIX_END records as the one not to
 * rely on.
 *
 * What it costs, and it is the largest price any of these changes has carried:
 * 3,746 words score higher and none lower, and with the "pre-" half the day
 * raises 4,554 -- 2,522 landing at Mythic or better and 1,717 at Legend. Most of
 * those folds were right: "subdirector" is a director, "microtones" are tones,
 * "supertitles" are titles, "semiweekly" is weekly. They go because the rule
 * cannot tell them from the coincidences beside them.
 *
 * That is a deliberate trade of one kind of wrong for another. A word scoring
 * generously is a word nobody notices; a word told it is a `sister` or a `cole`
 * is a bug in front of the player. It is also a narrowing of what the fold
 * claims to be -- a rule that reads English compounds, not one that reads Greek
 * and Latin ones. Anything wanting the borrowed prefixes back needs an attested
 * table rather than a reviewer, for the reason PRE_PREFIX_END records.
 *
 * What is left folding is "counter-", "under-", "anti-", "over-", "out-" and
 * "un-": 5,956 words fold on them and not one moves on 2026-09-05, pinned by a
 * test over the whole dictionary rather than on samples. Five of the six are
 * entries src/data/bound-residues.json has never needed a row for. "anti-" is
 * the exception on both counts -- five rows, and borrowed -- and stays because
 * its folds are overwhelmingly ordinary ("antisnob" is a snob, "antiaircraft" is
 * aircraft). The rows say it is the one to watch.
 */
const BORROWED_PREFIX_END = "2026-09-05";

/*
 * 2026-09-10. The bare-stem reading of an "-ed"/"-ing" ending is dropped where
 * English spells that stem's own forms with a doubled consonant: "waning" is
 * `wane`, not `wan`, because "wan" conjugates as "wanning". Nothing but the
 * spelling decides it, and the spelling is decisive -- see `doublingTenseStem`
 * in stem.ts for the rule and the consonants left out of it.
 *
 * `tenseBaseForm` offers both readings of the ending and keeps the more common,
 * which is right where they are rival readings ("bathing" between `bath` and
 * `bathe`) and wrong for this family, where only one of the two is a reading at
 * all. Frequency then picked the wrong one systematically, because a bare CVC
 * monosyllable is almost always the commoner word: "waning" scored as `wan`
 * (3.80 against `wane`'s 2.83), "biting" as `bit`, "themed" as `them` (6.19),
 * "noted" as `not` (6.69), "staring" as `star`, "planing" as `plan`. Every one
 * of them read a word as a form of something it is not, and the cap that
 * followed was the score of an unrelated everyday word.
 *
 * Paired with the silent-"e" reading being a dictionary word, so this only ever
 * *moves* a fold between two spellings of the same ending and never takes the
 * last one a word has. That is what keeps the family's soft edges intact --
 * "busing" (the "s" stems barely double at all) and the misspellings that own no
 * verb ("chating", "fuking") keep the only base they have, and words that are no
 * tense at all keep theirs too ("biped" stays on `bip`, harmless at 0.52 Zipf
 * apart).
 *
 * 181 words were folding onto a stem English would have doubled; none is now.
 * 229 score higher for it and 23 lower. The rises are the point -- a word stops
 * carrying the frequency of a word it is not a form of -- and they are the
 * demote-only discipline's one legitimate shape: a fold pruned, not a score
 * talked up. Twelve reach Mythic and none Legend, every one an obscure verb form
 * whose new cap is its own verb sitting at the measurement floor ("griding" on
 * `gride`, "skiting" on `skite`, "woning" on `wone`); they are listed by name in
 * the test rather than counted.
 *
 * The falls are the second direction finding a pair the misreading had hidden.
 * With "waning" reading as `wan`, the round trip in `inflectedFormFolds` refused
 * to link it to `wane`, so the verb was never capped at its own participle --
 * the `belove`/`beloved` shape that direction exists for. All 23 are that:
 * "wane" at "waning", "stare" at "staring", "nake" at "naked", "dine" at
 * "dining".
 *
 * One wrong pairing comes with it and is answered by review rather than by the
 * rule: "during" is the preposition, not `dure`'s participle, and the new link
 * handed the archaic verb a preposition's frequency (8.87 -> 3.34). It is a
 * reviewed fold exemption, on the `during` side where the misreading is.
 *
 * Dated the day in play rather than the day after it, which is the one deliberate
 * exception to the rule above PREFIX_BASE_START -- the change was wanted in
 * 2026-09-10's puzzle, whose "NIN" drop is where the misreading was found and
 * which reaches 18 of the words that move ("waning" among them). The cost is the
 * one that rule exists to avoid and it was accepted knowingly: a word banked
 * before the deploy keeps the score stored with it (see storage.ts), so a single
 * session on that puzzle can show "waning" at 6.1 and 7.14. It is confined to
 * that one day -- every archived puzzle before it is untouched, and nothing
 * after it can straddle a deploy.
 */
const DOUBLING_TENSE_START = "2026-09-10";

/*
 * 2026-09-27: "counter-" and "anti-" fold whatever the word's own frequency
 * says. The two transparent prefixes come off the MEASURED_FLOOR gate the rest
 * of the list stays behind.
 *
 * Shares MODE_CHOICE_START with the mode switch, the first date a Standard
 * player is choosing the folding system rather than being handed it. Nothing
 * about the switch requires this and nothing here requires the switch; they ride
 * the same cutover because a player meeting the two systems side by side is the
 * moment for the folding one to be at its best, and one date is one explanation.
 *
 * What the gate was doing, and why not here. MEASURED_FLOOR keeps a spelling
 * guess from overruling a real measurement, and for the prefix rule it is the
 * only thing standing between the fold and "preface" -> `face`, "present" ->
 * `sent`, "understand" -> `stand`. That argument is about how many ordinary
 * English words merely *open* with a prefix's letters, and for these two the
 * answer is almost none: above the floor they move 510 curated words, and the
 * readings are the prefix's own -- "counterattack" is an attack (7.37 -> 4.26 on
 * the shown score), "countermeasure" a measure, "antiviral" viral, "antitrust" a
 * trust. The words that merely open that way are wrong *bracketings* rather than
 * frequency coincidences -- "antidote" is not a dote, "antimony" not a money,
 * "antigen" not a gen -- and a frequency gate never saw those either: they are
 * reviewed entries in fold-exemptions.json, scoped to the prefix, and that is
 * the tool REVIEWED_FOLD_START built for exactly this. Eighteen of them were
 * needed for the two prefixes together, against the 510 the rule gets right.
 *
 * The other four transparent prefixes stay gated, and the reason is the same one
 * read the other way: "over-", "out-", "under-" and "un-" *are* the openings of
 * common words ("overt", "outer", "understand", "unit", "uncle"), so ungating
 * them would fold measured words onto bases no player would accept. See
 * `ungatedPrefixBaseCandidates` in stem.ts.
 *
 * The same day the bases widen under it: from CORPUS_ONLY_START the fold prices
 * against the corpus lexicon rather than the curated list, and this rule inherits
 * that like every other -- "antiabortionism" reaches `abortionism`, a word only
 * the corpus carries, and "antichrist" reaches `christ`. Two changes on one date
 * but deliberately separate: this one is about *when* a strip is allowed, that
 * one about what any strip may land on.
 */
const UNGATED_PREFIX_START = MODE_CHOICE_START;

/**
 * Freeform: the rules under which no word folds and every score is the word's
 * own measured frequency.
 *
 * It began as a window in the calendar. The trial ran Monday 2026-09-14 through
 * Sunday the 26th -- a week, then a second one announced on the 20th -- with
 * every player on the same system on the same day, and every puzzle either side
 * of it on the folding system. From MODE_CHOICE_START it is a switch instead:
 * the two systems sit side by side and the player picks, with Standard the
 * default and the choice remembered (see game/mode.ts).
 *
 * The trial's dates are frozen where they are, which is the point of ending it
 * this way rather than extending it again. A puzzle inside the window still
 * plays freeform for everybody whatever the switch says, a puzzle before it
 * still folds, and every score played under the trial keeps the rules it was
 * played with -- the same promise every cutover above makes.
 *
 * Read by scoring (`adjustedZipf`) and by same-root duplicate detection
 * (`evaluateSubmission`), which are the two places the fold is consulted and so
 * the two places this has to reach.
 *
 * Not a rung on the ladder in `scoringFor`, and now permanently not one: the
 * dates above turn a rule on for good because scoring only ever moved forward,
 * and this is a fork rather than a step. So it is asked separately and the rules
 * it skips are left untouched behind it -- see the `folds` flag.
 *
 * The dates live in game/mode.ts and are re-exported here under the names this
 * file has always used. One home, because the scoring side and the record side
 * (which board a day belongs on, which key its progress is saved under) have to
 * agree about which mode a day is in, and a constant with two homes eventually
 * disagrees with itself.
 */
export const FREEFORM_START = FREEFORM_TRIAL_START;
export const FREEFORM_END = FREEFORM_TRIAL_END;

/**
 * Whether `date`'s puzzle is played under the freeform rules -- by the calendar
 * inside the trial window, and by the player's own switch from
 * MODE_CHOICE_START on.
 *
 * An omitted date reads as *not* freeform, unlike everywhere else in this file
 * where it means "the newest system". The difference is deliberate, and it
 * matters more now than it did during the trial: an undated call is the
 * leaderboard pricing somebody else's word, and those have to keep answering the
 * same thing for every reader -- otherwise a stranger's find would reprice
 * itself the moment *you* flipped your own switch. The puzzle itself always
 * knows its own date and passes it.
 *
 * `mode` is the other half of that guarantee, for a caller that has a date and
 * still must not read the switch: the finds feed shows words found in either
 * mode and prices every one of them as Standard (see `parseWords` in
 * game/leaderboard.ts), so it says which mode it wants rather than being handed
 * the reader's. It stands in for the switch only -- a trial-week date is
 * Freeform whatever is passed, because that week was nobody's choice.
 */
export function usesFreeformRules(date?: string, mode?: GameMode): boolean {
  if (date === undefined) return false;
  return freeformForDate(date, mode);
}

/**
 * @deprecated The former name, from when this was a week rather than a mode.
 * Kept so nothing has to change in one commit; new callers say what they mean.
 */
export const isFreeformWeek = usesFreeformRules;

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
 * 2026-09-02, the second of that day's three changes. A word carrying a
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

/*
 * 2026-09-02, the third of that day's three changes. A privative "-less"
 * adjective folds onto the word it is the absence of: "kindless" -> "kind". Its "-lessly"/"-lessness" derivatives come with it,
 * since they already folded onto the adjective through the "-ly"/"-ness" strips
 * ("kindlessness" -> "kindless" -> "kind"). See `privativeBaseCandidates`.
 *
 * The family had no fold rule at all, so 1,224 words were scored as discoveries:
 * "kindless" showed 9.79 Mythic while "kind" showed 3.70, and 751 of the 772
 * "-less" words scored rarer than their own base. 372 of the 1,224 were holding
 * a Mythic-or-better score for the suffix, and none moves up. Ungated by
 * MEASURED_FLOOR like the bound families of DERIVED_BASE_START, which is what
 * reaches them -- "kindless" is measured at Zipf 1.08, just above the gate.
 *
 * Shares 2026-09-02 with SUPERLATIVE_BASE_START and MEASUREMENT_BASE_START --
 * one cutover carrying three independent changes, in the pattern of 2026-08-24
 * -- but kept as its own name so any of them can move later without dragging
 * the others. `scoringFor` ladders a rung per constant, the middle ones stepped
 * over while the dates are equal.
 */
const PRIVATIVE_BASE_START = "2026-09-02";

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
function overrideBase(word: string, scoring: Scoring, date?: string): string | undefined {
  const override = SCORE_OVERRIDES.get(word);
  if (override) {
    if (date !== undefined && date < override.since) return undefined;
    return lexiconHas(override.base, scoring) ? override.base : undefined;
  }
  // Then the review page's file, where a rejection that named a base means the
  // same thing an override does: score this word as that one. See
  // FOLD_REVIEW_VERDICTS for why the two are not one file.
  const verdict = reviewVerdictFor(word, date);
  if (!verdict || verdict.base === null) return undefined;
  return lexiconHas(verdict.base, scoring) ? verdict.base : undefined;
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
function latinPluralsAllowed(word: string, scoring: Scoring): boolean {
  return !lexiconHas(word + "s", scoring);
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
  if (exemption) {
    if (date !== undefined && date < exemption.since) return undefined;
    return exemption;
  }
  // Then the review page's own file. A verdict naming no base is the same
  // finding this table holds -- score the word on its own data -- reached by a
  // different route, so it is answered here rather than given a second code
  // path that could drift from this one.
  const verdict = reviewVerdictFor(word, date);
  if (verdict && verdict.base === null) return { since: verdict.since, reason: verdict.reason };
  return undefined;
}

// -- Reviewed folds from /fold (src/data/fold-review-verdicts.json) ----------
/** One fold judged by hand on the review page and exported by script. */
interface FoldReviewVerdict {
  /**
   * The base the fold should have reached, or null for "this word should not
   * fold at all". The two are different findings and they land in different
   * places -- a base behaves like a `score-overrides.json` entry, a null like a
   * `fold-exemptions.json` one -- which is the whole reason a rejection on the
   * page asks which one is meant.
   */
  base: string | null;
  since: string;
  /** Review notes only -- nothing here reads it. */
  reason?: string;
}

/**
 * The verdicts reached at /fold, kept in their own file rather than merged into
 * the two curated ones.
 *
 * Same effect, different provenance, and the provenance is the point. The
 * curated files are written by hand, one entry at a time, each with a reason
 * somebody composed; this one is written by a script out of a ledger of clicks
 * (scripts/export-fold-rejections.mjs). Both are reviewed judgements and both
 * are shipped the same way, but "who decided this, and how" is the first
 * question anybody asks of a line in a scoring table, and a merged file cannot
 * answer it. Kept apart, the answer is which file the word is in.
 *
 * Read after the curated tables, never over them: a word in both is a review
 * error rather than a tie, and a test pins that it does not happen.
 *
 * Dated per entry like both of them, so a verdict applies from the puzzle it was
 * exported for onward and every archived puzzle keeps the score it showed.
 */
const FOLD_REVIEW_VERDICTS: ReadonlyMap<string, FoldReviewVerdict> = new Map(
  Object.entries(foldReviewVerdictData as Record<string, FoldReviewVerdict>)
);

/** The reviewed verdict in force for `word` under `date`, if any. */
function reviewVerdictFor(word: string, date?: string): FoldReviewVerdict | undefined {
  const verdict = FOLD_REVIEW_VERDICTS.get(word);
  if (!verdict) return undefined;
  if (date !== undefined && date < verdict.since) return undefined;
  return verdict;
}

/**
 * The base a reviewer named for `word` at /fold, where they named one and the
 * lexicon has it.
 *
 * A base the lexicon cannot price is dropped rather than trusted, the same way
 * `overrideBase` drops one -- and the export script and a test both refuse to
 * ship one, so this is a belt on a word the dictionary lost rather than a case
 * anybody expects.
 */
function reviewedFoldBase(word: string, scoring: Scoring, date?: string): string | undefined {
  const verdict = reviewVerdictFor(word, date);
  if (!verdict || verdict.base === null) return undefined;
  return lexiconHas(verdict.base, scoring) ? verdict.base : undefined;
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
  // Whether the fold reads the expansive corpus rather than the curated list
  // when it asks "is this a word" and "how common is it". The one flag that
  // changes where the answer comes from rather than which rule is applied to it
  // -- see CORPUS_ONLY_START.
  corpusLexicon: boolean;
  /**
   * Whether a "-y" adjective built on a stem ending in "l" is read as one,
   * rather than as an adverb the "-ly" rule may strip. Ships with the corpus
   * cutover; see LIQUID_STEM_START.
   */
  liquidStemAdjectives: boolean;
  /**
   * Whether a fold may only land on a form *shorter* than the word played. From
   * MODE_CHOICE_START: with Freeform one switch away, "titty" scored as the
   * commoner "titties" read as Standard marking a word down for nothing the
   * player did. A word is scored as itself unless a shorter common form is
   * underneath it. See SHORTER_FORMS_START.
   */
  shorterFormsOnly: boolean;
  /**
   * Whether an "-s" form is refused as the residue of a *second* inflection --
   * "hears" read out of "hearses", "fines" out of "finessed" -- wherever the
   * silent-"e" reading of the same spelling is a word. See REINFLECTION_START.
   */
  refusesReinflection: boolean;
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
  // Whether a privative "-less" adjective folds onto the word it is the absence
  // of, which is also what carries its "-lessly"/"-lessness" derivatives there
  // (see `privativeBaseCandidates`). Ungated by MEASURED_FLOOR, like the bound
  // families in `derivedBaseCandidates`. 2026-09-02; off for earlier systems so
  // past puzzles' scores stay frozen (see PRIVATIVE_BASE_START).
  privativeBases: boolean;
  // Whether the borrowed prefixes -- the classical combining forms and the
  // Latinate ones, everything but "counter-", "under-", "anti-", "over-",
  // "out-" and "un-" -- are among the transparent prefixes. Reads the other way
  // round like `prePrefixBases` beside it, and retired on the same date: on up
  // to 2026-09-05, off from there (see BORROWED_PREFIX_END).
  borrowedPrefixBases: boolean;
  // Whether the bare-stem reading of an "-ed"/"-ing" ending is dropped where
  // that stem's own forms double their final consonant ("waning" is `wane`, not
  // `wan`), leaving the silent-"e" reading the only one on offer. 2026-09-10;
  // off for earlier systems so past puzzles' scores stay frozen (see
  // DOUBLING_TENSE_START).
  doublingTenseBases: boolean;
  // Whether "counter-" and "anti-" strip whatever the word's own frequency says.
  // The rest of the transparent prefixes stay behind MEASURED_FLOOR. 2026-09-27;
  // off for earlier systems so past puzzles' scores stay frozen (see
  // UNGATED_PREFIX_START).
  ungatedPrefixBases: boolean;
  // Whether this system folds at all. True for every dated system but the
  // freeform window, which skips the fold wholesale and scores each word on its
  // own frequency (see FREEFORM_START). The one flag here that reads as a
  // master switch rather than a rule: the rules it stands in front of are
  // unchanged and untested by it, so turning it back on restores them exactly.
  folds: boolean;
  // Whether "pre-" is one of the transparent prefixes. The only flag here whose
  // answer changes twice: *on* from 2026-08-24 to 2026-09-05, off from there
  // when the prefix was retired, and on again from MODE_CHOICE_START when it
  // came back behind a reviewed table -- because a rule taken away has to keep
  // working for the puzzles it was played on just as one added has to stay off
  // for them, and that holds in both directions (see PRE_PREFIX_END).
  prePrefixBases: boolean;
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
  privativeBases?: boolean;
  prePrefixBases?: boolean;
  borrowedPrefixBases?: boolean;
  doublingTenseBases?: boolean;
  ungatedPrefixBases?: boolean;
  // Defaults to *true*, the other way round from every flag above it, because a
  // fold is not a rule some past system lacked -- it is what scoring has always
  // done. Only the freeform profile passes false. See FREEFORM_START.
  folds?: boolean;
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
    privativeBases = false,
    prePrefixBases = false,
    borrowedPrefixBases = false,
    doublingTenseBases = false,
    ungatedPrefixBases = false,
    folds = true,
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
    privativeBases,
    prePrefixBases,
    borrowedPrefixBases,
    doublingTenseBases,
    ungatedPrefixBases,
    // Every dated profile below predates the corpus cutover and reads the
    // curated index; CORPUS_SCORING is built by spreading the latest one and
    // turning this on.
    corpusLexicon: false,
    liquidStemAdjectives: false,
    shorterFormsOnly: false,
    refusesReinflection: false,
    folds,
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
  prePrefixBases: true,
  borrowedPrefixBases: true,
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
  prePrefixBases: true,
  borrowedPrefixBases: true,
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
  prePrefixBases: true,
  borrowedPrefixBases: true,
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
  prePrefixBases: true,
  borrowedPrefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-02 system with the superlative and the measurement modifiers, but
// not the privative "-less" family -- the next rung of the same ladder, reached
// only if PRIVATIVE_BASE_START is ever moved later than MEASUREMENT_BASE_START.
// See MEASUREMENT_BASE_START.
const MEASUREMENT_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  prePrefixBases: true,
  borrowedPrefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-02 system: all three of that day's changes -- the bare "-est"
// superlative, a measurement modifier scored as the unit it counts, and a
// privative "-less" adjective scored as the word it is the absence of -- with
// "pre-" still folding. See PRIVATIVE_BASE_START.
const PRIVATIVE_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  prePrefixBases: true,
  borrowedPrefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  privativeBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-05 system with "pre-" retired but the borrowed prefixes still
// folding -- the next rung of the ladder, reached only if BORROWED_PREFIX_END
// is ever moved later than PRE_PREFIX_END. While the two dates are equal,
// scoringFor steps straight past it, in the pattern of DERIVED_SCORING.
const PRE_RETIRED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  prePrefixBases: false,
  borrowedPrefixBases: true,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  privativeBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-05 system: the 2026-09-02 folds with "pre-" and every borrowed
// prefix out of the transparent list, leaving "counter-", "under-", "anti-",
// "over-", "out-" and "un-". `prefixBases` stays on -- the prefix fold is
// untouched, twenty-three prefixes shorter -- and the two flags that go off are
// `prePrefixBases` and `borrowedPrefixBases`. See PRE_PREFIX_END and
// BORROWED_PREFIX_END.
const BORROWED_RETIRED_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  prePrefixBases: false,
  borrowedPrefixBases: false,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  privativeBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The 2026-09-10 system: the same folds with one reading taken out of the tense
// rule's hands -- a bare CVC stem whose own forms double their final consonant
// is not a reading of an "-ed"/"-ing" spelling, so "waning" folds onto `wane`
// rather than `wan`. See DOUBLING_TENSE_START. The system every puzzle from that
// date up to the mode switch was played on.
const DOUBLING_SCORING: Scoring = twoBandScoring(9.9, 0, {
  boundBaseForms: true,
  legend: true,
  chainedBaseForms: true,
  inflectionBases: true,
  derivedBases: true,
  inflectionForms: true,
  prefixBases: true,
  prePrefixBases: false,
  borrowedPrefixBases: false,
  paradigmFolds: true,
  prefixResidues: true,
  derivedFormFolds: true,
  superlativeBases: true,
  measurementBases: true,
  privativeBases: true,
  doublingTenseBases: true,
  narrowBands: true,
  scoreCurve: true,
  decadeBands: true,
});
// The latest system (2026-09-27): the same folds with "counter-" and "anti-" off
// the floor gate. See UNGATED_PREFIX_START.
const LATEST_SCORING: Scoring = {
  ...DOUBLING_SCORING,
  ungatedPrefixBases: true,
  // "pre-" folds again, on the same date `ungatedPrefixBases` rides. No profile
  // and no rung of its own, because this is the profile MODE_CHOICE_START
  // already selects, and CORPUS_SCORING is a spread of it. See the note above
  // PRE_PREFIX_END.
  prePrefixBases: true,
};

/**
 * Freeform week: the latest system with the fold switched off.
 *
 * Built by spreading `LATEST_SCORING` rather than by another `twoBandScoring`
 * call, so it cannot drift from it -- the week changes exactly one thing, and
 * the bands, the curve, the labels and the formatting are all still the latest
 * system's. Precomputed rather than spread per call because `scoringFor` is on
 * the drop-scan hot path (`bestWordForDrop` asks it once per dictionary word).
 */
/**
 * The first puzzle whose fold reads the expansive corpus instead of the curated
 * list.
 *
 * The curated list has always been two things at once: the set of words a
 * submission is allowed to be, and the set of words the *fold* is allowed to
 * reach. `corpusVerdict` took the first job away from it -- since
 * MODE_CHOICE_START a word the list never held is playable on the corpus's own
 * evidence -- but the second stayed, and it is the one that shows. A corpus word
 * folds "unmasticated" onto a base only if that base happens to be one of the
 * 225,483, so `rarityForUncurated` says plainly what it cannot do: "it cannot
 * fold onto a base that is itself uncurated, because every link is priced out of
 * the index". An uncurated base leaves the derivation scoring as itself, which
 * is to say scoring on the fact that nobody writes it -- a Legend for a suffix.
 *
 * From here the fold asks the corpus instead: 1.2M headwords, a lexicon source
 * behind each one, and a waterfall Zipf of its own. Every rule is the rule it
 * already was. What changes is only the list the rules are applied to, which is
 * why this is a lexicon flag on the profile rather than a new fold.
 *
 * Dated like every other cutover here, and for the same reason: the corpus
 * prices a curated word slightly differently (zipf.bin quantises to 1/32, while
 * rarity.json carries hundredths) and reaches bases the curated fold never
 * could, so every score it touches would move. An archived puzzle plays as it
 * was played.
 *
 * Shares MODE_CHOICE_START with the mode switch, the ungated prefixes and the
 * restored "pre-". It had a day of its own to begin with, on the argument that
 * the two questions are separate -- the prefixes are about *when* a strip is
 * allowed, this is about what any strip may land on -- and that separation is
 * still worth explaining, just not worth a date. What settled it is that the two
 * halves of this cutover had already been split across it: `corpusVerdict` makes
 * a word the curated list never held playable from MODE_CHOICE_START, while the
 * fold could not price against a corpus base until the day after. For one puzzle
 * a player could submit "unmasticated" and have it scored as though nothing in
 * the language were related to it. One date closes that, and one date is one
 * explanation.
 */
const CORPUS_ONLY_START = MODE_CHOICE_START;

/**
 * The day "scowly" stopped being a kind of scow: MODE_CHOICE_START, with the
 * mode switch and the corpus cutover.
 *
 * A *consequence* of that cutover rather than a thing of its own: the "-ly"
 * strip has always been
 * able to misread a "-y" adjective on an l-final stem, and it was harmless while
 * the fold priced against 225k curated words that held neither "scow" nor "jow".
 * The 1.2M-word lexicon holds both, and with them "howly" -> "how" (7.45 points),
 * "growly" -> "grow", "prowly" -> "prow", "jowly" -> "jow". See
 * `scoringBaseForm` for the rule and why it fires only where both readings are
 * words.
 *
 * It had a date of its own for a while, four days after the cutover, to keep
 * one number in corpus-lexicon.test.ts clean: that the corpus moves far more
 * words down than up, with promotions under a fortieth of the demotions. This
 * rule and the audit's exemptions are *all* promotions -- that is what fixing a
 * wrong fold is -- so landing them on the cutover's date takes that ratio from
 * 1:125 to about 1:4.
 *
 * The four days were the cost of that tidiness, and they were the wrong thing to
 * spend: for four puzzles the corpus lexicon was live and the fixes for what it
 * broke were not, so a player could be shown "howly" scored as "how". A guard
 * exists to catch a change nobody meant to make. Both of these were meant, both
 * are reviewed, and both are named in fold-exemptions.json. The guard now
 * counts the two separately rather than refusing the sum -- see its note.
 */
export const LIQUID_STEM_START = MODE_CHOICE_START;

/**
 * The first puzzle on which Standard only ever rescores a word *down* to a
 * shorter form: MODE_CHOICE_START, with the mode switch.
 *
 * The fold runs in both directions from 2026-08-24 (see `inflectedFormFolds`
 * and `derivedFormFolds`), so a word could be capped at a longer, commoner
 * member of its family: "titty" at "titties", "abaci" at "abacus". That was
 * defensible while everyone played one system. With the mode switch, the same
 * word reads at two prices a tap apart, and the Standard one is lower because
 * of a word the player did not play. So from here a word is scored as itself
 * unless a shorter common form is underneath it.
 *
 * The walk itself is unchanged, and still passes through longer forms on the way
 * to a shorter one ("semiweekly" through "semiweeklies" to "weekly"). Only
 * the winner is restricted. The freeform trial sits under this date and folds
 * nothing, so the first puzzle it can reach is one nobody has played yet.
 */
export const SHORTER_FORMS_START = MODE_CHOICE_START;

/**
 * The first puzzle on which Standard stops reading a word as an inflection of
 * an inflection: 2026-10-04, a Sunday, so it arrives with the weekly reset.
 *
 * English inflects a word once. "hearses" is `hearse` + "-s"; read as `hears` +
 * "-es" it becomes a plural of a third-person verb, and the walk then takes
 * `hears` on to `hear`, so a Rare word displayed Very Common and the player was
 * told it scored as "hear". The same misread runs through the doubled-consonant
 * trim of "-ed"/"-ing": "finessed" lost its "-ed", trimmed "finess" to `fines`,
 * and scored as `fine`. "lapses" went to `lap`, "cleanses" to `clean`, "corpses"
 * to `corp`. The corpus lexicon made it worse, because it can reach more of
 * those bases.
 *
 * See `reinflectedResidue` for the rule. Standard only: Freeform folds nothing.
 */
export const REINFLECTION_START = "2026-10-04";

/**
 * The corpus era: the latest fold, reading the expansive corpus.
 *
 * Spread from `LATEST_SCORING` rather than built by another `twoBandScoring`
 * call, for the reason `FREEFORM_SCORING` is -- the era changes exactly one
 * thing and must not drift from the system it changes it in.
 */
const CORPUS_SCORING: Scoring = {
  ...LATEST_SCORING,
  corpusLexicon: true,
  // See LIQUID_STEM_START, which is this same date: the "-ly" strip keeps a
  // stem's l from the day the corpus makes it possible to lose one.
  liquidStemAdjectives: true,
  // See SHORTER_FORMS_START, also this date.
  shorterFormsOnly: true,
};

/** The corpus era from REINFLECTION_START: one rule refused, nothing else moved. */
const REINFLECTION_SCORING: Scoring = { ...CORPUS_SCORING, refusesReinflection: true };

const FREEFORM_SCORING: Scoring = { ...LATEST_SCORING, folds: false };

/** The corpus era's freeform half: the fold off, the lexicon still the corpus. */
const CORPUS_FREEFORM_SCORING: Scoring = { ...CORPUS_SCORING, folds: false };

const LEGACY_SCORING: Scoring = {
  folds: true,
  corpusLexicon: false,
  liquidStemAdjectives: false,
  shorterFormsOnly: false,
  refusesReinflection: false,
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
  privativeBases: false,
  doublingTenseBases: false,
  prePrefixBases: false,
  borrowedPrefixBases: false,
  ungatedPrefixBases: false,
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

function scoringFor(date?: string, mode?: GameMode): Scoring {
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
  // Three rungs for 2026-09-02, laddered like the pair for 2026-08-24 so any one
  // change can move to a later date without dragging the others. While the dates
  // are equal the middle rungs are stepped over.
  if (date < MEASUREMENT_BASE_START) return SUPERLATIVE_SCORING;
  if (date < PRIVATIVE_BASE_START) return MEASUREMENT_SCORING;
  // The two rungs that turn a rule *off* rather than on, so the profiles below
  // them are the fuller ones: every prefix retired on 2026-09-05 folded for the
  // systems from 2026-08-24 up to here. Laddered a rung per constant like the
  // 2026-08-24 and 2026-09-02 groups, the middle one stepped over while the
  // dates are equal. See PRE_PREFIX_END and BORROWED_PREFIX_END.
  if (date < PRE_PREFIX_END) return PRIVATIVE_SCORING;
  if (date < BORROWED_PREFIX_END) return PRE_RETIRED_SCORING;
  if (date < DOUBLING_TENSE_START) return BORROWED_RETIRED_SCORING;
  // The one rung asked as a range rather than a threshold: the freeform trial is
  // a window, and the puzzles after it are back on the system before it. Asked
  // last so it reads as what it is -- the latest system with one switch thrown --
  // and so a later cutover slots in above it without thinking about the week.
  if (date >= CORPUS_ONLY_START) {
    // Freeform folds nothing, so the liquid-stem rule cannot reach it and the
    // era's two profiles collapse to one on that side.
    if (usesFreeformRules(date, mode)) return CORPUS_FREEFORM_SCORING;
    // One date for the era: LIQUID_STEM_START is this same date, so every
    // profile this branch can reach carries the "-ly" rule and it needs no rung
    // of its own. REINFLECTION_START is later and gets one.
    if (date >= REINFLECTION_START) return REINFLECTION_SCORING;
    return CORPUS_SCORING;
  }
  if (usesFreeformRules(date, mode)) return FREEFORM_SCORING;
  // Below the freeform fork rather than above it, unlike every rung before it.
  // The fork is a range and this is a threshold, and the trial week sits *under*
  // this date: asked first, the rung would answer DOUBLING_SCORING for the
  // window's own dates and the trial would quietly start folding again.
  if (date < UNGATED_PREFIX_START) return DOUBLING_SCORING;
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
 * The rejection reasons a puzzle waives -- the ones that refuse a real word for
 * the kind of word it is rather than for not being one.
 *
 * Three sets. Before MODE_CHOICE_START the date picks one; from it the mode
 * does, and this is the one rule the two modes disagree on besides scoring.
 *
 * Before the trial, nothing was waived: a word filed as a proper noun or an
 * abbreviation was refused, full stop.
 *
 * The trial week waived six. A player reaching for "thou" or "NASA" was playing
 * the language as they found it, and a week about playing however you want had
 * no business telling them which register was allowed.
 *
 * From the choice date Freeform keeps all six and Standard waives three. The
 * names and abbreviations stay playable in both because the trial settled that
 * question: they refuse words that are alive and ordinary and merely filed
 * under a category, which is a rule about paperwork rather than about English.
 * "NASA" is a word people say. The age trio -- obsolete, archaic, dated -- is
 * back in force for Standard, because on the ranked board a word nobody has
 * used since 1650 is a lookup rather than a find. Freeform is not ranked (see
 * `isRanked` in game/mode.ts), so it has nothing to protect by refusing them,
 * and "playing however you want" still means reaching for "thou".
 *
 * Two reasons were never waived by any of them, and the line between them and
 * these is the one the curation rules already draw: a spelling of *another* word
 * is not a word somebody wants to play, it is a mistake, and letting it through
 * would score a typo as a deep-tail find -- "recieve" is not a bolder way to
 * play "receive". "not-a-word" is the same objection stated outright.
 *
 * Words absent from the curated dictionary altogether are untouched by this and
 * still go to the live lookup: a waiver widens which *words* are playable, not
 * what counts as one.
 *
 * Every set is kept rather than replaced, for the reason every scoring cutover
 * in this file is kept: a puzzle plays exactly as it played, so a word accepted
 * on the 18th is still accepted if somebody opens that day from the archive, and
 * one refused in August is refused there still.
 */
const NO_WAIVED_REJECTIONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>();

const FREEFORM_WAIVED_REJECTIONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "obsolete",
  "archaic",
  "dated",
]);

const NAME_WAIVED_REJECTIONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
]);

/**
 * Which set `date`'s puzzle is playing under.
 *
 * Freeform -- the trial week, or the player's choice from MODE_CHOICE_START --
 * waives all six; Standard waives the names from the choice date and nothing
 * before it. An undated call waives nothing: that is the leaderboard and the
 * finds feed pricing somebody else's word, which is not a submission being
 * judged -- there is nothing there to waive.
 */
function waivedRejectionsFor(date?: string): ReadonlySet<RejectionReason> {
  if (date === undefined) return NO_WAIVED_REJECTIONS;
  if (freeformForDate(date)) return FREEFORM_WAIVED_REJECTIONS;
  return date >= MODE_CHOICE_START ? NAME_WAIVED_REJECTIONS : NO_WAIVED_REJECTIONS;
}

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
  const reason = reviewedRejection(word, date);
  if (reason === undefined) return undefined;
  if (waivedRejectionsFor(date).has(reason)) return undefined;
  return reason;
}

/**
 * Whether `date`'s puzzle waives `reason` outright -- the question
 * `curatedRejection` answers for itself, exposed for the *other* rejection
 * source.
 *
 * src/data/rejection-metadata.json classifies about 107,000 words that never
 * made the curated dictionary, and submit.ts reads it to explain a refusal. A
 * category from that file is final in a way a curated rejection is not: it
 * short-circuits the live Merriam-Webster lookup, because normally there is
 * nothing to check -- the game has already decided the word's kind is
 * unplayable. During the week that reasoning is inverted, and a word refused for
 * its register has to be allowed to prove itself like any other unknown word.
 */
export function waivesRejectionReason(reason: RejectionReason, date?: string): boolean {
  return waivedRejectionsFor(date).has(reason);
}

/**
 * The waived reasons worth saying out loud when a word is accepted: the three
 * about a word's *age*.
 *
 * "Obsolete, but accepted" is a small fact about the word -- it tells a player
 * they have reached for something out of use and the week let it stand, which is
 * the kind of thing the week is for. "Acronym, but accepted" is not a fact about
 * the word so much as a category it was filed under, and reading it on every
 * initialism would be noise. The other three waived reasons stay silent for the
 * same reason: nobody needs telling that "NASA" is a name.
 */
const NOTED_WAIVERS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "obsolete",
  "archaic",
  "dated",
]);

/**
 * The reason a word *would* have been refused for, on a week that is letting it
 * through anyway -- so the acceptance can say which rule it is standing on
 * ("'tabacco' is obsolete, but accepted"). Undefined for a word that needed no
 * waiver, outside the week for every word, and for the waived reasons that are
 * not worth a player's attention (see NOTED_WAIVERS).
 *
 * The other half of `curatedRejection` rather than a second reading of the data:
 * the two split one verdict between them, and a word is refused by that function
 * or explained by this one, never both.
 */
export function waivedRejection(word: string, date?: string): RejectionReason | undefined {
  const reason = reviewedRejection(word, date);
  if (reason === undefined || !waivedRejectionsFor(date).has(reason)) return undefined;
  return NOTED_WAIVERS.has(reason) ? reason : undefined;
}

/**
 * The reviewed verdict on a word under `date`, before the week has any say in
 * it. Two lists, and the hand-written one is asked first.
 */
function reviewedRejection(word: string, date?: string): RejectionReason | undefined {
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
// The date the same-root rule stopped reading an "-ed"/"-ing" ending as a stem
// English would have doubled, so "waning" keys on `wane` rather than on `wan`
// (see `refusedTenseStem`). Its own constant rather than a reuse of the scoring
// cutover on the same day: scoring a word as its base has never been a claim
// that a puzzle may hold only one of them, and the two rules have moved
// separately every time so far. Gated on the puzzle date like the widening
// above, so an archived drop keeps the verdicts it was played with.
const SAME_ROOT_DOUBLING_START = "2026-09-10";

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

/**
 * The one spelling an "-es" ending does *not* offer as a base: the two-letter
 * strip, where the stem could not have taken "-es" in the first place and the
 * one-letter strip is a dictionary word. "banes" is `bane` + "-s"; `ban` would
 * have written "bans", so `ban` is not a reading of this spelling at all.
 *
 * English writes "-es" onto a sibilant and "-s" onto everything else, so the
 * stem's last letter decides it: "s", "x", "z" and "h" take the ending
 * ("glasses", "boxes", "buzzes", "churches"), and so do the "-o" and "-i" words
 * that keep a vowel before it ("goes", "heroes", "taxies"). Every other letter
 * is a strip English never produces -- and the two-letter strip is offered
 * unconditionally, so frequency picked it wherever the residue happened to be a
 * word, which for a CVC monosyllable it usually is: "bites" keyed on `bit`,
 * "banes" on `ban`, "cares" on `car`, "hopes" on `hop`.
 *
 * The same conservatism as `refusedTenseStem`: only refused where the one-letter
 * strip is itself a word, so this moves a reading between two spellings of one
 * ending and never leaves a word with no base at all.
 *
 * `impossibleNumberBase` in stem.ts is this rule for the single case of "-ees",
 * written when it was the only one anybody had traced ("advisees" is the plural
 * of `advisee`, never an "-es" form of `advise`). This generalises it, and the
 * old predicate stays as it is because it runs for archived puzzles too.
 *
 * Duplicate detection only, and permanently so. Scoring reaches the same nine
 * worst folds through reviewed fold exemptions (`bares` -> `bar`, `stares` ->
 * `star`, `fares` -> `far` and six more), and retiring those in favour of this
 * rule was tried and abandoned: the rule is a rule about *modern* spelling, and
 * "-es" was the regular ending in Early Modern English, which this dictionary
 * carries hundreds of spellings from. On the fold it promoted 613 words, 106 to
 * Mythic or better and 29 to Legend, because it cut every one of those off the
 * everyday word it is a spelling of: "yeares" 2.98 -> 9.69 as `yeare` rather
 * than `year`, "workes" -> `worke`, "lookes" -> `looke`, "breakes" 4.13 -> 9.65.
 * 60 words went from a Zipf-4-or-commoner cap to a sub-2 base.
 *
 * Nothing in the letters separates those from the nine: `bare`/`bar` and
 * `yeare`/`year` are the same shape, one a different word and one a variant
 * spelling, so this family is review's to keep. What makes the same rule safe
 * here is the asymmetry this file's same-root section is built on -- a key's
 * mistake refuses a legitimate word, so the leak a wrong refusal-of-a-reading
 * costs is the cheaper error; a fold's mistake is a score, and handing an
 * archaic spelling of `year` a Mythic is not cheap. See same-root-cases.md.
 */
export function refusedEsStem(word: string): string | undefined {
  const w = word.toLowerCase();
  if (w.length <= 4 || !w.endsWith("es")) return undefined;
  const stem = w.slice(0, -2);
  if (/[sxzhoi]$/.test(stem)) return undefined;
  return WORD_INDEX.has(w.slice(0, -1)) ? stem : undefined;
}

/** Whether the widened same-root inflections apply to `date`'s puzzle. */
export function sameRootInflectionsActive(date?: string): boolean {
  return date === undefined || date >= SAME_ROOT_INFLECTION_START;
}

/**
 * Whether `date`'s puzzle refuses the doubling stem as a same-root key (see
 * SAME_ROOT_DOUBLING_START).
 */
export function sameRootDoublingActive(date?: string): boolean {
  return date === undefined || date >= SAME_ROOT_DOUBLING_START;
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

export function rarityFor(
  word: string,
  date?: string,
  mode?: GameMode
): RarityInfo | undefined {
  const normalized = word.toLowerCase();
  const i = WORD_INDEX.get(normalized);
  if (i === undefined) return undefined;
  const scoring = scoringFor(date, mode);
  const zipf = adjustedZipf(normalized, scoring.zipfAt(i), scoring, date);
  return { rarity: scoring.rarity(zipf), zipf };
}

/**
 * `rarityFor` for a word the curated list has never heard of, scored from a
 * frequency the caller brings -- the corpus's waterfall Zipf, or the unattested
 * sentinel when no corpus counts it (see corpusVerdict in submit.ts).
 *
 * The fold is the whole point of routing these through here rather than reading
 * the Zipf straight off the corpus. A corpus word is far more likely than a
 * curated one to be a mechanical derivation nobody has bothered to write down --
 * "unmasticated", "coevaporating", "remarketable" -- and a derivation scored on
 * its own frequency is scored on the fact that it is unwritten, which is how an
 * ordinary base word turns into a Legend by growing a suffix. Everything the
 * fold knows applies unchanged: the chain walks the same rules, caps against the
 * same curated bases, and can only ever make a word *more* common.
 *
 * What it cannot do is fold onto a base that is itself uncurated, because every
 * link is priced out of the index (see `zipfFor`). That is a ceiling on how much
 * this helps, not a wrong answer: an unfound base leaves the word scoring as
 * itself, exactly as it would have without the call.
 *
 * Freeform week reaches this too and gets its own frequency back untouched,
 * because `adjustedZipf` returns early when the profile does not fold -- the one
 * behaviour the trial week was about.
 */
export function rarityForUncurated(word: string, ownZipf: number, date?: string): RarityInfo {
  const normalized = word.toLowerCase();
  const scoring = scoringFor(date);
  const zipf = adjustedZipf(normalized, ownZipf, scoring, date);
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

  // Nothing folded, so there is no substitution to report and the "Scored as its
  // common form" note stays off for the week -- the score on screen really is
  // the word's own (see FREEFORM_START).
  if (!scoring.folds) return undefined;

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

  const override = overrideBase(normalized, scoring, date);
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
 * One family of affixes the fold can read through, as it is shown to a player.
 *
 * `example` is a word that really folds this way today, and the test beside
 * this function runs every one of them through `baseFormSubstitution` -- an
 * explanation of the scoring that names a fold the scoring does not make is
 * worse than no explanation, and these are exactly the claims that rot as
 * families are added and retired.
 */
export interface FoldAffixGroup {
  /** What the affixes have in common, in a player's words. */
  title: string;
  /** The affixes themselves, written the way they are read: "-ness", "over-". */
  affixes: string[];
  /** A word this family folds, and the form it is scored as. */
  example: { word: string; base: string };
}

/**
 * The affixes that can rescore a word to its common form on `date`, grouped for
 * the "more info" panel behind the note (see components/GuessLog.tsx).
 *
 * Date-scoped like everything else here, because the set has moved twice and
 * archived puzzles still play under the set they had: "pre-" and the borrowed
 * prefixes folded until 2026-09-05 (see PRE_PREFIX_END, BORROWED_PREFIX_END),
 * and a panel that describes today's rules while the player is looking at a
 * score from August explains the wrong fold.
 *
 * The prefix rows are derived from stem.ts's own tables, so a prefix cannot be
 * retired from the scoring and left behind in the copy. The suffix rows cannot
 * be -- those endings live in the branch conditions of the candidate
 * generators rather than in a list -- so each row names the generator that owns
 * it and the two have to move together, the same lockstep the Python mirror in
 * scripts/manage-extra-word.py is kept in.
 *
 * Returns nothing when the fold is off entirely (freeform week), where there is
 * no note to explain in the first place. `mode` defaults to the player's
 * setting; How to play passes "standard", since its link is about Standard
 * whichever mode the player is on.
 */
export function foldAffixGroups(
  date?: string,
  mode?: GameMode,
): FoldAffixGroup[] {
  const scoring = scoringFor(date, mode);
  if (!scoring.folds) return [];

  const groups: FoldAffixGroup[] = [];
  // `baseForm` and `inflectionalBaseCandidates`.
  groups.push({
    title: "Plurals, tenses and participles",
    affixes: ["-s", "-es", "-ies", "-ed", "-ied", "-ing"],
    example: { word: "hurrying", base: "hurry" },
  });
  // `foreignPluralCandidates` -- the plurals English took with the noun.
  groups.push({
    title: "Plurals from Latin, Greek and French",
    affixes: ["-ae", "-ices", "-ves", "-men", "-es"],
    example: { word: "wolves", base: "wolf" },
  });
  // The transparent suffixes in `scoringBaseForm`.
  groups.push({
    title: "Adverbs and quality nouns",
    affixes: ["-ly", "-ness"],
    example: { word: "sparsely", base: "sparse" },
  });
  if (scoring.derivedBases) {
    groups.push({
      title: "Endings only ever built by adding them",
      affixes: ["-ically", "-ably", "-ibly", "-ologist", "-cked", "-cking", "-eaux"],
      example: { word: "mythologist", base: "mythology" },
    });
  }
  if (scoring.boundBaseForms) {
    groups.push({
      title: "Nouns built from a verb or an adjective",
      affixes: ["-ization", "-isation", "-ability", "-ibility"],
      example: { word: "readability", base: "readable" },
    });
  }
  if (scoring.superlativeBases) {
    groups.push({
      title: "Comparatives and superlatives",
      affixes: ["-er", "-est", "-ier", "-iest"],
      example: { word: "sparsest", base: "sparse" },
    });
  }
  if (scoring.privativeBases) {
    groups.push({
      title: "Without the thing",
      affixes: ["-less"],
      example: { word: "penniless", base: "penny" },
    });
  }
  // `unmeasuredBaseCandidates`: the families that run on rare words only.
  groups.push({
    title: "Verbs and adjectives made from a noun",
    affixes: ["-ize", "-ise", "-able", "-ible"],
    example: { word: "tautologize", base: "tautology" },
  });
  if (scoring.prefixBases) {
    groups.push({
      title: "Prefixes",
      affixes: transparentPrefixes({
        pre: scoring.prePrefixBases,
        borrowed: scoring.borrowedPrefixBases,
      }).map((prefix) => `${prefix}-`),
      // The chain carries it past "planned" to "plan", which is the fold
      // working as intended and worth showing: a prefix strip is one hop of
      // several, not the whole answer.
      example: { word: "overplanned", base: "plan" },
    });
  }
  if (scoring.measurementBases) {
    groups.push({
      title: "How many of the unit",
      affixes: measurementPrefixes().map((prefix) => `${prefix}-`),
      example: { word: "kilojoules", base: "joules" },
    });
  }
  return groups;
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
 * The band the revealed word has to land in. A perfect 10.00 is almost always a
 * word no corpus attests -- exactly the kind nobody takes away from the puzzle
 * -- so the reveal aims below it, at rarities a player can plausibly learn and
 * then actually use.
 *
 * The floor is 8.0 rather than 9.0 because that is where the vocabulary
 * actually lives. Held at 9.0 the reviewed list reached 483 of the 1,055 drops;
 * at 8.0 it reaches all but four of them, and `palimpsest`, `soporific` and
 * `defenestration` become revealable instead of being filtered out for the
 * crime of appearing in books.
 */
const LEARNABLE_MIN_SCORE = 8.0;
const LEARNABLE_MAX_SCORE = 9.9;

/**
 * The reviewed vocabulary the reveal draws from first: words worth carrying
 * away, hand-picked rather than mined, because nothing in the frequency data
 * separates `persnickety` from `gastroduodenal` -- both are equally unwritten,
 * and only one is worth a player's memory.
 *
 * Words the frequency data cannot reach are simply absent, and words too
 * common to land in the band sit here unused until a rarity refresh moves them,
 * which is why the list is longer than the set that can be revealed today.
 *
 * Not dated like the scoring tables. The reveal is a suggestion rather than a
 * score, so growing this list may change what an archived puzzle reveals, and
 * that costs the player nothing.
 */
const REVEAL_WORDS: readonly string[] = revealWordData.words;

/**
 * Glosses for the reviewed words, written for the reveal rather than lifted
 * from a dictionary: what the word means, said plainly enough that a player who
 * has never seen it could go and use it. They sit behind a toggle, so clarity
 * wins over brevity every time -- a gloss runs as long as the word needs, gives
 * the second sense where the word has one, and never leaves a bare synonym to
 * trade one unfamiliar word for another ("a spittoon", "stinking"). Where the
 * plainest word for the thing is itself rare, the gloss says what the thing is
 * as well ("a spittoon: a pot kept on the floor to spit tobacco juice into").
 * No part-of-speech labels -- the gloss's own shape carries that ("a jumbled
 * medley", "to speak at length"), which reads better under a word the player
 * just met.
 *
 * Every reviewed word has one, and a test holds the two files to that.
 */
const REVEAL_DEFINITIONS: Readonly<Record<string, string>> = revealDefinitionData;

/** The one-line gloss for a reviewed word, or undefined for anything else. */
export function definitionFor(word: string): string | undefined {
  return REVEAL_DEFINITIONS[word.toLowerCase()];
}

/**
 * The word revealed once the puzzle is done: a reviewed word from REVEAL_WORDS
 * that `drop` reaches and that scores inside the band, rarest first, since every
 * one of them has already been judged worth learning.
 *
 * Same containment and rejection rules as `bestWordForDrop`, but the pick runs
 * the other way -- down from the ceiling, into the range a player can hold on
 * to. When the drop reaches no reviewed word the reveal falls back to that
 * ceiling word, which is what it always showed.
 *
 * The fallback is deliberately the ceiling and not the best unreviewed word in
 * the band. Mining the band by frequency alone returns forms of other words,
 * lab vocabulary and, twice in a sample of forty, a slur -- nothing in the data
 * tells those apart from `persnickety`. The band is tested on the shown score,
 * not the raw one, so a reviewed reveal never prints a number outside the range
 * it promises.
 */
export function learnableWordForDrop(drop: string, date?: string): AcceptedWord | undefined {
  const needle = drop.toLowerCase();
  const scoring = scoringFor(date);
  let reviewed: AcceptedWord | undefined;
  for (const word of REVEAL_WORDS) {
    if (word === needle || !word.includes(needle)) continue;
    if (curatedRejection(word, date) !== undefined) continue;
    const info = rarityFor(word, date);
    if (!info) continue;
    const shown = Number(scoring.format(scoring.score(info.zipf)));
    if (shown < LEARNABLE_MIN_SCORE || shown > LEARNABLE_MAX_SCORE) continue;
    if (!reviewed || info.zipf < reviewed.zipf) reviewed = { word, ...info };
  }
  return reviewed ?? bestWordForDrop(drop, date);
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
  // Freeform week: the word's own frequency, full stop. Returned before any rule
  // below is consulted -- including the reviewed overrides, which are decisions
  // about which base a word folds onto and have nothing to say once nothing
  // folds. Every rule below is left exactly as it is; this is the whole of the
  // change (see FREEFORM_START).
  if (!scoring.folds) return zipf;

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
  const override = overrideBase(word, scoring, date);
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
function chainedBase(
  word: string,
  scoring: Scoring,
  date?: string,
  trace?: Map<string, FoldHop>
): ChainedBase | undefined {
  const seen = new Set([word]);
  let frontier = [word];
  let best: ChainedBase | undefined;
  // The word's own frequency, so the reverse fold can skip a form that could not
  // beat it -- see the `floor` argument to `inflectedFormFolds`.
  const own = lexiconHas(word, scoring) ? zipfFor(word, scoring) : -Infinity;
  // Whether a form the walk reached may be what the word scores as. From
  // SHORTER_FORMS_START only a shorter one may; the walk still passes through
  // the rest on its way.
  const eligible = (form: string) =>
    !scoring.shorterFormsOnly || form.length <= word.length;

  for (let depth = 0; depth < MAX_FOLD_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const current of frontier) {
      // A base named by hand at /fold ends the chain here.
      //
      // Not merely the next hop, which is what an ordinary override is: the walk
      // carries on from an override's base and keeps the most common word it
      // reaches, so "timelessly -> timeless" would be read, followed to "time",
      // and the reviewer's answer thrown away -- the fold they rejected,
      // restored by the rule that was supposed to have been overruled. A
      // recommendation is not a hint about where to look next. It is the whole
      // answer to what this word scores as, so it is taken and the walk stops.
      const reviewed = reviewedFoldBase(current, scoring, date);
      if (reviewed) {
        const zipf = zipfFor(reviewed, scoring);
        if (trace && !trace.has(reviewed)) {
          trace.set(reviewed, { from: current, to: reviewed, rule: "base", zipf });
        }
        if (eligible(reviewed) && (!best || zipf > best.zipf)) best = { base: reviewed, zipf };
        continue;
      }
      for (const candidate of nextBaseForms(current, scoring, date)) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        next.push(candidate);
        const zipf = zipfFor(candidate, scoring);
        trace?.set(candidate, { from: current, to: candidate, rule: "base", zipf });
        if (eligible(candidate) && (!best || zipf > best.zipf)) best = { base: candidate, zipf };
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
        if (trace && !trace.has(form)) {
          trace.set(form, { from: current, to: form, rule: "derived-form", zipf });
        }
        if (eligible(form) && (!best || zipf > best.zipf)) best = { base: form, zipf };
      }
      for (const form of inflectedFormFolds(
        current,
        scoring,
        date,
        Math.max(own, best ? best.zipf : -Infinity)
      )) {
        const zipf = zipfFor(form, scoring);
        if (trace && !trace.has(form)) {
          trace.set(form, { from: current, to: form, rule: "inflected-form", zipf });
        }
        if (eligible(form) && (!best || zipf > best.zipf)) best = { base: form, zipf };
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
            trace?.set(above, { from: form, to: above, rule: "base", zipf: aboveZipf });
            if (eligible(above) && (!best || aboveZipf > best.zipf)) {
              best = { base: above, zipf: aboveZipf };
            }
          }
        }
      }
    }
    frontier = next;
  }
  return best;
}

/** One link of a fold chain: what folded onto what, and which direction did it. */
export interface FoldHop {
  from: string;
  to: string;
  /**
   * Which of `chainedBase`'s three directions produced the hop -- a rung above
   * the word ("base"), or one of the two reverse folds the word is merely capped
   * at. Deliberately not the *affix*: naming the suffix means re-asking every
   * generator in stem.ts which of them could have made this pair, and that is an
   * audit's question, not the walk's. The walk knows the shape; `scripts/
   * fold-audit` asks stem.ts for the name.
   */
  rule: "base" | "derived-form" | "inflected-form";
  zipf: number;
}

/** A resolved fold, with the path the walk actually took to its winner. */
export interface FoldTrace {
  word: string;
  /** The word's own frequency, before anything folded. */
  ownZipf: number;
  /** The most common word the chain reached -- what the score was taken from. */
  base: string;
  baseZipf: number;
  /** `word` -> ... -> `base`, one entry per link. */
  path: FoldHop[];
}

/**
 * `chainedBase`, with its working shown: the winning base *and* the links that
 * reached it.
 *
 * This exists for auditing rather than for play, which is why it is a second
 * entry point instead of a richer return from `chainedBase` -- the walk runs on
 * every submission, and the map it fills here is pure overhead for a player.
 * Passing `trace` is the only cost the hot path pays, one optional-chain per
 * candidate.
 *
 * Unlike `baseFormSubstitution` it does not require a curated word. A corpus-only
 * derivation is precisely the case an audit cares about -- since CORPUS_ONLY_START
 * most folds have a base the curated list never held -- and `zipfFor` already
 * prices both kinds, so there is nothing to gate on.
 *
 * Returns undefined when nothing folds, or when the fold did not beat the word's
 * own frequency: a fold is a cap, so a base rarer than the word changes no score
 * and is not worth reporting.
 */
export function foldTrace(word: string, date?: string): FoldTrace | undefined {
  const normalized = word.toLowerCase();
  const scoring = scoringFor(date);
  if (!scoring.folds || !scoring.chainedBaseForms) return undefined;
  if (!lexiconHas(normalized, scoring)) return undefined;

  const ownZipf = zipfFor(normalized, scoring);
  const trace = new Map<string, FoldHop>();
  const chained = chainedBase(normalized, scoring, date, trace);
  if (!chained || chained.zipf <= ownZipf) return undefined;

  // Back to front along the parent edges, then reversed. Each node was recorded
  // the first time the walk reached it and never again, so the edges form a tree
  // and this terminates -- but the walk is over data, so the guards are cheap
  // insurance rather than a claim about the current rules.
  const path: FoldHop[] = [];
  const walked = new Set<string>();
  let cursor = chained.base;
  while (cursor !== normalized && path.length <= MAX_FOLD_DEPTH * 2) {
    if (walked.has(cursor)) break;
    walked.add(cursor);
    const hop = trace.get(cursor);
    if (!hop) break;
    path.push(hop);
    cursor = hop.from;
  }
  path.reverse();

  return { word: normalized, ownZipf, base: chained.base, baseZipf: chained.zipf, path };
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

  const override = overrideBase(word, scoring, date);
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
  addInflectionalBaseForms(word, scoring, candidateAdder(out, word, scoring));
  return out;
}

/** The shared body of the two sets above, so neither can drift from the other. */
function addInflectionalBaseForms(
  word: string,
  scoring: Scoring,
  add: CandidateAdder,
): void {
  add(tenseBaseForm(word, scoring));
  add(baseForm(word));
  for (const candidate of inflectionalBaseCandidates(word, latinPluralsAllowed(word, scoring))) {
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
    if (lexiconHas(counterpart, scoring)) add(base);
  }
  // Bare "-est", on the same check and for the same reason: the comparative in
  // the same spelling is what tells a superlative ("realest", so "realer") from
  // a word that merely ends that way ("contest", but no "conter"). Its "-er"
  // half stays behind the floor gate -- see `superlativeBaseCandidates`.
  if (scoring.superlativeBases) {
    for (const { base, counterpart } of superlativeBaseCandidates(word)) {
      if (lexiconHas(counterpart, scoring)) add(base);
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
  const add = candidateAdder(out, word, scoring);
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
  add: CandidateAdder
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
  //
  // KNOWN GAP (open, re-checked 2026-10-02): a derived noun measured at or above
  // the floor never reaches its root, and so neither does its plural. The
  // plural folds onto the singular as it should, but the singular has no rule
  // to take it further: "archivists" -> `archivist` (2.80) and stops short of
  // `archive`, the same for "allegorists" -> `allegorist`, "dissimilarities" ->
  // `dissimilarity`, "accusers" -> `accuser`, "analyzers" -> `analyzer`. Two
  // causes, and neither is the plural: "-ist" and "-ity" are not read at all
  // (only "-ologist" is, in `derivedBaseCandidates`, and "-ability" in
  // `boundBaseCandidates`), and agentive "-er" sits behind this gate. It was
  // first logged as "a plural stops the chain", because the plural is where it
  // shows. See docs/word-data-followups.md #7.
  if (lexiconHas(word, scoring) && zipfFor(word, scoring) < MEASURED_FLOOR) {
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
      addPrefixBases(
        word,
        prefixBaseCandidates(word, {
          pre: scoring.prePrefixBases,
          borrowed: scoring.borrowedPrefixBases,
        }),
        scoring,
        date,
        add
      );
    }
  }
  // "counter-" and "anti-", off the gate the rest of the list sits behind: the
  // two prefixes whose letters are not also the opening of a pile of ordinary
  // English words, so there is no measured word for a floor to protect. Run
  // outside the branch above rather than inside it, which is the whole change --
  // a word below the floor reaches the same candidate either way, and the
  // duplicate is dropped by `add`. See UNGATED_PREFIX_START.
  if (scoring.ungatedPrefixBases) {
    addPrefixBases(word, ungatedPrefixBaseCandidates(word), scoring, date, add);
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
  // The privative "-less" family, ungated for the same reason: a word "without
  // X" is a derivation of X, the strip takes nothing away, and the seven
  // dictionary words that merely end that way ("bless", "unless",
  // "nevertheless") leave a residue no dictionary attests. See
  // `privativeBaseCandidates`.
  if (scoring.privativeBases) {
    for (const candidate of privativeBaseCandidates(word)) add(candidate);
  }
}

/**
 * Admit the prefix strips `spellings` offers, against the reviewed guards both
 * prefix families answer to: the residue is a word the fold may price against
 * (`lexiconHas`), it is not a bound fragment (`boundPrefixResidue`), the word is
 * not a reviewed misreading of the prefix, and the prefix is not one the
 * adjective inside a superlative owns.
 *
 * Shared so the two families cannot drift on what a prefix base is: they differ
 * on *when* the strip is allowed, and on nothing else. What they may land on is
 * one question with one answer, which from CORPUS_ONLY_START is a corpus
 * headword as readily as a curated word -- "antiabortionism" -> `abortionism`.
 */
function addPrefixBases(
  word: string,
  spellings: string[],
  scoring: Scoring,
  date: string | undefined,
  add: CandidateAdder
): void {
  if (spellings.length === 0) return;
  // A reviewed entry scoped to the prefix refuses this hop and leaves the
  // word's ordinary folds alone -- see FoldExemption.scope. Asked after the
  // spellings, not before: it reads the word's inflectional base, and most
  // words have no prefix candidate for it to refuse.
  //
  // A superlative's prefix belongs to the adjective inside it, not to the degree
  // form: "uncleanest" is the superlative of "unclean", and stripping un- off it
  // reads the word inside out. See `hasSuperlativeReading`.
  if (
    hasSuperlativeReading(word, scoring) ||
    (scoring.prefixResidues && prefixFoldExemptParadigm(word, scoring, date))
  ) {
    return;
  }
  for (const candidate of spellings) {
    if (!lexiconHas(candidate, scoring)) continue;
    if (scoring.prefixResidues) {
      if (!boundPrefixResidue(candidate, date)) add(candidate);
    } else if (zipfFor(candidate, scoring) >= PREFIX_BASE_MIN_ZIPF) {
      add(candidate);
    }
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
  addNonInflectionalBaseForms(word, scoring, date, candidateAdder(out, word, scoring));
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
    ({ base, counterpart }) => lexiconHas(base, scoring) && lexiconHas(counterpart, scoring)
  );
}

function prefixFoldExemptParadigm(word: string, scoring: Scoring, date?: string): boolean {
  if (prefixFoldExempt(word, date)) return true;
  return inflectionalBaseForms(word, scoring, date).some((base) => prefixFoldExempt(base, date));
}

/** How every candidate set adds a base: the dedupe-and-check below. */
type CandidateAdder = (candidate: string | undefined) => void;

/** The dedupe-and-check every candidate set adds through. */
function candidateAdder(out: string[], word: string, scoring: Scoring): CandidateAdder {
  // Computed once per set rather than per candidate: every candidate is a
  // reading of the same word, so the blocked spelling is too.
  const blocked = blockedTenseStem(word, scoring);
  const reinflected = reinflectedResidue(word, scoring);
  return (candidate) => {
    if (!candidate || candidate === word) return;
    // The readings the word's own spelling rules out, whichever family offered
    // them (see `blockedTenseStem` and `reinflectedResidue`).
    if (candidate === blocked || candidate === reinflected) return;
    if (!lexiconHas(candidate, scoring) || out.includes(candidate)) return;
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
  if (foldExempt(word, date) || overrideBase(word, scoring, date)) return [];
  if (!lexiconHas(word, scoring) || zipfFor(word, scoring) >= MEASURED_FLOOR) return [];

  const out: string[] = [];
  for (const form of derivedFormCandidates(word)) {
    if (!lexiconHas(form, scoring)) continue;
    if (zipfFor(form, scoring) < MEASURED_FLOOR) continue;
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
  if (foldExempt(word, date) || overrideBase(word, scoring, date)) return [];

  const out: string[] = [];
  for (const form of inflectedFormCandidates(word)) {
    if (!lexiconHas(form, scoring)) continue;
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
    const formZipf = zipfFor(form, scoring);
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
  if (inflected !== word && lexiconHas(inflected, scoring)) return inflected;

  for (const suffix of ["ness", "ly"]) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    const candidates = [stem, stem.endsWith("i") ? `${stem.slice(0, -1)}y` : ""];

    // "scowly" is "scowl" + "-y", not "scow" + "-ly". A spelling rule cannot see
    // the difference, and for as long as the fold priced against the curated
    // list it did not have to: "scow", "jow" and "prow" were not on it, so the
    // strip found nothing and the word kept its own score. The corpus holds all
    // three, and the misreading became "howly" -> "how", seven and a half points
    // of it, plus "growly" -> "grow", "jowly" -> "jow", "scowlily" -> "scow" and
    // the "-ier"/"-iest"/"-iness" forms that fold through them.
    //
    // The test is both readings at once, which is what keeps it off the ordinary
    // adverbs. It fires only where the "-ly" strip *already* found a word and the
    // "-y" reading is also one and ends in the l the strip would have eaten:
    // "really" keeps "real" ("reall" is not a word), "tally" is untouched ("tal"
    // is not), and "early" moves from "ear" to "earl" without moving its score,
    // since a fold is a cap and "early" is commoner than either. What it changes
    // is the family where the l is the whole of the stem's identity.
    //
    // Deliberately a *replacement* rather than another candidate: `chainedBase`
    // takes the most common word it reaches, and "how" beats "howl" every time,
    // so an addition would have left every one of these folds exactly where it
    // was. See LIQUID_STEM_START.
    const liquid = word.slice(0, -1);
    if (
      scoring.liquidStemAdjectives &&
      suffix === "ly" &&
      // The stem must not already end in the l, or every "-ally" and "-fully"
      // adverb in the language matches: "generally" minus its y is "generall",
      // which a 1.2M-word lexicon carrying Wiktionary's archaic spellings duly
      // attests, and reading it that way cost "generally", "successfully",
      // "naturally" and fifty more their fold onto the adjective they are built
      // on. A doubled l is an adverb; a single one is part of the stem.
      !stem.endsWith("l") &&
      liquid.endsWith("l") &&
      lexiconHas(liquid, scoring) &&
      // The *bare stem* has to be the reading that fired, not the "-i" -> "-y"
      // rewrite: "daily" is "day" + "-ly" through the rewrite, and its bare stem
      // "dai" is nobody's word, so the rule has no business preferring "dail".
      lexiconHas(stem, scoring) &&
      // And the "-y" adjective has to have a degree paradigm behind it, which is
      // the only evidence spelling offers that this is an adjective at all. It is
      // the same paired test `degreeBaseCandidates` and `superlativeBaseCandidates`
      // already run, and for the same reason: "growly" has "growlier" and
      // "growliest", while "gravely", "lamely", "duely" and "easely" -- every one
      // of which has an l-final word hiding one letter back -- have no comparative
      // because they were never adjectives. Both forms, not either: "graveliest"
      // is attested on its own and "gravelier" is not.
      lexiconHas(`${liquid}ier`, scoring) &&
      lexiconHas(`${liquid}iest`, scoring)
    ) {
      return liquid;
    }
    // The bare stem first and the "-y" rewrite second, and until the corpus era
    // the first of the two that was a word won outright. That order was only
    // ever safe because the curated list did not hold the bare stems: "ugli" and
    // "veri" are not on it, so "uglily" and "verily" fell through to "ugly" and
    // "very" as intended. The corpus holds both -- "ugli" the fruit is a real
    // word with a real count -- and first-past-the-post handed "uglily" the
    // fruit, dropping it from Common to Mythic, and "verily" from Very Common to
    // Rare.
    //
    // `mostCommonBase` is the function written for this exact failure: its own
    // note is that preferring the most common base "keeps a rare homograph of a
    // candidate spelling from hijacking the fold", which is "ugli" to the letter.
    // Gated to the corpus era rather than applied throughout, because the two
    // orders disagree wherever both spellings are words and an archived puzzle
    // must not feel it.
    const base = scoring.corpusLexicon
      ? mostCommonBase(candidates, word, scoring)
      : candidates.find((candidate) => candidate && lexiconHas(candidate, scoring));
    if (base) return base;
  }

  // Bound derivational suffixes (-ization/-isation, -ability/-ibility), gated to
  // the wide-band era. Capped at the base like the transparent suffixes above:
  // "aggrandization" scores as "aggrandize", never rarer than it.
  if (scoring.boundBaseForms) {
    const bound = boundBaseCandidates(word).find((candidate) => lexiconHas(candidate, scoring));
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
    if (candidate === word || !lexiconHas(candidate, scoring)) continue;
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
/**
 * The one spelling `word`'s tense ending does *not* offer as a base: the bare
 * stem of an "-ed"/"-ing" ending whose own forms double their final consonant,
 * where the silent-"e" reading is a dictionary word. Undefined -- nothing
 * refused -- for every other word.
 *
 * `doublingTenseStem` carries the spelling argument and the consonants it holds
 * back; the dictionary half is here because it is the caller's conservatism
 * rather than part of the rule. English never spells "wan" + "-ing" as "waning",
 * full stop -- but a spelling whose other reading is not a word has only the
 * bare strip to hold its paradigm together, and dropping it there would take
 * "busing" off `bus` and "chating" off `chat` for the sake of a base neither
 * has. So the rule *moves* a reading between two spellings of one ending and
 * never removes the last one.
 *
 * Date-blind, and exported for the same reason `mostCommonSameRootBase` is:
 * scoring's fold and same-root identity must answer "which words can this be a
 * form of" identically, differing only in the date each turns the answer on (see
 * `blockedTenseStem` below and SAME_ROOT_DOUBLING_START).
 */
export function refusedTenseStem(word: string): string | undefined {
  const stem = doublingTenseStem(word);
  if (stem === undefined) return undefined;
  return WORD_INDEX.has(`${stem}e`) ? stem : undefined;
}

/**
 * `refusedTenseStem` under `date`'s scoring system -- undefined before the
 * 2026-09-10 cutover, so archived puzzles keep the scores they were played with.
 *
 * Read by `tenseBaseForm` and by `candidateAdder`, which is what makes it stick:
 * the tense rule is not the only route to the bare stem. `baseForm`'s own
 * "-ing"/"-ed" strips reach it too ("waning" -> "wan"), and both
 * `inflectionalBaseForms` and `nextBaseForms` add that answer alongside this
 * one, so a filter in the tense rule alone would be undone one line later.
 */
function blockedTenseStem(word: string, scoring: Scoring): string | undefined {
  return scoring.doublingTenseBases ? refusedTenseStem(word) : undefined;
}

/**
 * The "-s" form a spelling would have to be inflected *again* to produce, when
 * the same letters also read as a silent-"e" word plus one ending -- the reading
 * to refuse, from REINFLECTION_START.
 *
 * Two places offer such a residue:
 *   - the two-letter "-es" strip: "hearses" -> `hears`, where the one-letter
 *     strip gives `hearse`;
 *   - the doubled-consonant trim of "-ed"/"-ing": "finessed" -> "finess" ->
 *     `fines`, where the silent-"e" reading gives `finesse`.
 *
 * A residue counts only when it ends in a single "s" that strips to a word,
 * which marks it as an inflection of something ("hears" is `hear` + "-s") and
 * not a word with "s" in its own stem ("glasses" -> `glass`, "dressed" ->
 * `dress`). The rival reading must also be a word. That is the conservatism
 * `refusedTenseStem` keeps: a reading moves between two spellings of one ending
 * and the last one is never removed, so "buses" keeps `bus` because nothing
 * spells "buse".
 *
 * The rival must also be *measured*, because with a 790k-word lexicon a
 * headword alone is weak evidence. "yeses" is the plural of `yes` and
 * "metropolises" of `metropolis`, yet the corpus holds a "yese" and a
 * "metropolise" that no frequency source has ever counted. Measured on
 * 2026-10-02, an unattested rival marked the wrong reading in every case where
 * the residue was a real word, and junk on both sides everywhere else
 * ("cameses", "chopses").
 *
 * Narrower than `refusedEsStem` on purpose. That rule refuses every two-letter
 * strip after a non-sibilant, and on the fold it cut Early Modern spellings off
 * their everyday words ("yeares" from `year`). This one leaves those alone: no
 * "-es" spelling of a word whose stem ends in a non-"s" letter is touched.
 */
function reinflectedResidue(word: string, scoring: Scoring): string | undefined {
  if (!scoring.refusesReinflection) return undefined;
  let residue: string;
  let rival: string;
  if (word.length > 4 && word.endsWith("es")) {
    residue = word.slice(0, -2);
    rival = word.slice(0, -1);
  } else {
    const stem =
      word.length > 5 && word.endsWith("ing")
        ? word.slice(0, -3)
        : word.length > 4 && word.endsWith("ed")
          ? word.slice(0, -2)
          : undefined;
    if (stem === undefined || !stem.endsWith("ss")) return undefined;
    residue = stem.slice(0, -1);
    rival = `${stem}e`;
  }
  if (!/[^s]s$/.test(residue)) return undefined;
  if (!lexiconHas(residue.slice(0, -1), scoring) || !lexiconHas(rival, scoring)) return undefined;
  if (isUnattestedZipf(zipfFor(rival, scoring))) return undefined;
  return residue;
}

function tenseBaseForm(word: string, scoring: Scoring): string | undefined {
  const candidates: string[] = [];
  // The bare-stem reading this spelling cannot carry, from 2026-09-10. Dropping
  // it also drops the doubled-consonant trim beside it, which is the same string
  // for these stems -- a blocked stem ends in a *single* consonant, so
  // `stripDoubledConsonant` leaves it alone (see DOUBLING_TENSE_START).
  const blocked = blockedTenseStem(word, scoring);

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
    candidates.push(`${stem}e`);
    if (stem !== blocked) candidates.push(stem, stripDoubledConsonant(stem));
  }

  if (word.length > 4 && word.endsWith("ying")) {
    candidates.push(`${word.slice(0, -4)}y`, `${word.slice(0, -4)}ie`);
  } else if (word.length > 5 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    candidates.push(`${stem}e`);
    if (stem !== blocked) candidates.push(stem, stripDoubledConsonant(stem));
  }

  return mostCommonBase(candidates, word, scoring);
}

/**
 * Whether the fold may treat `word` as a word at all -- the membership test
 * every rule in this file is built on, and the one thing CORPUS_ONLY_START
 * changes.
 *
 * Before the cutover: the curated index, the only list there was.
 *
 * From it: the curated index *or* a corpus headword a lexicon attests. A union
 * rather than a swap, and deliberately so. The curated list is a subset of the
 * corpus's `dictionary` source bit -- all 225,483 of it, the same file built
 * both -- so the union is the corpus, save for the window where the corpus has
 * not loaded. In that window the union is the curated list and the fold behaves
 * exactly as it did the day before the cutover, which is the answer this module
 * has given since the corpus existed: nothing waits on the fetch, and a player
 * on a bad connection gets the game, not a spinner.
 *
 * The direction of the degradation is what makes that safe to accept. A fold
 * only ever caps, so a base the fold cannot reach leaves a word scoring *higher*
 * -- the pre-cutover answer -- and never lets through a word it should have
 * refused. See `loadCorpus` in corpus.ts, which useDailyPuzzle starts as soon as
 * a consulting puzzle is in view, so the window is a cold first paint rather
 * than a normal one.
 */
function lexiconHas(word: string, scoring: Scoring): boolean {
  return WORD_INDEX.has(word) || (scoring.corpusLexicon && corpusAttests(word));
}

/**
 * What the fold prices `word` at. Only ever asked of a word `lexiconHas` has
 * already vouched for.
 *
 * The curated index wins where it has the word, in both eras. rarity.json
 * carries hundredths against zipf.bin's 1/32, so reading the corpus for a word
 * the curated data already measures would move scores to no purpose -- the
 * cutover is about the bases the fold can *reach*, not about repricing the ones
 * it always could.
 *
 * A corpus word no frequency corpus counts takes the unattested sentinel, the
 * same stand-in `corpusVerdict` hands it and the same one the live lookup hands
 * a word Merriam-Webster vouches for and nobody has counted.
 */
function zipfFor(word: string, scoring: Scoring): number {
  const i = WORD_INDEX.get(word);
  if (i !== undefined) return scoring.zipfAt(i);
  return corpusEntry(word)?.zipf ?? unattestedZipf();
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

export function rarityForZipf(zipf: number, date?: string, mode?: GameMode): Rarity {
  return scoringFor(date, mode).rarity(zipf);
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

/**
 * Sum the rarity scores earned during one game session, as the sum comes out.
 *
 * Unrounded on purpose: this is the number that goes to the leaderboard, and
 * the precision of a stored score is the endpoint's to decide (see
 * api/leaderboard.ts, which normalises every number in a submission to
 * hundredths). A client that rounds first has made that decision for it, and
 * cannot be talked out of it afterwards -- the day this game shipped rounding a
 * day's total to tenths *before* posting it, a puzzle of 10 + 10 + 9.95 + 10
 * was submitted, stored and shown as a flat 40, and the 39.95 was gone by the
 * time any server saw it.
 *
 * So the sum leaves with its whole binary tail on it (39.950000000000003) and
 * the endpoint is what makes it 39.95. Anything showing this number to a player
 * wants `totalRarityScore`.
 */
export function rawTotalRarityScore(
  words: readonly Pick<AcceptedWord, "zipf">[],
  date?: string
): number {
  const scoring = scoringFor(date);
  return words.reduce((sum, word) => sum + scoring.score(word.zipf), 0);
}

/**
 * The same total, to the hundredth: what a player is shown.
 *
 * Hundredths because that is the precision the words themselves carry -- a
 * deep-tail find is priced to the cent (9.95), so a total rounded any coarser
 * is a number the player cannot reconstruct from their own finds.
 *
 * This rounds for the screen and nothing else. It deliberately matches what the
 * endpoint stores, so the page and the board agree; it is not the thing the
 * board is told (see `rawTotalRarityScore`).
 */
export function totalRarityScore(
  words: readonly Pick<AcceptedWord, "zipf">[],
  date?: string
): number {
  return roundToCents(rawTotalRarityScore(words, date));
}

/**
 * Format a summed total for display: always two decimals.
 *
 * Unlike `formatScore`, which is a single word's score and shows one decimal or
 * two depending on which band the word sits in, a total has no bands -- every
 * total is above any word's ceiling, so the band question has no answer for it.
 * Two decimals everywhere means the number on a board is the number a player
 * gets by adding up their finds, and the tenths a total used to print are what
 * made 39.95 read as 40.
 */
export function formatTotal(total: number): string {
  return total.toFixed(2);
}

/** Highest displayed rarity score earned in the current puzzle. */
export function topRarityScore(
  words: readonly Pick<AcceptedWord, "zipf">[],
  date?: string
): number {
  const scoring = scoringFor(date);
  return words.reduce((top, word) => Math.max(top, scoring.score(word.zipf)), 0);
}

