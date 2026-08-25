// The leaderboard: a Vercel Edge Function that reads the weekly and all-time
// boards, and takes the score submissions that fill them.
//
// GET /api/leaderboard?since=YYYY-MM-DD&today=YYYY-MM-DD&limit=50
//   -> { weekStart, ready, players, minPlayers, weekly: [...], allTime: [...],
//        words: [...] }
//   The weekly board counts puzzles from `since` onward; all-time counts
//   everything. `since` comes from the client because the puzzle date it
//   brackets is the player's own local calendar date (see src/game/week.ts), so
//   the week has to be measured on the same clock.
//
//   Boards stay unpublished until MIN_PLAYERS distinct players have scored all
//   time: `ready` says whether they are, and until they are, both arrays come
//   back empty and `players` is what there is to show. The gate is enforced in
//   SQL, so below the threshold no row leaves the database at all -- there is no
//   partial board sitting in a response waiting to be read out of a network tab.
//
//   `words` is the recent finds feed -- the best word each player found on each
//   of the last few days -- and is *not* behind that gate, because a short list
//   of good words is interesting at any size. It is behind a different and much
//   harder gate: see SPOILER_CUTOFF below.
//
// PUT /api/leaderboard   { playerId, name }
//   -> 200 { ok: true }, 409 the word is not one of that player's own finds
//   Choose which of your own words the board calls you by. The word is checked
//   against that player's submitted days in SQL, so there is no name anybody can
//   claim they did not earn under their own id.
//
// POST /api/leaderboard  { playerId, scores: [{ date, word, zipf, total, top, words }] }
//   -> 202 { days }, 400 malformed, 503 no credentials
//   One score per player per puzzle. An array because it has two callers of the
//   same shape: the game submitting today after each accepted word, and a player
//   joining the board submitting every past puzzle their browser remembers. The
//   write keeps the higher of the stored and submitted score, so repeats and
//   out-of-order arrivals are both harmless (see the migration).
//
//   No name is sent. Each day carries its own rarest word, and the board derives
//   both the things it shows from those rows: a player's name is the rarest word
//   across all of them, and the weekly board's detail is the rarest inside the
//   window. Nothing to keep in step, and nothing a client can assert about itself.
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
/** The earliest Sunday a weekly window can start on: the one bracketing EPOCH. */
const WINDOW_FLOOR = "2026-06-28";
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
/**
 * A day's rarest word, which is also what the board calls players. Validated as
 * a word: lowercase English letters, the same rule the game's own input uses.
 *
 * A real narrowing rather than a formality. A name typed by a player would be a
 * sanitising problem on a public, unauthenticated endpoint whose values are shown
 * to other players -- invisible characters, bidi overrides, impersonation of the
 * page's own copy. A pattern this tight leaves none of it: there is nothing
 * expressible here but a word, and the longest word the game accepts is 30
 * letters.
 */
const WORD_RE = /^[a-z]{2,30}$/;
/** Zipf runs roughly -2 (attested nowhere) to 8 ("the"); bounded wide. */
const MIN_ZIPF = -10;
const MAX_ZIPF = 10;
/** How many distinct all-time players before the boards are shown to anyone. */
const MIN_PLAYERS = 10;
/** How many days of finds the words feed reaches back over. */
const WORDS_WINDOW_DAYS = 7;
/**
 * A batch is a browser's whole playing history, so it has to hold a couple of
 * years of daily puzzles. The body cap below is the real limit; this one stops a
 * caller naming the same handful of days ten thousand times.
 */
const MAX_SCORES = 800;
// Big enough for MAX_SCORES entries of roughly 50 bytes each, with room to spare.
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row as `leaderboard_board` returns it. */
interface BoardRow {
  rank: number;
  player_id: string;
  name: string;
  name_zipf: number | string | null;
  window_word: string;
  window_zipf: number | string | null;
  total_score: number | string;
  puzzles: number;
}

/**
 * One row as the client wants it: short keys, numbers already numbers.
 *
 * Words and frequencies rather than scores, because scoring is the client's job
 * -- it ships the dictionary, so it can price a word at today's rates, and every
 * player on the board gets priced the same way on the same day.
 */
interface BoardEntry {
  rank: number;
  playerId: string;
  /** The player's rarest word ever: their name, and stable across weeks. */
  name: string;
  nameZipf: number;
  /** The rarest word inside this board's window -- this week's find, weekly. */
  windowWord: string;
  windowZipf: number;
  score: number;
  puzzles: number;
}

/** One word as `leaderboard_words` returns it. */
interface WordRow {
  word: string;
  zipf: number | string | null;
  finders: number;
  found_on: string;
}

