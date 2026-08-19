import {
  boundBaseFormsActive,
  curatedRejection,
  isValidWord,
  nearMissForDrop,
  rarityFor,
} from "./dictionary";
import rejectionMetadata from "../data/rejection-metadata.json";
import { baseForm, boundBaseCandidates } from "./stem";
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

/**
 * The key two submissions must share to count as the same root. Beyond the
 * inflectional stemmer, the wide-band era also folds the bound derivational
 * suffixes onto a real base, so a puzzle can't take both "organize" and
 * "organization" (only when that base is itself a dictionary word).
 */
function rootKey(word: string, foldBoundSuffixes: boolean, date?: string): string {
  const inflected = baseForm(word);
  if (foldBoundSuffixes) {
    // Wrapped rather than passed by reference: find() supplies (value, index),
    // and isValidWord's second parameter is a date.
    const bound = boundBaseCandidates(inflected).find((candidate) => isValidWord(candidate, date));
    if (bound) return baseForm(bound);
  }
  return inflected;
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
  const foldBoundSuffixes = boundBaseFormsActive(date);
  const usedRoots = new Set(
    alreadyAccepted.map((accepted) => rootKey(accepted.word, foldBoundSuffixes, date))
  );
  // Passed last on purpose: rootKey is the expensive test, and this predicate
  // only ever sees a word already confirmed to be a near miss.
  return nearMissForDrop(word, drop, date, (candidate) =>
    usedRoots.has(rootKey(candidate, foldBoundSuffixes, date))
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
  const foldBoundSuffixes = boundBaseFormsActive(date);
  const wordRoot = rootKey(word, foldBoundSuffixes, date);
  if (alreadyAccepted.some((w) => rootKey(w.word, foldBoundSuffixes, date) === wordRoot)) {
    return { ok: false, reason: "same-root-as-used" };
  }
  if (!isValidWord(word, date)) {
    return { ok: false, reason: rejectionReasonFor(word, date) ?? "not-a-word" };
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
