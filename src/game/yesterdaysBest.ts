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

/**
 * The finders to name on the line, in the order they are named: the reader
 * first when they were one -- it is their find to be told about -- and
 * otherwise first finder first.
 */
export function orderedFinders(finderIds: readonly string[], selfId: string | null): string[] {
  if (selfId === null || !finderIds.includes(selfId)) return [...finderIds];
  return [selfId, ...finderIds.filter((id) => id !== selfId)];
}

/**
 * How many found the word: the feed's own count, which can run ahead of the ids
 * read a moment later, but never fewer than the ids themselves.
 */
export function finderTotal(finderIds: readonly string[], count: number): number {
  return Math.max(count, finderIds.length);
}

/** "1 other player", "3 other players". */
export function otherPlayers(others: number): string {
  return `${others} other ${others === 1 ? "player" : "players"}`;
}