/** One word as the client wants it. */
interface WordEntry {
  word: string;
  /** Frequency, so the client can price it with today's dictionary. */
  zipf: number;
  /** How many players' best word of the day this was. */
  finders: number;
  /** The most recent puzzle date it was somebody's best find on. */
  foundOn: string;
}

/** What `leaderboard_boards` answers with: the gate, the rows, and the feed. */
interface BoardsResult {
  ready: boolean;
  players: number;
  minPlayers: number;
  weekly: BoardRow[];
  allTime: BoardRow[];
  words: WordRow[];
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
  return rows.map((row, index) => ({
    // The database ranked these; the fallback is only for a row that somehow
    // arrived without one, and keeps the column non-null for the client.
    rank: Number(row.rank) || index + 1,
    playerId: String(row.player_id),
    name: String(row.name),
    nameZipf: toNumber(row.name_zipf),
    windowWord: String(row.window_word),
    windowZipf: toNumber(row.window_zipf),
    score: toNumber(row.total_score),
    puzzles: Number(row.puzzles) || 0,
  }));
}

function toWords(rows: WordRow[] | null): WordEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    word: String(row.word),
    zipf: toNumber(row.zipf),
    finders: Number(row.finders) || 0,
    foundOn: String(row.found_on),
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
 * A weekly window's start. Floored below the epoch rather than at it: the game's
 * first puzzle fell on a Wednesday, so the Sunday that brackets it predates the
 * epoch and is a perfectly legitimate window start.
 */
function validWindowStart(date: string): boolean {
  return validDate(date, WINDOW_FLOOR);
}

/** One puzzle's score, validated. */
interface ScoreEntry {
  date: string;
  /** That day's rarest word, and the frequency it was judged on. */
  word: string;
  zipf: number;
  total: number;
  top: number;
  words: number;
}

/**
 * Check one puzzle's score, returning it or the reason it is not one.
 *
 * Strict rather than forgiving, and the reason is worth saying: there are no
 * accounts here, so a submission cannot be authenticated -- the only thing
 * standing between the board and a made-up score is whether the numbers are
 * ones a real game could have produced. A total above the day's ceiling, or a
 * single word worth more than the whole game it came from, means the client and
 * this endpoint disagree about scoring, and storing it would be worse than
 * refusing it.
 */
function readScore(raw: unknown): ScoreEntry | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "malformed-score";
  const { date, word, zipf, total, top, words } = raw as Record<string, unknown>;

  if (typeof date !== "string" || !validPuzzleDate(date)) return "bad-date";
  if (typeof word !== "string" || !WORD_RE.test(word)) return "bad-word";
  if (typeof zipf !== "number" || !Number.isFinite(zipf)) return "bad-zipf";
  if (zipf < MIN_ZIPF || zipf > MAX_ZIPF) return "bad-zipf";
  for (const [key, value] of Object.entries({ total, top, words })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return `bad-${key}`;
  }
  const totalScore = total as number;
  const topScore = top as number;
  const wordCount = words as number;
  if (totalScore > MAX_TOTAL) return "bad-total";
  if (topScore > MAX_TOP) return "bad-top";
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount > MAX_WORDS) return "bad-words";
  if (topScore > totalScore + 0.05) return "inconsistent-scores";
  if (totalScore > wordCount * MAX_TOP + 0.05) return "inconsistent-scores";

  return {
    date,
    word,
    zipf: Math.round(zipf * 100) / 100,
    total: Math.round(totalScore * 100) / 100,
    top: Math.round(topScore * 100) / 100,
    words: wordCount,
  };
}

/** A whole submission, or a string saying what was wrong with it. */
function readSubmission(parsed: unknown):
  | { playerId: string; scores: ScoreEntry[] }
  | string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "malformed-body";
  const { playerId, scores } = parsed as Record<string, unknown>;

  if (typeof playerId !== "string" || !UUID_RE.test(playerId)) return "bad-player-id";

  if (!Array.isArray(scores)) return "bad-scores";
  if (scores.length === 0) return "no-scores";
  if (scores.length > MAX_SCORES) return "too-many-scores";

  const checked: ScoreEntry[] = [];
  for (const entry of scores) {
    const score = readScore(entry);
    // One bad day fails the batch rather than being quietly dropped: a partial
    // write would leave the client believing it submitted a history it didn't.
    if (typeof score === "string") return score;
    checked.push(score);
  }
  return { playerId, scores: checked };
}

/**
 * The date the words feed must stay strictly before.
 *
 * The spoiler problem, stated plainly: this is a daily puzzle and everybody gets
 * the same drop, so a word somebody found today is an answer to today's puzzle.
 * Publishing it hands that answer to every player who has not played yet.
 *
 * A player's unplayed dates are their own local today and later, and local dates
 * around the world span two UTC dates at any moment -- so neither clock alone is
 * enough. The cutoff is the *earlier* of the client's claimed today and UTC's,
 * which closes both holes at once:
 *
 *   * a client further back than UTC (the Americas late in the UTC day) is
 *     believed, so their own today is never published to them;
 *   * a client claiming a date in the future is capped at UTC's today, so lying
 *     about the calendar cannot pull today's words out early.
 *
 * A missing or malformed `today` falls back to UTC's, which is never wider.
 */
