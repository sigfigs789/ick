import { isValidWord, rarityFor } from "./dictionary";
import { baseForm } from "./stem";
import type { AcceptedWord, SubmissionResult } from "./types";

const WORD_CHARS = /^[a-z]+$/;

/** True if `drop`'s letters appear contiguously and in order inside `word`. */
export function containsDropInOrder(word: string, drop: string): boolean {
  return word.toLowerCase().includes(drop.toLowerCase());
}

export function evaluateSubmission(
  rawInput: string,
  drop: string,
  alreadyAccepted: AcceptedWord[]
): SubmissionResult {
  const word = rawInput.trim().toLowerCase();

  if (!word) {
    return { ok: false, reason: "empty" };
  }
  if (!WORD_CHARS.test(word)) {
    return { ok: false, reason: "not-a-word" };
  }
  if (!containsDropInOrder(word, drop)) {
    return { ok: false, reason: "missing-drop" };
  }
  if (alreadyAccepted.some((w) => w.word === word)) {
    return { ok: false, reason: "already-used" };
  }
  if (alreadyAccepted.some((w) => baseForm(w.word) === baseForm(word))) {
    return { ok: false, reason: "same-root-as-used" };
  }
  if (!isValidWord(word)) {
    return { ok: false, reason: "not-a-word" };
  }

  const info = rarityFor(word);
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
  "not-a-word": "That's not in the word list.",
  "missing-drop": "That word doesn't contain the drop.",
  "already-used": "You've already submitted that word.",
  "same-root-as-used": "That's too close to a word you already used.",
};
