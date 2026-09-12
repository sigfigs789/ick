/**
 * Pulling the website's players in, so one board can hold both games.
 *
 * The Reddit build keeps its own scores in Reddit's Redis and never sends a
 * username anywhere. The website's scores stay in Supabase. Neither moves --
 * what crosses is a periodic read, in one direction, of data the leaderboard
 * page already publishes to anyone who loads it.
 *
 * That direction is the whole design. A write would mean Reddit usernames
 * landing in a database Reddit has no relationship with, which is a question
 * about platform terms rather than about code. A read carries nothing out: the
 * request names a date window and nothing else, so it says nothing about who is
 * asking or who plays here.
 *
 * On a schedule rather than per request, for three reasons that all matter:
 * a board read stays local and fast, one fetch serves every player instead of
 * one per open page, and Supabase being unreachable degrades the board to
 * slightly stale rather than breaking it. The game has always held that a
 * recording failure must never reach the player; this is the same rule pointed
 * at a read.
 */

import { redis, settings } from '@devvit/web/server';
import { MAX_LIMIT, type BoardRow, type FoundRow } from '../../shared/leaderboard';

/** How long an imported board stays usable after the job that wrote it. */
const IMPORT_TTL_SECONDS = 6 * 60 * 60;

/** Where one imported board is cached. Mirrors the live board's key shape. */
const importBoardKey = (window: string, start: string) => `import:b:${window}:${start}`;
const importFindsKey = (date: string) => `import:f:${date}`;

/** One row as `leaderboard_public_board` returns it -- the SQL's own spelling. */
interface RawBoardRow {
  rank: number;
  player_id: string;
  window_word: string;
  window_zipf: number | string;
  total_score: number | string;
  puzzles: number;
}

/** One row as `leaderboard_public_words` returns it. */
interface RawWordRow {
  word: string;
  zipf: number | string | null;
  finders: number;
  found_on: string;
}

/**
 * Call one of the read-only functions.
 *
 * The anon key, never the service-role one: this key sits in a Reddit app
 * setting, and `anon` can reach nothing here but the two functions the
 * 20260911060000 migration grants it. Returns null on any failure -- an import
 * that does not land leaves the last one in place, which is the entire point of
 * caching it.
 */
async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T[] | null> {
  const [url, key] = await Promise.all([
    settings.get<string>('supabaseUrl'),
    settings.get<string>('supabaseAnonKey'),
  ]);
  // Unconfigured is not an error. An install with no key simply shows Reddit's
  // own players, which is a working board.
  if (!url || !key) return null;

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      console.error(`import: ${name} answered ${response.status}`);
      return null;
    }
    return (await response.json()) as T[];
  } catch (error) {
    console.error(`import: ${name} failed`, error);
    return null;
  }
}

/**
 * Fetch one window's board from the website and cache it.
 *
 * Two hundred rows rather than fifteen, because these are merged with Reddit's
 * own before anything is ranked: importing only the website's top fifteen would
 * drop a player who is sixteenth there and third on the combined board.
 */
export async function importBoard(window: string, start: string): Promise<number> {
  const rows = await callRpc<RawBoardRow>('leaderboard_public_board', {
    // A monthly or daily window is a date the website's own SQL has never been
    // asked for, but it takes any window start -- the function is bounded at the
    // near end only and the caller decides what the window means.
    p_since: start,
    p_limit: MAX_LIMIT,
  });
  if (!rows) return 0;

  const board: BoardRow[] = rows.map((row) => ({
    rank: row.rank,
    playerId: row.player_id,
    windowWord: row.window_word,
    windowZipf: Number(row.window_zipf),
    score: Number(row.total_score),
    puzzles: row.puzzles,
    // What makes the row render as `w/` rather than `u/`, and what stops it
    // ever being mistaken for a Reddit player's own row.
    source: 'w',
  }));

  await redis.set(importBoardKey(window, start), JSON.stringify(board));
  await redis.expire(importBoardKey(window, start), IMPORT_TTL_SECONDS);
  return board.length;
}

/** Fetch one puzzle's finds from the website and cache them. */
export async function importFinds(date: string): Promise<number> {
  const rows = await callRpc<RawWordRow>('leaderboard_public_words', {
    // The website's feed gates on a date strictly before this one, so a day
    // after the puzzle is what asks for the puzzle itself.
    p_before: nextDay(date),
    p_since: date,
    p_limit: 500,
  });
  if (!rows) return 0;

  const finds: FoundRow[] = rows.map((row) => ({
    word: row.word,
    zipf: Number(row.zipf ?? 0),
    finders: row.finders,
    foundOn: row.found_on,
  }));

  await redis.set(importFindsKey(date), JSON.stringify(finds));
  await redis.expire(importFindsKey(date), IMPORT_TTL_SECONDS);
  return finds.length;
}

/** The board imported for one window, or none when nothing has landed yet. */
export async function importedBoard(window: string, start: string): Promise<BoardRow[]> {
  return readCached<BoardRow>(importBoardKey(window, start));
}

/** The finds imported for one puzzle. */
export async function importedFinds(date: string): Promise<FoundRow[]> {
  return readCached<FoundRow>(importFindsKey(date));
}

/**
 * A cached import, or an empty list.
 *
 * Every failure here is silent and empty on purpose: a board that cannot read
 * its imported half is a board of Reddit's own players, which is a board. A
 * thrown parse error would be a blank page instead.
 */
async function readCached<T>(key: string): Promise<T[]> {
  try {
    const raw = await redis.get(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