function spoilerCutoff(claimed: string | null): string {
  const utc = utcToday();
  if (!claimed || !DATE_RE.test(claimed)) return utc;
  if (Number.isNaN(Date.parse(`${claimed}T00:00:00Z`))) return utc;
  return claimed < utc ? claimed : utc;
}

/** `days` before `date`, as YYYY-MM-DD. */
function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
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
  const wordsBefore = spoilerCutoff(params.get("today"));
  const wordsSince = daysBefore(wordsBefore, WORDS_WINDOW_DAYS);

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    // One call for the gate, both boards and the words feed: they answer one
    // question -- what should this page show right now -- and asking once means
    // the player count can never disagree with the rows beside it.
    const result = await rpc<BoardsResult>("leaderboard_boards", {
      p_since: since,
      p_limit: limit,
      p_min_players: MIN_PLAYERS,
      p_words_before: wordsBefore,
      p_words_since: wordsSince,
    });
    return reply(
      200,
      {
        weekStart: since,
        ready: Boolean(result?.ready),
        players: Number(result?.players) || 0,
        minPlayers: Number(result?.minPlayers) || MIN_PLAYERS,
        weekly: toEntries(result?.weekly ?? null),
        allTime: toEntries(result?.allTime ?? null),
        words: toWords(result?.words ?? null),
      },
      // A minute: long enough that a burst of opens costs one query, short
      // enough that a player who just scored sees themselves move.
      60
    );
  } catch (error) {
    // Logged for an operator, and reported to the client only as "unavailable".
    // The page shows a retry; it never shows a stack trace or an empty board.
    console.error("[leaderboard] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

/**
 * Same-origin only when the caller declares an origin, which every browser does
 * on a write. Cheap, and it takes the endpoint off the list of things any page on
 * the web can post to. See api/events.ts, which does the same. Returns a refusal
 * to send back, or null when the request may proceed.
 */
function crossOriginRefusal(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return reply(403, { ok: false, reason: "bad-origin" });
  }
  if (originHost !== new URL(request.url).host) {
    return reply(403, { ok: false, reason: "cross-origin" });
  }
  return null;
}

/**
 * Choose which of your own words the board calls you by.
 *
 * Awaited rather than fired and forgotten, unlike a score: the player is looking
 * at the answer, and a rename that silently didn't happen is worse than a slow
 * one. The word is authorised in SQL against that player's own submitted days,
 * so this endpoint being unauthenticated costs nothing -- the worst a forged
 * request can do is rename a player, whose id it must already know, to a word
 * that player found themselves.
 */
async function handlePut(request: Request): Promise<Response> {
  const refusal = crossOriginRefusal(request);
  if (refusal) return refusal;

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, reason: "too-large" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, reason: "malformed-json" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return reply(400, { ok: false, reason: "malformed-body" });
  }

  const { playerId, name } = parsed as Record<string, unknown>;
  if (typeof playerId !== "string" || !UUID_RE.test(playerId)) {
    return reply(400, { ok: false, reason: "bad-player-id" });
  }
  if (typeof name !== "string" || !WORD_RE.test(name)) {
    return reply(400, { ok: false, reason: "bad-word" });
  }

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const chosen = await rpc<boolean>("choose_leaderboard_name", {
      p_player_id: playerId,
      p_name: name,
    });
    // 409 rather than 400: the request is well formed, it just names a word this
    // player has not played -- which the page turns into "you haven't found that
    // one" rather than a validation error.
    if (!chosen) return reply(409, { ok: false, reason: "not-your-word" });
    return reply(200, { ok: true, name });
  } catch (error) {
    console.error("[leaderboard] name change failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handlePost(request: Request, context?: EdgeContext): Promise<Response> {
  const refusal = crossOriginRefusal(request);
  if (refusal) return refusal;

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
    "rpc/submit_leaderboard_scores",
    {
      p_player_id: submission.playerId,
      p_scores: submission.scores,
    },
    context
  );
  // 202 rather than 200: the write may be handed to `waitUntil` and finish after
  // this response, so the endpoint can honestly say it accepted the scores,
  // never that the rows landed. `days` echoes what was accepted, which is the
  // only thing it can honestly report.
  return reply(202, { ok: true, days: submission.scores.length });
}

export default async function handler(request: Request, context?: EdgeContext): Promise<Response> {
  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request, context);
  if (request.method === "PUT") return handlePut(request);
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST, PUT", "cache-control": "no-store" },
  });
}
