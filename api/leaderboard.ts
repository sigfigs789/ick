// The leaderboard: a Vercel Edge Function that reads the weekly and all-time
// boards, and takes the score submissions that fill them.
//
// GET /api/leaderboard?since=YYYY-MM-DD&limit=50
//   -> { weekStart, weekly: [...], allTime: [...] }
//   The weekly board counts puzzles from `since` onward; all-time counts
//   everything. `since` comes from the client because the puzzle date it
//   brackets is the player's own local calendar date (see src/game/week.ts), so
//   the week has to be measured on the same clock.
//
// POST /api/leaderboard  { playerId, name, date, total, top, words }
//   -> 202 accepted, 400 malformed, 503 no credentials
//   One score per player per puzzle. The write is an upsert that keeps the
//   higher of the stored and submitted score, so submitting after every word is
//   safe in any order (see the migration).
//
// There are no accounts in this game, so a submission cannot be authenticated:
// anyone who reads this file can post a score under a name of their choosing.
// What the endpoint can do, and does, is refuse anything a real game could not
// have produced -- a score above the day's ceiling, a puzzle date in the future
// or before the game existed, a name that isn't one. That keeps the board honest
// against ordinary noise, and it is not a defence against someone determined to
// forge a score. Worth knowing before this board is used for anything that
// matters.
//
// Both reads are CDN-cached briefly: a leaderboard a minute out of date is
// indistinguishable from a live one, and it keeps a popular day from turning
// every open of the modal into a database query.

import { record, rpc, supabaseConfigured, type EdgeContext } from "./_supabase";

export const config = { runtime: "edge" };

/** The first puzzle. Nothing can be scored before the game existed. */
const EPOCH = "2026-07-01";
/** The earliest Monday a weekly window can start on: the one bracketing EPOCH. */
const WINDOW_FLOOR = "2026-06-25";
/**
 * The most a single puzzle can be worth: six guesses (the pre-2026-08-20 limit,
 * and the highest the game has ever allowed) at a perfect 10. Bounding on the
 * historical maximum rather than today's five keeps an archived six-word day
 * submittable if that path is ever opened up, and still rejects anything
 * arithmetic can't reach.
 */
const MAX_TOTAL = 60;
const MAX_TOP = 10;
const MAX_WORDS = 6;
const MAX_NAME_CHARS = 18;
const MAX_BODY_BYTES = 2 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row as `leaderboard_board` returns it. */
interface BoardRow {
  player_id: string;
  display_name: string;
  total_score: number | string;
  best_score: number | string | null;
  puzzles: number;
}

/** One row as the client wants it: short keys, numbers already numbers. */
interface BoardEntry {
  playerId: string;
  name: string;
  score: number;
  best: number;
  puzzles: number;
}

function reply(status: number, body?: unknown, cacheSeconds = 0): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheSeconds
        ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=300`
        : "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

/**
 * PostgREST returns `numeric` as a string, since not every numeric fits a JSON
 * number. These all do -- a score is at most a few thousand with one decimal --
 * so they are parsed here rather than pushed onto the client.
 */
function toNumber(value: number | string | null): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toEntries(rows: BoardRow[] | null): BoardEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    playerId: String(row.player_id),
    name: String(row.display_name),
    score: toNumber(row.total_score),
    best: toNumber(row.best_score),
    puzzles: Number(row.puzzles) || 0,
  }));
}

/** Today in UTC. Only ever used as an upper bound, never as a puzzle date. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A real calendar date, no later than the game has reached, and no earlier than
 * `floor`. One day of slack past UTC today, because the date is the player's own
 * local one and the eastern timezones are already on tomorrow's puzzle while UTC
 * is not.
 */
function validDate(date: string, floor: string): boolean {
  if (!DATE_RE.test(date)) return false;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  const tomorrow = new Date(Date.parse(`${utcToday()}T00:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
  return date >= floor && date <= tomorrow;
}

/** A date a puzzle actually exists for. */
function validPuzzleDate(date: string): boolean {
  return validDate(date, EPOCH);
}

/**
 * A weekly window's start. Floored a week below the epoch rather than at it:
 * the game's first puzzle fell mid-week, so the Monday that brackets it
 * predates the epoch and is a perfectly legitimate window start.
 */
