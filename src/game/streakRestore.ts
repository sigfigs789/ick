import { STREAK_KEY } from "./storage";
import type { StreakState } from "./types";

/**
 * Carrying a streak into a fresh browser, for Muse AI.
 *
 * The streak lives in this browser (`ick:streak`, see game/storage.ts). Muse
 * starts every run in a new one, playing under the id it played as before
 * (`adoptPlayerFromUrl` in game/player.ts), so its board rows were one player
 * while its streak started over at one every day. The board already holds
 * the streak as each game reports it (`streakReport` in game/streakFreeze.ts),
 * so a browser that has just adopted an id reads that back and starts from it.
 *
 * Only there: a browser that already has a streak keeps its own, and one that
 * minted its id is a new player with nothing to fetch. A player on another
 * device moves with a transfer link (game/transfer.ts), which carries the
 * whole record rather than this summary of it.
 *
 * What comes back is the streak as of its last played day -- the run, the
 * longest run, the freezes saved then -- and the days played in the fortnight
 * up to it, which decide whether a weekend was earned off. `loadStreak` then
 * spends freezes on the days missed since, or ends the run, exactly as it
 * would have on the browser that played it.
 */

/** What `GET /api/leaderboard?restore=` returns for a player with a streak. */
export interface RestoredStreak {
  current: number;
  best: number;
  saved: number;
  lastPlayed: string;
  playedDates: string[];
  daysPlayed: number;
}

/** Long enough for a cold edge function, short enough that a stuck one does not hold up the game. */
const RESTORE_TIMEOUT_MS = 3000;

/** The most saved freezes a streak can hold (see MAX_SAVED_FREEZES in api/leaderboard.ts). */
const MAX_SAVED_FREEZES = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The restored streak, or null for one that is absent or does not add up. */
export function parseRestoredStreak(raw: unknown): RestoredStreak | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { current, best, saved, lastPlayed, playedDates, daysPlayed } = raw as Record<string, unknown>;
  if (typeof lastPlayed !== "string" || !DATE_RE.test(lastPlayed)) return null;
  if (!Number.isInteger(current) || (current as number) < 1) return null;
  if (!Number.isInteger(best) || (best as number) < (current as number)) return null;
  if (!Number.isInteger(saved) || (saved as number) < 0 || (saved as number) > MAX_SAVED_FREEZES) {
    return null;
  }
  const dates = Array.isArray(playedDates)
    ? playedDates.filter((d): d is string => typeof d === "string" && DATE_RE.test(d) && d <= lastPlayed)
    : [];
  return {
    current: current as number,
    best: best as number,
    saved: saved as number,
    lastPlayed,
    playedDates: [...new Set([...dates, lastPlayed])].sort(),
    daysPlayed: Number.isInteger(daysPlayed) ? (daysPlayed as number) : 0,
  };
}

/**
 * The stored streak a restore starts from. The counters the board does not
 * keep -- the high score, the crushed-it and elite tallies -- start at zero,
 * and puzzles completed at the days on the board, the closest it has.
 */
export function streakFromRestore(restored: RestoredStreak): StreakState {
  return {
    currentStreak: restored.current,
    longestStreak: restored.best,
    lastCompletedDate: restored.lastPlayed,
    totalCompleted: Math.max(restored.daysPlayed, restored.current),
    crushedIt: 0,
    elite: 0,
    highScore: 0,
    bankedFreezes: restored.saved,
    // The board's saved count is already what the run held, so there is
    // nothing from before freezes existed to grant it.
    freezesBackdated: true,
    playedDates: restored.playedDates,
  };
}

/** Read the player's streak from the board. Null when there is none; rejects on failure. */
export async function fetchRestoredStreak(playerId: string): Promise<RestoredStreak | null> {
  const response = await fetch(`/api/leaderboard?restore=${encodeURIComponent(playerId)}`, {
    signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`streak restore ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseRestoredStreak(body.streak);
}

/**
 * Give this browser the streak `playerId` played under elsewhere, if it has
 * none of its own. Never rejects: a restore that fails leaves the browser as
 * it was, which is a streak starting over and nothing worse.
 */
export async function restoreStreak(playerId: string): Promise<boolean> {
  try {
    if (localStorage.getItem(STREAK_KEY)) return false;
    const restored = await fetchRestoredStreak(playerId);
    // Checked again: nothing should have played while this was in flight, but
    // a streak this browser made itself always wins over one read back.
    if (!restored || localStorage.getItem(STREAK_KEY)) return false;
    localStorage.setItem(STREAK_KEY, JSON.stringify(streakFromRestore(restored)));
    return true;
  } catch {
    return false;
  }
}
