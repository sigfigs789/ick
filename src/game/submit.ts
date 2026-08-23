import {
  boundBaseFormsActive,
  curatedRejection,
  isValidWord,
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
 * answer against the dictionary, so it keys thousands of words onto a non-word
 * that matches nothing: "indicated" -> "indicat", "scores" -> "scor",
 * "asphyxiates" -> "asphyxiat". Every one of those was a puzzle that could take
 * a word and its own plural or tense as two separate finds -- 39,466 pairs of
 * them, "indicate"/"indicates"/"indicated"/"indicating" being four finds off one
 * verb.
 *
 * From the 2026-08-24 cutover the missing inflections fill those holes, and the
 * order below is the whole safety argument:
 *
 *   1. Whatever `baseForm` returns, if that is itself a playable word, is the
 *      key -- exactly as before, so the widening only ever *fills a hole* and
 *      never overrules a key that already worked. It is also what keeps "played"
 *      keyed on "play" rather than the obscure "playe" a bare e-restoration
 *      would offer.
 *   2. Otherwise the decisive candidates: the strips that leave the stem's
 *      letters alone, plus the silent "e" an "-ed"/"-ing" strip swallowed. A
 *      wrong guess here is almost always a non-word, and a non-word is never
 *      accepted as a key at all -- the word keeps its own spelling instead.
 *   3. Only then the one stem-changing family, where the base is a guess about
 *      which letters changed ("knives" -> "knife"). Ranking it last is what
 *      retires the coincidences scoring has to live with: "caves" reaches "cave"
 *      by a decisive strip and so never offers "cafe" at all.
 *
 * Frequency deliberately plays no part. Scoring breaks its ties by picking the
 * most common candidate, which is safe there because a near-tie costs a fraction
 * of a point; here a wrong pick refuses a legitimate word outright, and a key
 * that moved when the frequency data was refreshed would change which words a
 * player may submit. Ordered preference keeps the key a function of spelling
 * alone. The handful of words no ordering can settle are pinned by review
 * (see `pinnedSameRoot`).
 *
 * It runs the other way too: 382 pairs that collapse today stop collapsing,
 * because `baseForm` keys thousands of words onto a *fragment* and a fragment is
 * a key two unrelated words can share. "grapes" and "graps" both land on "grap"
 * today and so refuse each other; so do "argued"/"argus", "cited"/"cits" and
 * "holed"/"hols". The doubled-consonant trim adds a whole family --
 * "chafed"/"chaffed", "razed"/"razzed", "piled"/"pilled", "moused"/"moussed",
 * "roles"/"rolled" -- pairs of different verbs a puzzle may now take both of.
 * The rest are same-root pairs with no dictionary word between them, which used
 * to meet on their shared fragment and now key on themselves
 * ("sclerosed"/"sclerosing", "hooved"/"hooves"). Those are leaks, and a leak is
 * the safe direction: it lets a word through where a wrong key refuses one.
 *
 * Leaks are also what is left where the dictionary attests the fragment. "wolve"
 * and "knive" are curated words, so "wolves" keys on "wolve" and never reaches
 * "wolf" -- rule 1 does not overrule a playable base, and that is the same rule
 * protecting "play"/"played". A puzzle can still take "wolf" and "wolves" both;
 * 390 stem-changing plurals are shadowed this way.
 *
 * The bound derivational suffixes still fold on top, so a puzzle can't take both
 * "organize" and "organization" (only when that base is itself a dictionary
 * word).
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
    base =
      base !== word && isValidWord(base, date)
        ? base
        : ([
            ...decisiveNumberCandidates(word),
            ...restoredTenseCandidates(word),
            ...stemChangingNumberCandidates(word),
          ].find((candidate) => isValidWord(candidate, date)) ?? word);
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

export const REJECTION_MESSAGES: Record<string, string> = {
  empty: "Type a word first.",
  "not-a-word": "That word is not in WordInk's curated list.",
  "proper-noun": "This looks like a proper noun.",
  abbreviation: "This looks like an abbreviation or acronym.",
  "name-or-abbreviation": "This looks like a proper noun or abbreviation.",
  misspelling: "This looks like a misspelling of another word.",
  obsolete: "This looks archaic or obsolete.",
  archaic: "This looks like an archaic word.",
  dated: "This looks dated — no longer in common use.",
  "missing-drop": "That word doesn't contain the drop.",
  "same-as-drop": "Your answer can't be the drop itself.",
  "already-used": "You've already submitted that word.",
  "same-root-as-used": "That's too close to a word you already used.",
  "check-your-spelling": "Not found — check your spelling?",
};
