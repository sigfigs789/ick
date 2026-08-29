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
