/**
 * The leaderboard endpoint, as the shared client already speaks it.
 *
 * Same paths, same query parameters, same response keys as
 * `api/leaderboard.ts`, so `src/game/leaderboard.ts` needs no branch for which
 * host it is running on. Two things differ, and both follow from being inside a
 * Reddit post:
 *
 *   - Who is asking comes from the post, not from the request. The website takes
 *     a `player` UUID on the query string and a `playerId` in the POST body
 *     because there are no accounts there; here the server knows the Reddit
 *     username, so both are ignored. A client that names itself on a board it
 *     competes in is a client that can name somebody else.
 *   - There is no CDN in front of this, so the cache headers the website sets
 *     are gone. Redis is the thing being protected instead, and the read path is
 *     a range query and a hydrate rather than a grouped scan.
 */

import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import {
  BOARD_LIMIT,
  DATE_RE,
  MAX_SCORES,
  validScore,
  type BoardsResponse,
  type ScoreSubmission,
} from '../../shared/leaderboard';
import { monthStartOf, weekStartOf } from '../../shared/windows';
import { readBoard, readFinds, readSelf, submitScores } from '../core/leaderboard';

export const leaderboard = new Hono();

/**
 * The first puzzle, which is the floor on every date this endpoint accepts.
 *
 * Mirrors `FIRST_PUZZLE` in `src/game/drop.ts`. Unlike the window helpers in
 * `src/shared/windows.ts` this one is a bare constant rather than a body of
 * logic, so it is repeated here rather than pinned by a test.
 */
const FIRST_PUZZLE = '2026-07-01';

leaderboard.get('/', async (c) => {
  const url = new URL(c.req.url);

  // The finds feed is its own request rather than a key on the boards. The
  // boards are private to the player asking -- they carry that player's own row
  // -- while this list is the same for everybody, and it is the only part of the
  // page that has to be live, so it is the part that gets polled.
  if (url.searchParams.get('words')) {
    const day = puzzleDate(url.searchParams.get('today'));
    return c.json({ words: await readFinds(day) });
  }

  // Every window comes from the client, because the puzzle date they bracket is
  // the player's own local calendar date and nothing on this side shares that
  // clock. Each is bounded to a date a puzzle exists for, then re-derived, so a
  // caller cannot ask for a window that is not a real one.
  const today = puzzleDate(url.searchParams.get('today'));
  const day = puzzleDate(url.searchParams.get('day') ?? today);
  const week = weekStartOf(puzzleDate(url.searchParams.get('since') ?? today));
  const month = monthStartOf(puzzleDate(url.searchParams.get('month') ?? today));
  const limit = boundedLimit(url.searchParams.get('limit'));

  // Who is asking is the account, not the query string. A logged-out reader gets
  // the boards and no self row, which is exactly what the website does for a
  // browser that has never joined.
  const user = (await reddit.getCurrentUsername()) ?? null;

  const [daily, weekly, monthly] = await Promise.all([
    readBoard('d', day, limit),
    readBoard('w', week, limit),
    readBoard('m', month, limit),
  ]);

  const [dailySelf, weeklySelf, monthlySelf] = user
    ? await Promise.all([
        readSelf('d', day, user, daily),
        readSelf('w', week, user, weekly),
        readSelf('m', month, user, monthly),
      ])
    : [null, null, null];

  const body: BoardsResponse = {
    // There is no opening date any more, so the gate the website's SQL still
    // carries is simply always open.
    ready: true,
    weekStart: week,
    daily,
    dailySelf,
    weekly,
    weeklySelf,
    // The monthly board, under the name the wire has always used for it.
    allTime: monthly,
    allTimeSelf: monthlySelf,
  };
  return c.json(body);
});

leaderboard.post('/', async (c) => {
  const user = await reddit.getCurrentUsername();
  // Nothing to rank an anonymous reader as. Not an error the game should ever
  // see -- submitting is fire-and-forget on the play path and its failures are
  // swallowed -- so this says "accepted, wrote nothing" rather than refusing.
  if (!user) return c.json({ days: 0 }, 202);

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'malformed' }, 400);
  }

  const raw = (payload as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(raw)) return c.json({ error: 'malformed' }, 400);
  if (raw.length > MAX_SCORES) return c.json({ error: 'too-many' }, 400);

  // Bounds are checked here as well as at the edges of the game, so a value
  // arithmetic cannot reach never gets stored at all. An entry that fails is
  // dropped rather than failing the batch: a player's history is theirs, and one
  // unparseable day should not cost them the rest of it.
  const scores = raw.filter((entry): entry is ScoreSubmission => validScore(entry));
  const days = await submitScores(user, scores.filter((s) => s.date >= FIRST_PUZZLE));

  // `postId` only to make a write traceable in the logs to the post it came
  // from; nothing about a score depends on it yet. When the post becomes the
  // puzzle, this is where that starts.
  console.log(`leaderboard: ${user} wrote ${days} day(s) from ${context.postId ?? 'no post'}`);
  return c.json({ days }, 202);
});

/**
 * A date a puzzle actually exists for.
 *
 * No earlier than the first one and no later than the furthest ahead any local
 * calendar can be -- a caller on the far side of the date line is a day ahead of
 * UTC, and that is a real player on a real puzzle, not a lying client.
 */
function puzzleDate(claimed: string | null): string {
  const ceiling = shiftDays(utcToday(), 1);
  if (claimed && DATE_RE.test(claimed) && claimed >= FIRST_PUZZLE && claimed <= ceiling) {
    return claimed;
  }
  // No date, or one no puzzle exists for. UTC's own day is the only guess
  // available and is right for most of the world's clock; a real client always
  // sends its own.
  return utcToday();
}

function boundedLimit(claimed: string | null): number {
  const limit = Number(claimed);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : BOARD_LIMIT;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
