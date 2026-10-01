import { formatRarityScore, rarityForZipf, rarityScore } from "./dictionary";
import { asMode, modeIsChosen, type GameMode } from "./mode";
import { loadOrCreateProgress } from "./storage";
import { evaluateSubmission } from "./submit";
import type { AcceptedWord, DailyProgress, RejectionReason } from "./types";

/**
 * Copying a banked word into the other mode's game for the same puzzle.
 *
 * Each mode keeps its own progress for a date (see `progressKey` in
 * game/storage.ts), so a player who finds a word in Standard and wants it in
 * Freeform too has, until now, had to flip the switch and type it again. This
 * makes that one tap from the guess log. The score over there is shown only
 * after the word has been submitted (see `OtherModeRow` in
 * components/GuessLog.tsx), so the other game stays a blind guess.
 *
 * A copy is a real submission to the other game. It is judged by that mode's
 * rules, not waved through on the strength of having passed this one's: the two
 * disagree about exactly the things a copy runs into. Standard refuses a second
 * word from a root it has already banked, where Freeform takes the whole
 * paradigm; Freeform waives archaic, obsolete and dated words that Standard
 * turns away; and the fold prices one word two ways. It then spends one of the
 * other mode's guesses and goes on that mode's board, exactly as typing it
 * there would have.
 *
 * Everything here runs under `asMode`, which is synchronous. The one part that
 * is not -- a live lookup for a word no offline list carries -- is the hook's
 * (see `copyToOtherMode` in hooks/useDailyPuzzle.ts), which calls back in here
 * with the verdict once it has one.
 */

/**
 * Where a word stands in the other mode, for the guess log. Priced in every
 * state that can be, but the log shows the price only once it is `copied`.
 */
export type CrossModePreview =
  /** Already banked there. `word` is the copy as it was scored there. */
  | { state: "copied"; word: AcceptedWord; score: string }
  /**
   * Can be copied, at this price. `needsLiveCheck` when no offline list knows
   * the word and the other mode is strict enough that the price is only an
   * estimate until a lookup confirms it -- see `previewInMode`.
   */
  | { state: "ready"; word: AcceptedWord; score: string; needsLiveCheck: boolean }
  /** The other mode's game for this puzzle is over: no guess left to spend. */
  | { state: "full"; word?: AcceptedWord; score?: string }
  /** The other mode will not take it, and why. */
  | { state: "refused"; reason: RejectionReason };

/** Whether copying across is on offer for a puzzle at all. */
export function crossModeAvailable(date: string): boolean {
  // Before the choice date a puzzle has one game, decided by the calendar, and
  // there is no other mode's progress to copy into.
  return modeIsChosen(date);
}

/** The other mode's progress for a puzzle, as that mode would load it. */
export function loadProgressInMode(date: string, drop: string, mode: GameMode): DailyProgress {
  return asMode(mode, () => loadOrCreateProgress(date, drop));
}

/**
 * What `word`, banked in the current mode, would be in `target`.
 *
 * Judged against the target's own banked words, so a Standard same-root
 * refusal shows up here rather than as a surprise on tap.
 *
 * A word the offline lists do not know at all came in through a live lookup,
 * and only the lookup can say it again. Into Freeform that is moot -- Freeform
 * waives every register Standard does and more, and has no same-root rule, so a
 * word one lookup let into Standard is in -- and the word is simply repriced on
 * its measured frequency. Into Standard it is not: Freeform may have taken it
 * *because* it was archaic. So it is shown at its repriced score and marked for
 * a lookup before it is banked.
 */
export function previewInMode(
  word: AcceptedWord,
  target: GameMode,
  date: string,
  drop: string,
  targetProgress: DailyProgress
): CrossModePreview {
  return asMode(target, () => {
    const existing = targetProgress.acceptedWords.find((w) => w.word === word.word);
    if (existing) {
      return { state: "copied", word: existing, score: formatRarityScore(existing.zipf, date) };
    }

    const result = evaluateSubmission(word.word, drop, targetProgress.acceptedWords, date);
    let priced: AcceptedWord | undefined;
    let needsLiveCheck = false;
    if (result.ok && result.word) {
      priced = result.word;
    } else if (result.reason === "not-a-word" || result.reason === "check-your-spelling") {
      priced = repriced(word, date);
      needsLiveCheck = target === "standard";
    }

    if (targetProgress.completed) {
      return priced
        ? { state: "full", word: priced, score: formatRarityScore(priced.zipf, date) }
        : { state: "full" };
    }
    if (!priced) return { state: "refused", reason: result.reason ?? "not-a-word" };
    return { state: "ready", word: priced, score: formatRarityScore(priced.zipf, date), needsLiveCheck };
  });
}

/** A word's measured frequency, given the current mode's tier. Call under `asMode`. */
export function repriced(word: AcceptedWord, date: string): AcceptedWord {
  return { word: word.word, zipf: word.zipf, rarity: rarityForZipf(word.zipf, date) };
}

/** A word's score as a number under `mode`, for analytics. */
export function scoreInMode(word: AcceptedWord, date: string, mode: GameMode): number {
  return asMode(mode, () => rarityScore(word.zipf, date));
}
