import {
  CURATED_REJECTION_REASONS,
  boundBaseFormsActive,
  curatedRejection,
  usesFreeformRules,
  isValidWord,
  isDictionaryWord,
  waivesRejectionReason,
  mostCommonSameRootBase,
  nearMissForDrop,
  pinnedSameRoot,
  rarityFor,
  rarityForUncurated,
  unattestedZipf,
  refusedEsStem,
  refusedTenseStem,
  sameRootDoublingActive,
  sameRootInflectionsActive,
  sameRootRefusalActive,
} from "./dictionary";
import { LEXICON_SOURCES, corpusEntry, reasonsOf } from "./corpus";
import { isBlocked } from "./blocklist";
import { dropForDate } from "./drop";
import { FREEFORM_TRIAL_START, MODE_CHOICE_START } from "./mode";
import rejectionMetadata from "../data/rejection-metadata.json";
import {
  baseForm,
  boundBaseCandidates,
  decisiveNumberCandidates,
  impossibleNumberBase,
  restoredTenseCandidates,
  stemChangingNumberCandidates,
} from "./stem";
import type { AcceptedWord, RejectionReason, SubmissionResult } from "./types";

const WORD_CHARS = /^[a-z]+$/;
const METADATA_REASONS = [
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "misspelling",
  "obsolete",
  "archaic",
  "dated",
] as const;
type MetadataReason = (typeof METADATA_REASONS)[number];
const metadataByReason = rejectionMetadata as Record<MetadataReason, readonly string[]>;

