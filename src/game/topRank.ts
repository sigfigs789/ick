/**
 * A place in the top three of today's board.
 *
 * The last header celebration in priority (see headerCelebrations.ts): it shows
 * only on a day no other header celebration has had, in either group, and only
 * when today's board has at least TOP_RANK_MIN_PLAYERS players -- third of five
 * is not news. Today's board is a new board every day, so the card can come
 * every day; the one card a day the header celebrations allow is its only limit.
 * The weekly and monthly boards are left out: a player who holds a place there
 * would hear the same news every evening.
 *
 * Nothing here can get in the way of a game. The read is one small request, and
 * a failure or a player who has not joined the boards come back as "no rank".
 */

import { fetchBoards, type BoardEntry } from "./leaderboard";
import { loadPlayerId } from "./player";

/** The highest rank the card celebrates. */
export const TOP_RANK_MAX = 3;
/** The players today's board needs before a place on it is worth a card. */
export const TOP_RANK_MIN_PLAYERS = 15;

/**
 * The player's place on today's board when it is in the top three, or null.
 * A board counts only with at least TOP_RANK_MIN_PLAYERS rows, so it must be
 * read with at least that many (see checkTopRank).
 */
export function topRankIn(daily: BoardEntry[], playerId: string | null): number | null {
  if (!playerId || daily.length < TOP_RANK_MIN_PLAYERS) return null;
  const row = daily.find((entry) => entry.playerId === playerId);
  return row && row.rank >= 1 && row.rank <= TOP_RANK_MAX ? row.rank : null;
}

/**
 * Read `date`'s board and find the player's top-three place on it. Resolves to
 * the rank, or null; never rejects.
 */
export async function checkTopRank(date: string): Promise<number | null> {
  const playerId = loadPlayerId();
  if (!playerId) return null;
  try {
    // Enough rows to tell a board of fifteen from a smaller one, and the top three
    // are always among them. Fresh, so the last word's write has landed.
    const boards = await fetchBoards(date, { limit: TOP_RANK_MIN_PLAYERS, fresh: true });
    return topRankIn(boards.daily, playerId);
  } catch {
    return null;
  }
}
