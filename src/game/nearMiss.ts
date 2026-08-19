/**
 * The near-miss rule behind the "check your spelling" nudge.
 *
 * A guess that clears every other rule -- it contains the drop, it isn't a
 * repeat -- and still isn't in the curated list or any live reference is more
 * often a typo than an invention. When such a guess sits one letter from a word
 * the player could actually have played, the game says so instead of only
 * reporting that the word wasn't found.
 *
 * Nothing here names the nearby word: that word is a playable answer for the
 * live drop, so revealing it would hand over a guess.
 */

/**
 * How far off a guess may be. One edit, deliberately -- the rule has to be much
 * more likely to describe a typo than a coincidence, or the nudge becomes the
 * message every rejection gets.
 *
 * A second edit does not pay for itself. A single mistyped, dropped, or doubled
 * letter is already one edit away, so the second only ever buys transpositions
 * ("recieve"), and it buys them at a heavy price: measured against made-up
 * pronounceable words containing the day's drop, allowing two edits flags 54-71%
 * of six-letter inventions and 16-28% of seven-letter ones, where one edit flags
 * 1-10% and ~0-2%.
 */
export const NEAR_MISS_MAX_EDITS = 1;

/**
 * Shortest guess worth checking. Below six letters even a single edit reaches a
 * large share of the dictionary -- 23-41% of five-letter inventions land next to
 * a real word, and 70%+ of four-letter ones -- so "one letter off" stops being
 * evidence of a typo and starts being a property of short words.
 */
export const NEAR_MISS_MIN_LENGTH = 6;

/** How many edits from `word` still counts as a near miss; 0 means don't check. */
export function nearMissEditBudget(word: string): number {
  return word.length >= NEAR_MISS_MIN_LENGTH ? NEAR_MISS_MAX_EDITS : 0;
}

/**
 * Whether `a` becomes `b` in at most `max` insertions, deletions, or
 * substitutions (Levenshtein, so a transposition costs two).
 *
 * Bounded on both ends because this runs against every drop-containing word in
 * a 225k-word list: a length gap wider than the budget is rejected outright,
 * and a row whose every cell already exceeds the budget can only grow, so it
 * ends the comparison.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (max < 0) return false;
  if (Math.abs(a.length - b.length) > max) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > max) return false;
    previous = current.slice();
  }
  return previous[b.length] <= max;
}
