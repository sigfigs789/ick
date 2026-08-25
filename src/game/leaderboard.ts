/**
 * The client half of the leaderboard: submit today's score, fetch the boards.
 *
 * Both directions are strictly optional to the game. Submitting is
 * fire-and-forget -- it happens after a word has already been accepted, saved
 * and rendered, and a failure is never surfaced. Fetching is only ever done by
 * the leaderboard modal, so a player who never opens it never makes the
 * request, and the modal's own error state is the whole of the failure
 * handling. Nothing here can keep anyone from playing a puzzle.
 */

import { maxGuessesFor } from "./constants";
import { topRarityScore, totalRarityScore } from "./dictionary";
import { todayDateString } from "./date";
import { loadPlayer, type Player } from "./player";
import type { AcceptedWord } from "./types";
import { weekStart } from "./week";

export type BoardScope = "weekly" | "all-time";

export interface BoardEntry {
  /** Rank on this board, 1-based, as the server ordered it. */
  rank: number;
  playerId: string;
  name: string;
  /** Summed rarity score over the board's window. */
  score: number;
  /** Best single word inside the window. */
  best: number;
  /** How many puzzles the player scored on inside the window. */
  puzzles: number;
}

export interface Boards {
  weekly: BoardEntry[];
  allTime: BoardEntry[];
  /** The Monday the weekly board is counting from, echoed back by the server. */
  weekStart: string;
}

/** How many rows each board returns. Enough to scroll, not enough to be a wall. */
const BOARD_LIMIT = 50;
// A board is worth waiting a moment for, but not worth a spinner that never
// ends -- past this the modal says it couldn't load and offers a retry.
const FETCH_TIMEOUT_MS = 6000;

interface RawEntry {
  playerId?: unknown;
  name?: unknown;
  score?: unknown;
  best?: unknown;
  puzzles?: unknown;
}

/**
 * Read one board out of the response, dropping anything malformed rather than
 * throwing. Ranks are assigned here from the array order the server sent, which
 * is the order its SQL produced -- the client never re-sorts, so what a player
 * sees is always what the database ranked.
 */
function parseBoard(raw: unknown): BoardEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: BoardEntry[] = [];
  for (const item of raw as RawEntry[]) {
    if (!item || typeof item !== "object") continue;
    const { playerId, name, score, best, puzzles } = item;
    if (typeof playerId !== "string" || typeof name !== "string") continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    entries.push({
      rank: entries.length + 1,
      playerId,
      name,
      score,
      best: typeof best === "number" && Number.isFinite(best) ? best : 0,
      puzzles: typeof puzzles === "number" && Number.isFinite(puzzles) ? puzzles : 0,
    });
  }
  return entries;
}

/**
 * Fetch both boards in one request.
 *
 * The week's start is sent rather than derived server-side: the puzzle date is
 * already the player's own local calendar date, so the window that brackets it
 * has to come from the same clock (see game/week.ts). Rejects on failure; the
 * caller turns that into the modal's error state.
 */
export async function fetchBoards(date: string = todayDateString()): Promise<Boards> {
  const since = weekStart(date);
  const response = await fetch(
    `/api/leaderboard?since=${encodeURIComponent(since)}&limit=${BOARD_LIMIT}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`leaderboard ${response.status}`);
  const body = (await response.json()) as { weekly?: unknown; allTime?: unknown; weekStart?: unknown };
  return {
    weekly: parseBoard(body.weekly),
    allTime: parseBoard(body.allTime),
    weekStart: typeof body.weekStart === "string" ? body.weekStart : since,
  };
}

/**
 * Send this puzzle's score up, if there is anything to send.
 *
 * Refuses in three cases, each on purpose:
 *   - nobody has joined the board on this browser, so there is no name to post;
 *   - the puzzle isn't today's, because archive play is off the board for the
 *     same reason it is off the streak (you can look up the answers);
 *   - no words have been accepted, so there is no score.
 *
 * Never awaited by a caller on the play path. `keepalive` so a submission
 * survives the tab being closed right after a word lands, and every failure is
 * swallowed: a score that didn't make it is not something to interrupt a game
 * over. Returns whether a request was actually started, which is what the tests
 * assert on.
 */
export function submitScore(options: {
  date: string;
  isToday: boolean;
  words: readonly AcceptedWord[];
  player?: Player | null;
}): boolean {
  const { date, isToday, words } = options;
  const player = options.player ?? loadPlayer();
  if (!player || !isToday || words.length === 0) return false;

  const body = JSON.stringify({
    playerId: player.id,
    name: player.name,
    date,
    total: totalRarityScore(words, date),
    top: topRarityScore(words, date),
    // Capped rather than trusted: the endpoint bounds this too, and sending
    // more than the day's guess limit allows would only get the row rejected.
    words: Math.min(words.length, maxGuessesFor(date)),
  });

  try {
    void fetch("/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Recording a score must never be able to break the move that earned it.
    return false;
  }
  return true;
}
