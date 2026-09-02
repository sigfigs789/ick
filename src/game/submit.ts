import {
  boundBaseFormsActive,
  curatedRejection,
  isValidWord,
  isDictionaryWord,
  mostCommonSameRootBase,
  nearMissForDrop,
  pinnedSameRoot,
  rarityFor,
  sameRootInflectionsActive,
} from "./dictionary";
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
 */
function rejectionReasonFor(word: string, date?: string): RejectionReason | undefined {
  return (
    curatedRejection(word, date) ??
    METADATA_REASONS.find((reason) => includesSorted(metadataByReason[reason] ?? [], word))
  );
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
}

function rootFoldsFor(date?: string): RootFolds {
  return {
    bound: boundBaseFormsActive(date),
    inflections: sameRootInflectionsActive(date),
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
    const tier1 = [
      base,
      ...decisiveNumberCandidates(word),
      ...restoredTenseCandidates(word),
    ].filter((candidate) => !impossibleNumberBase(word, candidate));
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
 */
export function spellingNearMiss(
  rawInput: string,
  drop: string,
  alreadyAccepted: AcceptedWord[],
  date?: string
): string | undefined {
  const word = rawInput.trim().toLowerCase();
  if (!WORD_CHARS.test(word)) return undefined;
  const folds = rootFoldsFor(date);
  const usedRoots = new Set(alreadyAccepted.map((accepted) => rootKey(accepted.word, folds, date)));
  // Passed last on purpose: rootKey is the expensive test, and this predicate
  // only ever sees a word already confirmed to be a near miss.
  return nearMissForDrop(word, drop, date, (candidate) =>
    usedRoots.has(rootKey(candidate, folds, date))
  );
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
  if (word === drop.toLowerCase()) {
    return { ok: false, reason: "same-as-drop" };
  }
  if (!containsDropInOrder(word, drop)) {
    return { ok: false, reason: "missing-drop" };
  }
  if (alreadyAccepted.some((w) => w.word === word)) {
    return { ok: false, reason: "already-used" };
  }
  const folds = rootFoldsFor(date);
  const wordRoot = rootKey(word, folds, date);
  if (alreadyAccepted.some((w) => rootKey(w.word, folds, date) === wordRoot)) {
    return { ok: false, reason: "same-root-as-used" };
  }
  if (!isValidWord(word, date)) {
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
 * The bold lead of each rejection: the phrase that names the verdict, for a
 * player who reads three words and moves on.
 *
 * Players skim the toast rather than read it, and every rejection used to open
 * with the same shape ("This looks like a...", "That word..."), so they all
 * landed as the one message they had seen most -- "not on the curated list".
 * The lead is the part that differs, so it goes first and it is the part in
 * bold.
 *
 * `empty` has no lead: "Type a word first." is three words long and is the
 * whole instruction already.
 */
export const REJECTION_LEADS: Record<string, string> = {
  "not-a-word": "Not on the list.",
  "proper-noun": "Proper noun.",
  abbreviation: "Abbreviation or acronym.",
  "name-or-abbreviation": "Proper noun or abbreviation.",
  misspelling: "Misspelling.",
  obsolete: "Archaic or obsolete.",
  archaic: "Archaic.",
  dated: "Dated.",
  "missing-drop": "Doesn't contain the drop.",
  "same-as-drop": "That's the drop itself.",
  "already-used": "Already used.",
  "same-root-as-used": "Too close to a word you already used.",
  "check-your-spelling": "Not found.",
};

/**
 * What a lead can't say on its own, and nothing more: a rejection is a beat in
 * the middle of a guess, so anything the lead already covers is a sentence the
 * player has to read past. Most reasons have no entry here at all -- "Proper
 * noun." is the entire message.
 *
 * `More info` is on every rejection toast, which is where the longer
 * explanation lives (see WordRulesModal).
 */
export const REJECTION_DETAILS: Record<string, string> = {
  empty: "Type a word first.",
  // The one rejection with an answer attached: the player has a real word in
  // mind and spelled it wrong, so the message points at the fix.
  misspelling: "Try the correct spelling.",
  dated: "No longer in common use.",
  "check-your-spelling": "Check your spelling?",
};

/**
 * The whole sentence a player is told, which for most reasons is just the lead.
 * What screen readers announce and what the word-check tooling reports; the
 * toast bolds the lead inside it (see FeedbackRegion).
 */
export const REJECTION_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.keys({ ...REJECTION_LEADS, ...REJECTION_DETAILS }).map((reason) => {
    const lead = REJECTION_LEADS[reason];
    const detail = REJECTION_DETAILS[reason];
    return [reason, [lead, detail].filter(Boolean).join(" ")];
  })
);
