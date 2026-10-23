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
 * Who to name on the line, and how many others found it too.
 *
 * The reader, when they were one of the finders -- it is their find to be told
 * about -- and otherwise the first player to find it. `count` is the feed's own
 * finder count, which can run ahead of the ids read a moment later; it is never
 * allowed to put the named finder's "others" below zero. Undefined when nobody
 * can be named, so the line falls back to the count alone.
 */
export function namedFinder(
  finderIds: readonly string[],
  count: number,
  selfId: string | null
): { id: string; self: boolean; others: number } | undefined {
  if (finderIds.length === 0) return undefined;
  const self = selfId !== null && finderIds.includes(selfId);
  const id = self ? selfId : finderIds[0];
  return { id, self, others: Math.max(count, finderIds.length) - 1 };
}

/** "Found by X", "Found by X and 1 other player", "Found by X and 3 other players". */
export function foundByLabel(name: string, others: number): string {
  if (others <= 0) return `Found by ${name}`;
  return `Found by ${name} and ${others} other ${others === 1 ? "player" : "players"}`;
}
