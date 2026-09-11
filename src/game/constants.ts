/**
 * The guess limit is date-gated, so an archive puzzle plays the way it did the
 * day it dropped and a saved six-word day never turns retroactively complete.
 *   - before 2026-08-20: six guesses.
 *   - 2026-08-20 through 2026-08-29: five.
 *   - on/after 2026-08-30: four.
 *
 * The step down to four starts on a Sunday, so the new limit arrives with the
 * weekly board's own reset (see game/week.ts) rather than halfway through a
 * week -- nobody plays part of a week at one limit and the rest at another.
 */
const FIVE_GUESS_START = "2026-08-20";
const FOUR_GUESS_START = "2026-08-30";

/** The six-guess limit every puzzle before FIVE_GUESS_START played with. */
export const LEGACY_MAX_GUESSES = 6;
/** The five-guess limit puzzles between the two starts played with. */
export const FIVE_MAX_GUESSES = 5;
/** Up to this many distinct valid words can be submitted in a single day's puzzle. */
export const MAX_GUESSES = 4;

/**
 * The guess limit in effect for `date`. Undefined means the current limit, which
 * matches how the scoring systems treat a missing date (see dictionary.ts).
 */
export function maxGuessesFor(date?: string): number {
  if (date === undefined) return MAX_GUESSES;
  if (date < FIVE_GUESS_START) return LEGACY_MAX_GUESSES;
  if (date < FOUR_GUESS_START) return FIVE_MAX_GUESSES;
  return MAX_GUESSES;
}

/**
 * The first puzzle that carries a retry.
 *
 * Date-gated like the guess limit above, and for the same reason: a puzzle
 * plays the way it did the day it dropped. Every day before this one was played
 * without a retry and stays that way, so browsing back to one does not offer a
 * take-back that nobody had at the time.
 *
 * In practice the gate only bites for the days between shipping this and the
 * start, since the retry is offered on the current puzzle only (see
 * useDailyPuzzle.canRetry) -- but that window is exactly what it is for, and
 * stating the start as a date keeps it out of a deploy's timing.
 */
const RETRY_START = "2026-09-04";

/**
 * Whether `date`'s puzzle carries a retry.
 *
 * Undefined means the current puzzle, which by definition is not before the
 * start once the feature is live -- matching how the guess limit and the
 * scoring systems treat a missing date.
 */
export function retryAvailableFor(date?: string): boolean {
  if (date === undefined) return true;
  return date >= RETRY_START;
}

/**
 * The first puzzle whose word of the day stays hidden until it is asked for.
 *
 * Date-gated like the retry above, and for the same reason: a puzzle plays the
 * way it did the day it dropped. The retry itself started eight days earlier
 * (RETRY_START), and those eight days finished by printing their word -- so
 * gating the reveal on the retry alone would reach back and hide words those
 * players have already read. This start is where the reveal actually shipped.
 *
 * It gates the puzzle for good, not only while the puzzle is today's: the retry
 * follows a day into the archive (see useDailyPuzzle.retryOffered), so the word
 * stays behind the same price whenever the day is played.
 */
const REVEAL_GATE_START = "2026-09-12";

/**
 * Whether `date`'s puzzle hides its word of the day until the retry pays for it.
 *
 * Undefined means the current puzzle, which by definition is not before the
 * start once the feature is live -- matching how the guess limit and the retry
 * treat a missing date.
 */
export function revealGatedFor(date?: string): boolean {
  if (date === undefined) return true;
  return date >= REVEAL_GATE_START;
}
