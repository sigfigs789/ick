/**
 * The near-miss rule behind the "check your spelling" nudge.
 *
 * A guess that clears every other rule -- it contains the drop, it isn't a
 * repeat -- and still isn't in the curated list or any live reference is more
 * often a typo than an invention. When such a guess sits a letter or two from a
 * word the player could actually have played, the game says so instead of only
 * reporting that the word wasn't found.
 *
 * Nothing here names the nearby word: that word is a playable answer for the
 * live drop, so revealing it would hand over a guess.
 */

/**
 * How far off a guess may be, by length. The nudge is only worth having if it
 * much more often describes a typo than a coincidence, so both thresholds are
 * measured rather than guessed: against made-up pronounceable words containing
 * the day's drop, this is how often each budget finds a "nearby" playable word
 * for one (n=2000 per cell, so +/- about a point):
 *
 *      length    1 edit    2 edits
 *        5        41.8%      93.6%
 *        6         9.6%      67.2%
 *        7         2.1%      26.6%
 *        8         0.4%       5.6%
 *        9+        0.2%       0.8%
 *
 * Both floors are the shortest length that keeps the false-fire rate under 10%.
 * Below them the budget stops being evidence of a typo and starts being a
 * property of short words: at five letters, two edits reach almost the whole
 * dictionary, and at seven, a quarter of made-up words look like near misses.
 *
 * The second edit is what buys transpositions ("recieve"), since a single
 * mistyped, dropped, or doubled letter is only one edit away to begin with. It
 * is worth having, but only where the word is long enough to afford it.
 */
export const NEAR_MISS_MIN_LENGTH = 6;
export const NEAR_MISS_TWO_EDIT_MIN_LENGTH = 8;

/** How many edits from `word` still counts as a near miss; 0 means don't check. */
export function nearMissEditBudget(word: string): number {
  if (word.length >= NEAR_MISS_TWO_EDIT_MIN_LENGTH) return 2;
  return word.length >= NEAR_MISS_MIN_LENGTH ? 1 : 0;
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
