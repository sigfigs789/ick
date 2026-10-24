import { formatRarityScore } from "./dictionary";
import type { FoundWord } from "./leaderboard";

/** The score a find shows, which is what two words have to share to tie. */
function shownScore(found: FoundWord): string {
  return formatRarityScore(found.zipf, found.foundOn || undefined);
}

/**
 * The words in the running for a day's best: every word showing the top score.
 *
 * The rarest word (the lowest Zipf) sets the score, and anything else that
 * prints the same number ties with it -- two words a reader sees as 9.87 are a
 * tie whatever their Zipf says past the second decimal. Empty for a day nobody
 * found anything.
 */
export function bestCandidates(words: readonly FoundWord[]): FoundWord[] {
  let rarest: FoundWord | undefined;
  for (const found of words) {
    if (!rarest || found.zipf < rarest.zipf) rarest = found;
  }
  if (!rarest) return [];
  const top = shownScore(rarest);
  return words.filter((found) => shownScore(found) === top);
}

/**
 * A stand-in for a coin toss that every reader tosses the same way: FNV-1a over
 * the day and the word. Random enough to favour nobody, and stable, so the line
 * does not change word between renders or between two players' screens.
 */
function toss(date: string, word: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${date}:${word}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The day's best word out of its tied candidates (see `bestCandidates`).
 *
 * 1. The word whose player has had the best word least often -- so a tie
 *    hands the line to somebody it has not named much. A word's player is its
 *    first finder (`holders`); `wins` counts their best words before this day.
 *    Skipped when any candidate's player is unknown, since a word whose finder
 *    could not be read cannot be weighed against one whose could.
 * 2. Then -- which is also where two words of the same player land -- the
 *    longer word.
 * 3. Then a coin toss, the same one for every reader (see `toss`).
 */
export function pickBest(
  candidates: readonly FoundWord[],
  date: string,
  holders: ReadonlyMap<string, string> = new Map(),
  wins: Readonly<Record<string, number>> = {},
): FoundWord | undefined {
  const byPlayer = candidates.every((found) => holders.has(found.word));
  const winsOf = (found: FoundWord) =>
    byPlayer ? (wins[holders.get(found.word) as string] ?? 0) : 0;
  let best: FoundWord | undefined;
  for (const found of candidates) {
    if (!best) {
      best = found;
      continue;
    }
    const byWins = winsOf(found) - winsOf(best);
    const byLength = best.word.length - found.word.length;
    if (
      byWins < 0 ||
      (byWins === 0 &&
        (byLength < 0 || (byLength === 0 && toss(date, found.word) < toss(date, best.word))))
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