function validWindowStart(date: string): boolean {
  return validDate(date, WINDOW_FLOOR);
}

/** A submitted score, or a string saying what was wrong with it. */
function readSubmission(parsed: unknown):
  | {
      playerId: string;
      name: string;
      date: string;
      total: number;
      top: number;
      words: number;
    }
  | string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "malformed-body";
  const { playerId, name, date, total, top, words } = parsed as Record<string, unknown>;

  if (typeof playerId !== "string" || !UUID_RE.test(playerId)) return "bad-player-id";
  if (typeof name !== "string") return "bad-name";
  // The client normalises the name before it gets here (see game/player.ts);
  // this is the same rule enforced where it can't be edited out.
  const cleanName = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS).trim();
  if (cleanName.length < 2) return "bad-name";
  if (typeof date !== "string" || !validPuzzleDate(date)) return "bad-date";

  const scores = { total, top, words };
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return `bad-${key}`;
  }
  const totalScore = total as number;
  const topScore = top as number;
  const wordCount = words as number;
  if (totalScore > MAX_TOTAL) return "bad-total";
  if (topScore > MAX_TOP) return "bad-top";
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount > MAX_WORDS) return "bad-words";
  // A single word cannot be worth more than the whole game, and the whole game
  // cannot be worth more than every word scoring a perfect 10. Both would mean
  // the client and this endpoint disagree about scoring, which is worth refusing
  // rather than storing.
  if (topScore > totalScore + 0.05) return "inconsistent-scores";
  if (totalScore > wordCount * MAX_TOP + 0.05) return "inconsistent-scores";

  return {
    playerId,
    name: cleanName,
    date,
    total: Math.round(totalScore * 100) / 100,
    top: Math.round(topScore * 100) / 100,
    words: wordCount,
  };
}

async function handleGet(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const since = params.get("since") ?? "";
  if (!validWindowStart(since)) {
    return reply(400, { ok: false, reason: "bad-since" });
  }
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    // Two queries rather than one, because they are two different windows over
    // the same rows and Postgres is the right place to do each. Issued together
    // so the round trips overlap.
    const [weekly, allTime] = await Promise.all([
      rpc<BoardRow[]>("leaderboard_board", { p_since: since, p_limit: limit }),
      rpc<BoardRow[]>("leaderboard_board", { p_since: null, p_limit: limit }),
    ]);
    return reply(
      200,
      { weekStart: since, weekly: toEntries(weekly), allTime: toEntries(allTime) },
      // A minute: long enough that a burst of opens costs one query, short
      // enough that a player who just scored sees themselves move.
      60
    );
  } catch (error) {
    // Logged for an operator, and reported to the client only as "unavailable".
    // The modal shows a retry; it never shows a stack trace or an empty board.
    console.error("[leaderboard] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handlePost(request: Request, context?: EdgeContext): Promise<Response> {
  // Same-origin only when the caller declares an origin, which every browser
  // does on a POST. Cheap, and it takes the endpoint off the list of things any
  // page on the web can post to. See api/events.ts, which does the same.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply(403, { ok: false, reason: "bad-origin" });
    }
    if (originHost !== new URL(request.url).host) {
      return reply(403, { ok: false, reason: "cross-origin" });
    }
  }

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, reason: "too-large" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, reason: "malformed-json" });
  }

  const submission = readSubmission(parsed);
  if (typeof submission === "string") return reply(400, { ok: false, reason: submission });

  // Said plainly rather than answered with a silent 202: a deployment with no
  // credentials is a setup problem, and an empty board is a miserable way to
  // discover it. The client ignores this either way.
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  await record(
    "rpc/submit_leaderboard_score",
    {
      p_player_id: submission.playerId,
      p_puzzle_date: submission.date,
      p_display_name: submission.name,
      p_total_score: submission.total,
      p_top_score: submission.top,
      p_words: submission.words,
    },
    context
  );
  // 202 rather than 200: the write may be handed to `waitUntil` and finish after
  // this response, so the endpoint can honestly say it accepted the score, never
  // that the row landed.
  return reply(202);
}

export default async function handler(request: Request, context?: EdgeContext): Promise<Response> {
  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request, context);
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST", "cache-control": "no-store" },
  });
}
