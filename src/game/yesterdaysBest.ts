import type { FoundWord } from "./leaderboard";

/**
 * The best word anybody found in a day's feed: the rarest, which is the lowest
 * Zipf.
 *
 * A tie goes to the word fewer players found -- the same rarity turned up by one
 * person is the better find -- and then to the alphabet, so two readers of the
 * same feed always see the same word. Undefined for a day nobody found anything.
 */
export function bestFind(words: readonly FoundWord[]): FoundWord | undefined {
  let best: FoundWord | undefined;
  for (const found of words) {
    if (
      !best ||
      found.zipf < best.zipf ||
      (found.zipf === best.zipf &&
        (found.finders < best.finders ||
          (found.finders === best.finders && found.word < best.word)))
    ) {
      best = found;
    }
  }
  return best;
}
