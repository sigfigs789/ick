/**
 * Whether the player has moved up the streak board.
 *
 * The board ranks live runs by their length (see the leaderboard_streaks SQL
 * function), so a player climbs it by playing: each day they keep the run going,
 * they pass whoever's run is one day shorter, and a run ending above them moves
 * them up as well. This compares the rank the player holds now with the last one
 * this browser saw them at -- on the streak board itself, or on the last day
 * their streak went up -- so "climbed" means "since you last looked".
 *
 * Asked only on the word that takes the streak up a day (today's first), and
 * only for a player who has joined the board: nobody else has a rank to climb. A browser with no rank remembered yet learns one and
 * says nothing, since there is nothing to compare it with.
 *
 * Nothing here can get in the way of a game. The read is one small request, and
 * a failure, a player not on the board, or a lost run all come back as "no
 * climb".
 */

import { fetchBoards, type Boards } from "./leaderboard";
import { loadPlayerId } from "./player";
import { rememberPlacing } from "./streakPlacings";

const RANK_KEY = "ick:streakRank";

export interface StreakClimb {
  /** The rank last seen. */
  from: number;
  /** The rank held now, smaller than `from`. */
  to: number;
}

/**
 * The player's rank on the streak board, or null when they hold none: not on
 * it, on a lost run (which keeps its place but no rank), or on a build with no
 * streak board at all.
 */
export function streakRankIn(
  boards: Pick<Boards, "streak" | "streakSelf">,
  playerId: string | null
): number | null {
  if (!playerId || !boards.streak) return null;
  const row =
    boards.streak.find((entry) => entry.playerId === playerId) ??
    (boards.streakSelf?.playerId === playerId ? boards.streakSelf : null);
  return row?.rank ?? null;
}

/**
 * Remember the rank the player was just shown at, on `date`'s board -- and,
 * for a top-three place, that they held it, and every place below it, that day.
 */
export function rememberStreakRank(rank: number | null, date: string): void {
  if (rank === null) return;
  try {
    localStorage.setItem(RANK_KEY, String(rank));
  } catch {
    // Storage that cannot be written means no comparison next time, at worst.
  }
  rememberPlacing(rank, date);
}

/** The climb from the remembered rank to `rank`, or null when it is not one. */
export function streakClimb(rank: number | null): StreakClimb | null {
  const from = rememberedRank();
  if (rank === null || from === null || rank >= from) return null;
  return { from, to: rank };
}

/**
 * Read the player's rank on `date`'s streak board, compare it with the last one
 * seen, and remember it. Resolves to the climb, or null; never rejects.
 */
export async function checkStreakClimb(date: string): Promise<StreakClimb | null> {
  const playerId = loadPlayerId();
  if (!playerId) return null;
  try {
    // One row per board: the player's own comes back from below the cut with
    // its real rank. Fresh, because the shared copy can be a minute old -- from
    // before the play that did the climbing.
    const boards = await fetchBoards(date, { limit: 1, fresh: true });
    const rank = streakRankIn(boards, playerId);
    const climb = streakClimb(rank);
    rememberStreakRank(rank, date);
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
