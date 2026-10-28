/**
 * A place in the top three of the daily, weekly or monthly board.
 *
 * The last header celebration in priority (see headerCelebrations.ts): it shows
 * only on a day no other header celebration has had, in either group, at most
 * once a week across all three boards, and only on a board with
 * at least TOP_RANK_MIN_PLAYERS players -- third of five is not news. When the
 * player is up on more than one board at once, the longest window wins: a month
 * at the top says more than a day.
 *
 * Nothing here can get in the way of a game. The read is one small request, and
 * a failure or a player who has not joined the boards come back as "no rank".
 */

import { addDays } from "./date";
import { fetchBoards, type BoardEntry, type Boards } from "./leaderboard";
import { loadPlayerId } from "./player";

export type TopRankBoard = "monthly" | "weekly" | "daily";

export interface TopRank {
  board: TopRankBoard;
  /** 1, 2 or 3. */
  rank: number;
}

/** The highest rank the card celebrates. */
export const TOP_RANK_MAX = 3;
/** The players a board needs before a place on it is worth a card. */
export const TOP_RANK_MIN_PLAYERS = 20;
/** Days after one card before the next, whichever board each was for. */
export const TOP_RANK_COOLDOWN_DAYS = 7;

/** In priority order: the longest window first. */
const BOARDS: TopRankBoard[] = ["monthly", "weekly", "daily"];

const CELEBRATED_KEY = "ick:topRankCelebrated";

/**
 * The player's best top-three place across the three boards, monthly first,
 * or null. A board counts only with at least TOP_RANK_MIN_PLAYERS rows, so it
 * must be read with at least that many (see checkTopRank).
 */
export function topRankIn(
  boards: Pick<Boards, TopRankBoard>,
  playerId: string | null
): TopRank | null {
  if (!playerId) return null;
  for (const board of BOARDS) {
    const rows: BoardEntry[] = boards[board];
    if (rows.length < TOP_RANK_MIN_PLAYERS) continue;
    const row = rows.find((entry) => entry.playerId === playerId);
    if (row && row.rank >= 1 && row.rank <= TOP_RANK_MAX) return { board, rank: row.rank };
  }
  return null;
}

/** Whether a top-three card may show on `date`: none in the last week. */
export function topRankCelebrationDue(date: string): boolean {
  const last = readCelebrated();
  if (!last) return true;
  return date >= addDays(last, TOP_RANK_COOLDOWN_DAYS);
}

/** Remember that a top-three card showed on `date`. */
export function markTopRankCelebrated(date: string): void {
  try {
    localStorage.setItem(CELEBRATED_KEY, date);
  } catch {
    // Storage that cannot be written means a second card within the week, at worst.
  }
}

/**
 * Read `date`'s boards and find the player's best top-three place. Resolves to
 * it, or null; never rejects.
 */
export async function checkTopRank(date: string): Promise<TopRank | null> {
  const playerId = loadPlayerId();
  if (!playerId) return null;
  try {
    // Enough rows to tell a board of twenty from a smaller one, and the top three
    // are always among them. Fresh, so the word just played has landed.
    const boards = await fetchBoards(date, { limit: TOP_RANK_MIN_PLAYERS, fresh: true });
    return topRankIn(boards, playerId);
  } catch {
    return null;
  }
}

function readCelebrated(): string | null {
  try {
    return localStorage.getItem(CELEBRATED_KEY);
  } catch {
    return null;
  }
}
