/**
 * Whether the player has moved up the days-played board.
 *
 * The board ranks every player by how many days they have played, either mode
 * (see the leaderboard_total_played SQL function), so a player climbs it the
 * one way there is: by turning up. The day's first word adds a day, and passes
 * whoever stood level with them that morning. As with the streak board (see
 * streakClimb.ts), this compares the rank the player holds now with the last
 * one this browser saw them at -- on the board itself, or on the last day they
 * played -- so "climbed" means "since you last looked".
 *
 * Asked on the same word the streak climb is, and only shown when the streak
 * group of header celebrations has nothing better to say that day (see
 * headerCelebrations.ts). A browser with no rank remembered yet learns one and
 * says nothing, since there is nothing to compare it with.
 *
 * Nothing here can get in the way of a game. The read is one small request, and
 * a failure or a player not on the board come back as "no climb".
 */

import { fetchTotalBoard, type TotalBoard } from "./leaderboard";
import { loadPlayerId } from "./player";

const RANK_KEY = "ick:daysRank";

export interface DaysClimb {
  /** The rank last seen. */
  from: number;
  /** The rank held now, smaller than `from`. */
  to: number;
  /** The days played that rank stands on. */
  days: number;
}

/** The player's row on the days-played board, or null when they have none. */
function daysRowIn(board: TotalBoard, playerId: string | null) {
  if (!playerId) return null;
  return (
    board.entries.find((entry) => entry.playerId === playerId) ??
    (board.self?.playerId === playerId ? board.self : null)
  );
}

/** The player's rank on the days-played board, or null when they have none. */
export function daysRankIn(board: TotalBoard, playerId: string | null): number | null {
  return daysRowIn(board, playerId)?.rank ?? null;
}

/** Remember the rank the player was just shown at. */
export function rememberDaysRank(rank: number | null): void {
  if (rank === null || rank < 1) return;
  try {
    localStorage.setItem(RANK_KEY, String(rank));
  } catch {
    // Storage that cannot be written means no comparison next time, at worst.
  }
}

/** The climb from the remembered rank to `rank`, or null when it is not one. */
export function daysClimb(rank: number | null, days: number): DaysClimb | null {
  const from = rememberedRank();
  if (rank === null || from === null || rank >= from) return null;
  return { from, to: rank, days };
}

/**
 * Read the player's rank on the days-played board, compare it with the last
 * one seen, and remember it. Resolves to the climb, or null; never rejects.
 */
export async function checkDaysClimb(): Promise<DaysClimb | null> {
  const playerId = loadPlayerId();
  if (!playerId) return null;
  try {
    // One row: the player's own comes back from below the cut with its real
    // rank. Fresh, because the shared copy can be a minute old -- from before
    // the word that did the climbing.
    const board = await fetchTotalBoard(playerId, { limit: 1, fresh: true });
    const row = daysRowIn(board, playerId);
    const rank = row?.rank ?? null;
    const climb = daysClimb(rank, row?.puzzles ?? 0);
    rememberDaysRank(rank);
    return climb;
  } catch {
    return null;
  }
}

function rememberedRank(): number | null {
  try {
    const rank = Number(localStorage.getItem(RANK_KEY));
    return Number.isInteger(rank) && rank >= 1 ? rank : null;
  } catch {
    return null;
  }
}