function includesSorted(words: readonly string[], word: string): boolean {
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = words[middle];
    if (candidate === word) return true;
    if (candidate < word) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

/**
 * Why `word` can't be played. A reviewed rejection (src/data/word-rejections.json)
 * wins over the generated metadata: it is a decision about this exact word, and it
 * is the only source that can explain a word still present in the dictionary.
 * Falls back to the ESDB/Wiktionary categories for words that simply never made
 * the curated list.
 *
 * A metadata category the week waives is dropped rather than returned, which is
 * what sends the word to the live Merriam-Webster lookup: that check runs only
 * for a bare "not-a-word", so naming the register here would refuse the word
 * outright (see `worthChecking` in useDailyPuzzle). Without this the week is
 * inconsistent with itself -- an archaic word the dictionary happens to carry
 * plays, while the 10,309 archaic words it does not carry are turned away
 * without ever being looked up. Misspellings keep their verdict, here as
 * everywhere else: there is nothing to prove about a typo.
 */
function rejectionReasonFor(word: string, date?: string): RejectionReason | undefined {
  const curated = curatedRejection(word, date);
  if (curated !== undefined) return curated;
  const metadata = METADATA_REASONS.find((reason) =>
    includesSorted(metadataByReason[reason] ?? [], word)
  );
  if (metadata !== undefined && waivesRejectionReason(metadata, date)) return undefined;
  return metadata;
}

/**
 * The first puzzle where the drop itself plays in Standard, as it already did in
 * Freeform. Words have had no minimum length since 2026-08-12, but the drop
 * rule kept every two-letter word out of Standard in practice: on a two-letter
 * drop the only two-letter word that contains it is the drop. A common drop
 * ("at", "the") scores near nothing, and that is the whole price -- nothing
 * else refuses it.
 *
 * Starts with the weekly reset, on the same date as MODE_CHOICE_START, so no
 * week is played half under each rule. Archived puzzles keep the refusal.
 */
const DROP_PLAYABLE_START = "2026-09-27";

/** Whether `date`'s puzzle takes the drop itself as an answer. Undefined means current rules. */
export function dropPlayableFor(date?: string): boolean {
  if (date === undefined || date >= DROP_PLAYABLE_START) return true;
  return usesFreeformRules(date);
}

/** True if `drop`'s letters appear contiguously and in order inside `word`. */
export function containsDropInOrder(word: string, drop: string): boolean {
  return word.toLowerCase().includes(drop.toLowerCase());
}

// A same-root chain runs at most three hops in the current dictionary
// ("womens" -> "women" -> "woman"). The cap is a backstop, not a tuned limit.
const MAX_ROOT_DEPTH = 8;

/** Which same-root folds a puzzle date turns on. */
interface RootFolds {
  /** The bound derivational suffixes, from the 2026-08-16 wide-band cutover. */
  bound: boolean;
  /** The inflections `baseForm` misses, from the 2026-08-24 cutover. */
  inflections: boolean;
  /**
   * Whether the readings English does not spell -- a doubling stem, and an "-es"
   * strip onto a stem that would have taken "-s" -- are refused as keys, from
   * the 2026-09-10 cutover (see SAME_ROOT_DOUBLING_START in dictionary.ts).
   */
  spelling: boolean;
}

function rootFoldsFor(date?: string): RootFolds {
  return {
    bound: boundBaseFormsActive(date),
    inflections: sameRootInflectionsActive(date),
    spelling: sameRootDoublingActive(date),
  };
}

/**
 * The key two submissions must share to count as the same root.
 *
 * `baseForm` alone commits to the first rule that matches and cannot check its
 * answer against the dictionary, so it keys thousands of words onto a fragment
 * that matches nothing: "indicated" -> "indicat", "advocates" -> "advocat",
 * "asphyxiates" -> "asphyxiat". Every one of those was a puzzle that could take a
 * word and its own plural or tense as two separate finds -- 40,621 pairs of them,
 * with "advocate"/"advocates"/"advocated"/"advocating" four finds off one verb.
 *
 * From the 2026-08-24 cutover the missing inflections fill those holes, in two
 * tiers, and the tiers are the safety argument:
 *
 *   1. Every *decisive* reading at once -- `baseForm`'s own answer, both "-es"
 *      strips, the "-ies" rewrite, and the silent "e" an "-ed"/"-ing" strip
 *      swallowed -- ranked by frequency, most common wins. These all point at
 *      "the base of this word", so the loser is a lookalike of the winner rather
 *      than a different word: "saves" chooses between "save" and the curated
 *      fragment "sav", "played" between "play" and the obscure-but-real "playe",
 *      "bathing" between "bath" and "bathe".
 *   2. Only if tier 1 finds nothing at all, the stem-changing plurals, where the
 *      base is a guess about which letters changed ("aardwolves" -> "aardwolf").
 *      Keeping this tier out of the ranking is what retires the coincidences
 *      scoring has to live with: "caves" settles inside tier 1 and so never
 *      offers "cafe", and "saves" never offers "safe" -- the two folds scoring
 *      wins by 0.11 and 0.07 Zipf, margins a data refresh could flip.
 *
 * Ranking tier 1 by frequency rather than by rule order is a reversal, and the
 * measurement is why. Frequency is the only thing that separates "play"/"playe"
 * from "bath"/"bathe" -- nothing in the spelling does -- so every ordering tried
 * instead leaked in the thousands, and on common words: preferring `baseForm`'s
 * strip left "have"/"haves", "value"/"values" and "phone"/"phones" playable
 * together, 1,295 pairs of them, while preferring the other strip split
 * "bathes"/"bathing" and 3,000 more. What frequency costs is a near-tie flipping
 * when the data is refreshed, and inside a tier of lookalikes that only moves a
 * pair between merged and playable -- never onto an unrelated word. The two
 * places it does land on an unrelated word are reviewed instead: "theses" ->
 * "these" and the words that merely end in "-men" (see `pinnedSameRoot`).
 *
 * It runs the other way too: 2,501 pairs that collapse today stop collapsing.
 * A fragment is a key two unrelated words can share -- "grapes" and "graps" both
 * land on "grap" today and so refuse each other, as do "argued"/"argus",
 * "cited"/"cits", "rates"/"rats", and the whole family the doubled-consonant trim
 * creates ("chafed"/"chaffed", "razed"/"razzed", "piled"/"pilled",
 * "moused"/"moussed"). Now each side reaches its own base and a puzzle may take
 * both. The rest are pairs where a truncated variant is itself curated, so the
 * variant keeps its own key while the paradigm moves to the full spelling
 * ("ach"/"ached", "advocat"/"advocated"). Those are leaks, and a leak is the safe
 * direction: it lets a word through where a wrong key refuses one.
 *
 * A fragment is still the fallback when tier 1 and tier 2 both come up empty,
 * because then it is the only thing the paradigm shares: the dictionary has no
 * "bitch", so "bitched" and "bitching" meet there or not at all. What changed is
 * that a fragment no longer captures words that *do* have a base.
 *
 * The bound derivational suffixes still fold on top, so a puzzle can't take both
 * "organize" and "organization" (only when that base is itself a dictionary
 * word).
 *
 * See same-root-cases.md for the families this deliberately does not read, the
 * leaks it accepts, and what to check after a frequency-data refresh.
 */
function rootKey(word: string, folds: RootFolds, date?: string): string {
  if (!folds.inflections) return foldOnce(word, folds, date);

  // Walk to a fixed point. One hop is not always enough once the inflections are
  // in play, and a word landing one hop short of its own base is how a pair comes
  // *apart*: "womens" -> "women" while "women" -> "woman", "dyings" -> "dying"
  // while "dying" -> "die". Before the cutover every key was one hop by
  // construction, so the walk is gated with the rest of the widening rather than
  // applied to archived puzzles.
  const seen = new Set([word]);
  let current = word;
  for (let depth = 0; depth < MAX_ROOT_DEPTH; depth++) {
    const next = foldOnce(current, folds, date);
    // `seen` breaks the cycles two words can form by folding onto each other,
    // and the depth cap is a backstop against a future dictionary growing a
    // longer chain than any it has today (the longest is three hops).
    if (next === current || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/**
 * `rootKey` for one word, for tests and audits: the same-root key `date`'s puzzle
 * would compare this word by. Nothing in the game asks for a key on its own --
 * submissions only ever compare two of them.
 */
export function sameRootKey(word: string, date?: string): string {
  return rootKey(word.toLowerCase(), rootFoldsFor(date), date);
}

/**
 * One fold: a reviewed pin, else the best base spelling `word` has, else the
 * word itself.
 *
 * With the widening on, a key is always a *playable word* or the word's own
 * spelling -- never a fragment. Before the cutover it could be either, because
 * `baseForm` never checked its answer, and a fragment is a key two unrelated
 * words can share: "grapes" and "graps" both landed on "grap". Refusing to key
 * onto a fragment is what dissolves those, at the cost of the pairs that only
 * ever met *because* the fragment was shared ("sclerosed"/"sclerosing" have no
 * dictionary base between them, so they now key on themselves and a puzzle can
 * take both). That is a leak, and a leak is the safe direction.
 */
function foldOnce(word: string, folds: RootFolds, date?: string): string {
  const pinned = pinnedSameRoot(word, date);
  if (pinned) return pinned;

  let base = baseForm(word);
  if (folds.inflections) {
    // `baseForm`'s own answer first, and only if it is playable: that is the key
    // this word already had, and keeping it is what stops the widening from
    // overruling a fold that worked ("played" stays on "play" rather than
    // moving to the obscure "playe" an e-restoration offers).
    //
    // Reaching here with `base === word` means no rule matched at all, which is
    // the only way an "-men" plural gets a look: nothing strips it, so its own
    // spelling stands unless the "-man" reading is admitted below.
    // The readings the word's own spelling rules out, which is the same move
    // `impossibleNumberBase` beside them makes for "-ees": a spelling English
    // does not produce is not a rival reading to be ranked, whatever its
    // frequency. "waning" is not a form of `wan` (which conjugates as
    // "wanning") and "banes" is not a form of `ban` (which writes "bans"), so
    // each ending offers exactly one base and it is the "-e" word.
    //
    // A filter rather than an ordering, because frequency is the thing being
    // overruled: the bare CVC stem is nearly always the commoner word, so it
    // wins every ranking it is allowed into. And both refusals together rather
    // than either alone, because one alone takes a paradigm apart -- refuse the
    // tense reading only and "baned" moves to `bane` while "banes" stays on
    // `ban`, so a puzzle can take two forms of one verb (see
    // SAME_ROOT_DOUBLING_START).
    const refused = folds.spelling
      ? [refusedTenseStem(word), refusedEsStem(word)]
      : [];
    const tier1 = [
      base,
      ...decisiveNumberCandidates(word),
      ...restoredTenseCandidates(word),
    ].filter(
      (candidate) => !impossibleNumberBase(word, candidate) && !refused.includes(candidate)
    );
    base =
      mostCommonSameRootBase(word, tier1, date) ??
      stemChangingNumberCandidates(word).find(isDictionaryWord) ??
      base;
  }
  if (folds.bound) {
    // Wrapped rather than passed by reference: find() supplies (value, index),
    // and isValidWord's second parameter is a date.
    const bound = boundBaseCandidates(base).find((candidate) => isValidWord(candidate, date));
    if (bound) return baseForm(bound);
  }
  return base;
}

/**
 * A playable answer this guess is only a letter or two away from, or undefined
 * when it isn't close to one. Callers use it to swap the "not found" rejection
 * for the "check your spelling" nudge -- so it is only ever asked about a guess
 * that has already failed every dictionary check, offline and live alike.
 *
 * Words this puzzle has already taken are not near misses: pointing at one would
 * send the player back to a word the same-root rule would refuse.
 *
 * Where that rule is off -- Freeform, and Standard from SAME_ROOT_REFUSAL_END --
 * the exclusion narrows to the words actually used: a relative of an accepted
 * word is a perfectly good suggestion there, and filtering by root would have
 * gone on hiding the answers those rules allow.
 */
export function spellingNearMiss(
  rawInput: string,
  drop: string,
  alreadyAccepted: AcceptedWord[],
  date?: string
): string | undefined {
  const word = rawInput.trim().toLowerCase();
  if (!WORD_CHARS.test(word)) return undefined;
  if (!sameRootRefusalActive(date)) {
    const used = new Set(alreadyAccepted.map((accepted) => accepted.word));
    return nearMissForDrop(word, drop, date, (candidate) => used.has(candidate));
  }
  const folds = rootFoldsFor(date);
  const usedRoots = new Set(alreadyAccepted.map((accepted) => rootKey(accepted.word, folds, date)));
  // Passed last on purpose: rootKey is the expensive test, and this predicate
  // only ever sees a word already confirmed to be a near miss.
  return nearMissForDrop(word, drop, date, (candidate) =>
    usedRoots.has(rootKey(candidate, folds, date))
  );
}

/**
 * Whether `date`'s puzzle plays off the corpus as well as the curated list.
 *
 * One continuous range rather than two, because FREEFORM_TRIAL_END *is*
 * MODE_CHOICE_START: the trial week opened the corpus and the mode switch keeps
 * it open for both modes. What changes at the seam is not whether the corpus is
 * read but which of its tags are objections, and that question already has an
 * owner in `waivesRejectionReason`.
 *
 * Before the trial nothing consults it. An omitted date reads as not consulting
 * it either -- an undated call is pricing somebody else's word for a board or a
 * feed, not judging a submission, and there is nothing there to look up.
 */
export function consultsCorpus(date?: string): boolean {
  return date !== undefined && date >= FREEFORM_TRIAL_START;
}

/**
 * Whether a corpus tag `date`'s puzzle does not waive refuses the word outright,
 * rather than merely declining to vouch for it.
 *
 * Only the trial week does the latter, and only because its puzzles are already
 * played. See the call site.
 */
function tagsAreVerdicts(date?: string): boolean {
  return date !== undefined && date >= MODE_CHOICE_START;
}

/**
 * The Zipf at or above which an out-of-use tag is ignored, mirroring
 * OUT_OF_USE_ZIPF_CEILING in scripts/generate-data.py and the gate on the
 * derived rejections it writes (see DERIVED_REJECTIONS in dictionary.ts).
 *
 * The trio's false positives are precisely the common words -- "halt" (3.93),
 * "fraught" (3.12) and "guerilla" (2.90) are each tagged obsolete off one dead
 * sense, "thy" and "unto" archaic, "yea" and "fortnight" dated -- so a word
 * corpora still measure in live use is not out of use, whatever a sense label
 * says. Below the gate the tag is reliable.
 *
 * The same number rather than a second judgement on purpose: the tags here and
 * the tags in derived-rejections.json come from the same Wiktextract pass, so a
 * word being on the curated list or off it cannot be what decides how far its
 * label is trusted. The structural tags take no gate, for the reason
 * generate-data.py gives: "cd" being common says nothing about whether it is an
 * abbreviation.
 */
const OUT_OF_USE_ZIPF_CEILING = 2.5;

const OUT_OF_USE_REASONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "obsolete",
  "archaic",
  "dated",
]);

/**
 * What the game makes of a word the curated dictionary has never heard of.
 *
 * The corpus is the expansive list -- 1.2M headwords, tagged rather than
 * filtered -- and this is the one place that turns its tags into a verdict. What
 * it will and will not object to is not decided here: it asks
 * `waivesRejectionReason`, the same function the curated list is judged by, so
 * the two lists answer to one rule and a word cannot be playable on one and
 * refused on the other for the kind of word it is.
 *
 * That is what makes it safe to consult in both modes. Freeform -- the trial
 * week, or the player's choice from MODE_CHOICE_START -- reaches it waiving six
 * reasons, Standard from MODE_CHOICE_START waiving three -- names and
 * abbreviations, which the trial settled, while the age trio goes back in force
 * -- and each gets the corpus filtered to its own rules from the same data. Before FREEFORM_TRIAL_START nothing consults it at all: an archived
 * puzzle plays as it was played, and a word refused in August is refused there
 * still.
 *
 * Two objections no waiver lifts, and the corpus is where they bite hardest. A
 * misspelling is a mistake rather than a bolder way to play. And a string
 * carrying only frequency-corpus bits has been *counted*, never *described* --
 * Norvig and wordfreq between them attest ~160k strings no lexicon has, mostly
 * crawl residue like "mxps" and "travelglobe" -- which is what "not-a-word"
 * means. The blocklist is the third, and it is not a waiver question at all: it
 * is a decision about words the game will not print, and the corpus carries no
 * tag for it (see blocklist.ts).
 *
 * Returns undefined when the corpus has nothing to say -- including before it
 * has loaded -- so the caller falls through to the live lookup exactly as it
 * did before the corpus existed. The corpus never makes a word *less* playable.
 */
function corpusVerdict(word: string, date?: string): SubmissionResult | undefined {
  if (!consultsCorpus(date)) return undefined;
  if (isBlocked(word)) return undefined;
  const entry = corpusEntry(word);
  if (!entry) return undefined;
  if (!(entry.sources & LEXICON_SOURCES)) return undefined;

  // A word no corpus attests scores the unattested sentinel -- a flat 10.00
  // Legend before the fold. That is a stand-in rather than a measurement, and it
  // is what the live lookup already hands a word it can find no frequency for,
  // so a word scores the same here whether the corpus or Merriam-Webster
  // vouched for it.
  const ownZipf = entry.zipf ?? unattestedZipf();
  for (const reason of reasonsOf(entry.tags)) {
    if (waivesRejectionReason(reason, date)) continue;
    // A live-use measurement outranks the label, for the trio only.
    if (OUT_OF_USE_REASONS.has(reason) && ownZipf >= OUT_OF_USE_ZIPF_CEILING) continue;
    // From MODE_CHOICE_START the tag is the verdict and the player is told it,
    // which is the whole of "the corpus is the dictionary now": a tag that only
    // withheld an opinion would leave the word to the live lookup, and Merriam-
    // Webster has no view on whether Wiktionary calls a sense obsolete. Curated
    // words have worked this way since derived-rejections.json (see
    // DERIVED_REJECTIONS), and the two lists now answer alike.
    //
    // The trial week keeps falling through instead, unchanged. Its puzzles are
    // archived and a word accepted on the 16th has to still be accepted when
    // somebody opens that day -- the same reason every scoring cutover in
    // dictionary.ts is kept rather than replaced.
    if (!tagsAreVerdicts(date)) return undefined;
    return { ok: false, reason };
  }

  // Scored through the fold, not off the raw number: a corpus word is far more
  // often a mechanical derivation than a curated one, and an unwritten suffix on
  // an everyday base is not a rare word. See rarityForUncurated.
  const { rarity, zipf } = rarityForUncurated(word, ownZipf, date);
  return { ok: true, word: { word, rarity, zipf } };
}

export function evaluateSubmission(
  rawInput: string,
  drop: string,
  alreadyAccepted: AcceptedWord[],
  date?: string
): SubmissionResult {
  const word = rawInput.trim().toLowerCase();

  if (!word) {
    return { ok: false, reason: "empty" };
  }
  if (!WORD_CHARS.test(word)) {
    return { ok: false, reason: "not-a-word" };
  }
  // The blocklist, asked of every word rather than of the corpus alone.
  //
  // It used to be applied once, at build time, on the assumption that the
  // curated list was the only way a word could reach a player. That stopped
  // being true twice over: the live Merriam-Webster lookup answers for words
  // the list never held, and the corpus now answers for 1.2M more. Asking here
  // covers all three sources with one check.
  //
  // It also catches the two entries that were never applied at all. The file
  // allows a reviewed note beside an entry and both loaders read the line whole,
  // so "niggardly  # sounds like a slur despite unrelated etymology" was a
  // blocklist entry no word could ever equal -- and "niggardly" duly shipped in
  // dictionary.json and has been playable ever since. The loaders are fixed;
  // this is what makes the fix reach a dictionary that is already built.
  //
  // "not-a-word" rather than a reason of its own, and deliberately the one
  // reason that normally earns a live lookup -- `eligibleForLiveCheck` refuses
  // these words, so the lookup never runs and the player gets the ordinary
  // not-on-the-list message. Naming the real reason would mean printing the
  // category back at them, which is the thing the list exists to avoid.
  if (isBlocked(word)) {
    return { ok: false, reason: "not-a-word" };
  }
  // The drop itself is a word like any other during freeform week, and in both
  // modes from DROP_PLAYABLE_START. Refusing it is a rule about what makes an
  // interesting answer rather than about what is a word, which puts it with the
  // fold and the same-root check rather than with the gates below -- and "ACC"
  // is only unplayable the rest of the time because it is also an abbreviation.
  // See FREEFORM_START.
  if (!dropPlayableFor(date) && word === drop.toLowerCase()) {
    return { ok: false, reason: "same-as-drop" };
  }
  if (!containsDropInOrder(word, drop)) {
    return { ok: false, reason: "missing-drop" };
  }
  if (alreadyAccepted.some((w) => w.word === word)) {
    return { ok: false, reason: "already-used" };
  }
  // Only archived Standard drops before SAME_ROOT_REFUSAL_END still refuse a
  // relative of a word already found. Freeform never did, and Standard stopped:
  // "play", "plays" and "played" are three real words, and the fold already
  // prices each as its base, so refusing them only took answers off the player.
  //
  // The exact-duplicate check above is untouched and deliberately so: the same
  // spelling twice is not a second word under any scoring system.
  if (sameRootRefusalActive(date)) {
    const folds = rootFoldsFor(date);
    const wordRoot = rootKey(word, folds, date);
    if (alreadyAccepted.some((w) => rootKey(w.word, folds, date) === wordRoot)) {
      return { ok: false, reason: "same-root-as-used" };
    }
  }
  if (!isValidWord(word, date)) {
    // Consulted only for words the curated list has never heard of: a curated
    // word that freeform week already waives never reaches here, because
    // curatedRejection has lifted its reason and isValidWord is true.
    const fromCorpus = corpusVerdict(word, date);
    if (fromCorpus) return fromCorpus;
    return {
      ok: false,
      reason: rejectionReasonFor(word, date) ?? "not-a-word",
    };
  }

  const info = rarityFor(word, date);
  // Every word in the dictionary has a precomputed rarity entry; this guard
  // is just defensive in case the two datasets ever drift apart.
  if (!info) {
    return { ok: false, reason: "not-a-word" };
  }

  return {
    ok: true,
    word: { word, rarity: info.rarity, zipf: info.zipf },
  };
}

/**
 * The reasons that settle a word offline: every reviewed verdict but the bare
 * "not-a-word", which only means no local list vouches for the word -- the live
 * Merriam-Webster lookup may still have approved it.
 */
const SETTLED_REJECTIONS: ReadonlySet<string> = new Set<string>(
  CURATED_REJECTION_REASONS.filter((reason) => reason !== "not-a-word")
);

/**
 * What `date`'s rules, in the mode the player is in now, make of `word` from
 * the local lists alone -- so the finds feed can leave out a word the reader
 * could not have played.
 *
 * The feed holds both modes' finds, and from MODE_CHOICE_START Freeform takes
 * the obsolete, archaic and dated words Standard refuses (see
 * waivedRejectionsFor in dictionary.ts). "refused" is a settled verdict: the
 * reader's game turns the word away without asking anybody. "unknown" is a bare
 * "not-a-word" -- no local list vouches for the word, and only the live
 * Merriam-Webster lookup can say whether it plays, so the feed falls back on
 * whether anybody found it in Standard.
 */
export function offlineVerdict(word: string, date: string): "playable" | "refused" | "unknown" {
  const result = evaluateSubmission(word, dropForDate(date), [], date);
  if (result.ok) return "playable";
  if (result.reason === undefined || !SETTLED_REJECTIONS.has(result.reason)) return "unknown";
  return "refused";
}

/**
 * The bold lead of each rejection: the word that names the verdict, for a
 * player who reads one word and moves on.
 *
 * Players skim the toast rather than read it, and every rejection used to open
 * with the same shape ("This looks like a...", "That word..."), so they all
 * landed as the one message they had seen most -- "not on the curated list".
 * The lead is the part that differs, so it goes first and it is the part in
 * bold.
 *
 * The two not-found verdicts deliberately share a lead: they *are* the same
 * verdict, and what separates them is the offer that follows.
 *
 * `empty` has no lead: "Type a word first." is an instruction rather than a
 * verdict, and there is nothing in three words to pick out.
 */
/**
 * What a word that looks mistyped is told. Shared rather than written twice: a
 * word the data knows is a misspelling and one sitting a letter from something
 * playable are the same mistake to the player, and the useful half of the
 * message is the fix, not which of the two the game decided it was. One copy is
 * what stops them drifting apart.
 */
// A question, not a verdict: the game is guessing that a typo is what happened,
// and a word the player invented on purpose shouldn't be told it spelled
// something else wrong.
const MISSPELLING_LEAD = "Misspelling?";
const MISSPELLING_FIX = "Check your spelling.";

export const REJECTION_LEADS: Record<string, string> = {
  "not-a-word": "Not found.",
  misspelling: MISSPELLING_LEAD,
  "check-your-spelling": MISSPELLING_LEAD,
  "proper-noun": "Proper noun.",
  abbreviation: "Abbreviation.",
  "name-or-abbreviation": "Name or abbreviation.",
  obsolete: "Obsolete.",
  archaic: "Archaic.",
  dated: "Dated.",
  "missing-drop": "Missing the drop.",
  "same-as-drop": "That's the drop.",
  "already-used": "Already used.",
  "same-root-as-used": "Same root.",
};

/**
 * What the lead can't say on its own, and nothing more: a rejection is a beat
 * in the middle of a guess, so a sentence that only restates the lead is a
 * sentence to read past. `already-used` has no entry at all -- the lead is the
 * whole message.
 *
 * Each one earns its place by adding a rule ("Names aren't playable"), a next
 * move ("Find a longer word") or the thing that separates it from a lead it
 * shares. `More info` is on every rejection toast, which is where the long
 * explanation lives (see WordRulesModal).
 */
export const REJECTION_DETAILS: Record<string, string> = {
  empty: "Type a word first.",
  // Says where the game looked rather than naming a list of ours: a player who
  // has just been told "not on the curated list" has learnt that we keep a list,
  // not that their word is unknown to the dictionaries behind it.
  "not-a-word": "Not in available dictionaries.",
  misspelling: MISSPELLING_FIX,
  "check-your-spelling": MISSPELLING_FIX,
  "proper-noun": "Names aren't playable.",
  abbreviation: "Acronyms aren't playable.",
  "name-or-abbreviation": "Not playable.",
  obsolete: "No longer used.",
  archaic: "Not in modern use.",
  dated: "No longer common.",
  "missing-drop": "Your word must contain it.",
  "same-as-drop": "Find a longer word.",
  "same-root-as-used": "Too close to a word you used.",
};

/**
 * The whole message a player is told, lead and detail together. What screen
 * readers announce and what the word-check tooling reports; the toast bolds the
 * lead inside it (see FeedbackRegion).
 */
export const REJECTION_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.keys({ ...REJECTION_LEADS, ...REJECTION_DETAILS }).map((reason) => {
    const lead = REJECTION_LEADS[reason];
    const detail = REJECTION_DETAILS[reason];
    return [reason, [lead, detail].filter(Boolean).join(" ")];
  })
);
