/**
 * The guess limit is date-gated, so an archive puzzle plays the way it did the
 * day it dropped and a saved six-word day never turns retroactively complete.
 *   - before 2026-08-20: six guesses.
 *   - on/after 2026-08-20: five.
 */
const FIVE_GUESS_START = "2026-08-20";

/** The six-guess limit every puzzle before FIVE_GUESS_START played with. */
export const LEGACY_MAX_GUESSES = 6;
/** Up to this many distinct valid words can be submitted in a single day's puzzle. */
export const MAX_GUESSES = 5;

/**
 * The guess limit in effect for `date`. Undefined means the current limit, which
 * matches how the scoring systems treat a missing date (see dictionary.ts).
 */
export function maxGuessesFor(date?: string): number {
  if (date !== undefined && date < FIVE_GUESS_START) return LEGACY_MAX_GUESSES;
  return MAX_GUESSES;
}
