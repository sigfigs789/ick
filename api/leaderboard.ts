// The leaderboard: a Vercel Edge Function that reads the weekly and all-time
// boards, and takes the score submissions that fill them.
//
// GET /api/leaderboard?since=YYYY-MM-DD&today=YYYY-MM-DD&limit=15&player=UUID
//   -> { weekStart, ready, opensOn, weekly: [...], weeklySelf, allTime: [...],
//        allTimeSelf, words: [...] }
//   The weekly board counts puzzles from `since` onward; the second counts the
//   season, which is a fixed range this file holds (SEASON_START / SEASON_END)
//   rather than anything the caller can move. `since` does come from the client,
//   because the puzzle date it brackets is the player's own local calendar date
//   (see src/game/week.ts), so the week has to be measured on the same clock.
//   The response still calls the second board `allTime`: it is the long window
//   beside the short one, and renaming the key every season would help nobody.
//
//   Each board is a top fifteen. `player` is optional and is the player asking:
//   when they rank below the cut, their own row comes back as `weeklySelf` /
//   `allTimeSelf`, carrying the rank they actually hold rather than a position
//   inside the fifteen. When they are on the board -- or did not say who they
//   are -- those are null, because the row is already up there.
//
//   Boards stay unpublished until BOARDS_OPEN_FROM, whatever the data looks like
//   by then: `ready` says whether they are open, and until they are, both arrays
//   come back empty and `opensOn` is what there is to show. The gate is enforced
//   in SQL, so before the date no board row leaves the database at all -- there is
//   no early board sitting in a response waiting to be read out of a network tab.
//   `preview=1` opens that gate for one request, so the real boards can be looked
//   at before their opening date.
//
// GET /api/leaderboard?words=1&today=YYYY-MM-DD
//   -> { words: [...] }
//   Today's finds -- every word anybody has found on one puzzle -- as their own
//   request rather than a key on the boards. `today` is the puzzle the asking
//   player is looking at, and it is used as given: a find belongs to a drop, not
//   to a moment in UTC. Not behind the boards' opening gate: a list of good words
//   is interesting from day one, and it is the thing worth showing while the
//   boards wait. See `wordsDay` for what publishing a live puzzle's finds costs
//   and why it was accepted.
//
//   Split out because it is the one part of this page that is the same for
//   everybody. The boards carry `player` and so are cached per player; this
//   feed carries only a date, so one query every WORDS_CACHE_SECONDS serves
//   every open page. It is also the only part that needs to be live, so the
//   page polls this and leaves the boards alone after the first load.
//   A request carrying `t` is a reader who asked for this list by hand; it is
//   cached like any other, but under its own key, so the answer is fetched
//   afresh rather than handed a copy the reader has already seen.
//
// POST /api/leaderboard
//   { playerId, scores: [{ date, word, zipf, total, top, words, found? }] }
//   -> 202 { days }, 400 malformed, 503 no credentials
//   One score per player per puzzle. An array because it has two callers of the
//   same shape: the game submitting today after each accepted word, and a player
//   joining the board submitting every past puzzle their browser remembers. The
//   write keeps the higher of the stored and submitted score, so repeats and
//   out-of-order arrivals are both harmless (see the migration).
//
//   `found` is that day's whole word list, which is what the finds feed is built
//   from. Optional, and the backfill omits it for past days on purpose: a year of
//   words would not fit the body cap, and the feed only ever shows one puzzle.
//   Each word is written once and never updated, so its place in the feed is
//   fixed when it lands.
//
//   No name is sent, and none is stored: what the board calls a player is
//   derived from their id on the client (src/game/handle.ts). Each day carries
//   its own rarest word, which is what the weekly board's detail is drawn from.
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
// Reads are CDN-cached briefly: a leaderboard a minute out of date is
// indistinguishable from a live one, and it keeps a popular day from turning
// every open of the page into a database query. `player` is part of the cache
// key like any other parameter, so the boards are cached per player rather than
// across everybody -- the price of answering "where am I" in the same request as
// the board. That price is paid once per page open and not once a minute: the
// boards are fetched when the page loads and then left alone, and the thing that
// polls is the finds feed, which carries no player and is shared by everyone.

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
/**
 * The Sunday the boards go live, whatever the data looks like by then.
 *
 * Kept in step with src/game/leaderboard.ts's BOARDS_OPEN_FROM, which is what
 * the page decides from. Both are checked: the client's own calendar opens the
 * boards for whoever has reached the date, and this is the copy the response is
 * built from, so a stale client cannot keep them shut either.
 */
const BOARDS_OPEN_FROM = "2026-08-30";

/**
 * The season the second board counts, inclusive at both ends.
 *
 * Held here rather than in SQL, the same way the week's first day is: opening
 * Season 2 is these two lines and the pair in src/game/leaderboard.ts that names
 * it on screen, never a migration.
 *
 * Bounded at both ends because the board is named for the season. It used to be
 * "all time" and count everything, which a name with two dates on it cannot do:
 * a player backfilling a July history would land inside Season 1, and every
 * puzzle after New Year would keep landing there.
 *
 * These are fixed dates and not the player's own calendar, so they are not taken
 * from the request -- unlike the week, whose boundary is local to whoever is
 * asking. A season is the same season everywhere.
 */
const SEASON_START = "2026-08-01";
const SEASON_END = "2026-12-31";

/**
 * A batch is a browser's whole playing history, so it has to hold a couple of
 * years of daily puzzles. The body cap below is the real limit; this one stops a
 * caller naming the same handful of days ten thousand times.
 */
const MAX_SCORES = 800;
// Big enough for MAX_SCORES entries of roughly 50 bytes each, with room to spare.
const MAX_BODY_BYTES = 64 * 1024;
/**
 * How many rows a board shows. Fifty was a list you scrolled; fifteen is a list
 * you read, and the row below the cut is what keeps it from hiding anybody.
 */
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 200;
/**
 * How many finds the feed will return. A backstop, not a page: the rows are
 * distinct words on a single drop, so reaching 500 takes the day's players
 * between them turning up 500 different words -- well past the point this wants
 * to be a different design. It exists so a flood cannot make the response
 * enormous, and if it is ever reached the feed wants paging rather than a bigger
 * number.
 */
const WORDS_LIMIT = 500;
/**
 * How long the CDN may hand out one copy of the finds feed.
 *
 * Fifteen seconds rather than the sixty it started at. Sixty was chosen to
 * match the page's poll, which made the two numbers look like one decision --
 * but they answer different questions, and multiply rather than overlap: a word
 * waits out this cache *and then* the reader's next poll, so a minute here was
 * most of a two-minute wait to see a word somebody had already found.
 *
 * The cost of the shorter window is four origin reads a minute instead of one,
 * for every open page in the world put together -- the query is one grouped
 * scan of a single day's finds, and the whole point of the split above is that
 * this response is shared. That is a fair price for a feed that reads as live.
 */
const WORDS_CACHE_SECONDS = 15;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row as `leaderboard_board` returns it. */
interface BoardRow {
  rank: number;
  player_id: string;
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

/** What `leaderboard_boards` answers with: the gate and the rows. */
interface BoardsResult {
  ready: boolean;
  weekly: BoardRow[];
  allTime: BoardRow[];
}

/**
 * How long past expiry a stale copy may still be served while a fresh one is
 * fetched behind it.
 *
 * Kept in proportion to the freshness window above rather than left at the five
 * minutes it was: `stale-while-revalidate` is how old an answer the reader who
 * arrives first after expiry gets, so a five-minute tail on a fifteen-second
 * cache would have quietly undone the shorter cache for exactly the reader it
 * was shortened for. A minute is long enough to keep an origin blip off the
 * page and short enough that nobody reads a stale feed twice.
 */
const STALE_SECONDS = 60;

function reply(status: number, body?: unknown, cacheSeconds = 0): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheSeconds
        ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${STALE_SECONDS}`
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

function toEntry(row: BoardRow, index: number): BoardEntry {
  return {
    // The database ranked these; the fallback is only for a row that somehow
    // arrived without one, and keeps the column non-null for the client.
    rank: Number(row.rank) || index + 1,
    playerId: String(row.player_id),
    windowWord: String(row.window_word),
    windowZipf: toNumber(row.window_zipf),
    score: toNumber(row.total_score),
    puzzles: Number(row.puzzles) || 0,
  };
}

/**
 * Split one board into the rows everybody sees and the asking player's own row
 * from below the cut.
 *
 * The database returns both in one array, ranked, so the split is just "past the
 * limit" -- and it is done on the rank rather than on the array's length, so a
 * short board (fewer players than the limit) can never mistake its last row for
 * somebody hiding underneath it.
 */
function toBoard(rows: BoardRow[] | null, limit: number): { entries: BoardEntry[]; self: BoardEntry | null } {
  if (!Array.isArray(rows)) return { entries: [], self: null };
  const entries: BoardEntry[] = [];
  let self: BoardEntry | null = null;
  for (const [index, row] of rows.entries()) {
    const entry = toEntry(row, index);
    if (entry.rank > limit) self = entry;
    else entries.push(entry);
  }
  return { entries, self };
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

/** One word a player found, as the finds feed stores it. */
interface FoundEntry {
  word: string;
  zipf: number;
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
  /**
   * Every word accepted that day, for the finds feed.
   *
   * Optional, and absent is not a degraded submission: the history backfill
   * sends a browser's whole record at once and deliberately carries words only
   * for the day being played, since a year of past words would not fit the body
   * cap and the feed only ever shows one puzzle.
   */
  found?: FoundEntry[];
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
  const { date, word, zipf, total, top, words, found } = raw as Record<string, unknown>;

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

  const foundWords = readFound(found);
  if (typeof foundWords === "string") return foundWords;

  return {
    date,
    word,
    zipf: Math.round(zipf * 100) / 100,
    total: Math.round(totalScore * 100) / 100,
    top: Math.round(topScore * 100) / 100,
    words: wordCount,
    ...(foundWords.length > 0 ? { found: foundWords } : {}),
  };
}

/**
 * Check a day's word list, returning it or the reason it is not one.
 *
 * Absent is valid and means "no words with this day" -- see `ScoreEntry.found`.
 * Anything present is held to exactly the rules the day's rarest word is held
 * to, and for the stronger reason: these are shown to other players verbatim on
 * a page anyone can post to, so `WORD_RE` is what guarantees nothing here is
 * invisible, right-to-left, or an imitation of the page's own copy.
 *
 * Bounded by the most guesses a puzzle has ever allowed, so a caller cannot use
 * this array to write an unbounded number of rows from one accepted day.
 */
function readFound(raw: unknown): FoundEntry[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "bad-found";
  if (raw.length > MAX_WORDS) return "too-many-found";
  const found: FoundEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "bad-found";
    const { word, zipf } = item as Record<string, unknown>;
    if (typeof word !== "string" || !WORD_RE.test(word)) return "bad-found-word";
    if (typeof zipf !== "number" || !Number.isFinite(zipf)) return "bad-found-zipf";
    if (zipf < MIN_ZIPF || zipf > MAX_ZIPF) return "bad-found-zipf";
    found.push({ word, zipf: Math.round(zipf * 100) / 100 });
  }
  return found;
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
 * The puzzle the feed is about: the one the asking player is looking at.
 *
 * A find belongs to a *drop*, not to a moment in UTC. The page heads the list
 * with the day's drop, so the rows under it have to be that day's finds or the
 * heading is wrong -- `asphyxiate` means nothing until you know the day asked
 * for PHY.
 *
 * So the client's own puzzle date is used as given. It used to be run through
 * `max(clientDate, utcDate)`, which was reasoning about timezones rather than
 * about puzzles, and it got the answer wrong for everyone west of UTC: an
 * American evening is already tomorrow in UTC, so the feed would query a date
 * whose puzzle nobody in the Americas had reached, and "Today's finds" went
 * empty every night through the busiest hours of the day.
 *
 * `validPuzzleDate` is the whole of the bound, and it is the right one: a date a
 * puzzle actually exists for, no earlier than the first one and no later than
 * the furthest ahead any local calendar can be. A caller cannot ask for a day
 * the game has not reached, and does not need to be told which day they are on.
 *
 * Publishing the live puzzle's finds is a deliberate call. This is a daily game
 * where everybody gets the same drop, so a word found today is an answer to
 * today's puzzle, and anyone who opens this page mid-play is handed some. The
 * feed is much better live than a day behind, and that is the trade.
 */
function wordsDay(claimed: string | null): string {
  if (claimed && validPuzzleDate(claimed)) return claimed;
  // No date, or one no puzzle exists for. UTC's own day is the only guess
  // available and is right for most of the world's clock; a real client always
  // sends its own.
  return utcToday();
}

/** `days` before `date`, as YYYY-MM-DD. */
function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Today's finds, cached for everybody at once.
 *
 * Reads `leaderboard_words` directly rather than going through
 * `leaderboard_boards`. The two questions looked like one -- both are "what does
 * this page show" -- but they are not cached alike: the boards need to know who
 * is asking so they can hand back that player's own row, and the moment `player`
 * joins the cache key the response stops being shared. The feed is identical for
 * every player, so it is asked for on its own and the CDN answers it once per
 * WORDS_CACHE_SECONDS for all of them.
 *
 * Not behind the boards' opening gate, deliberately: the feed works from the
 * first day, and until the boards open it is the whole page.
 */
async function handleWordsGet(params: URLSearchParams): Promise<Response> {
  // One puzzle and nothing else: the feed is about the drop the player is
  // looking at, and a week of history behind it made it read as an archive.
  const since = wordsDay(params.get("today"));
  const before = daysBefore(since, -1);

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<WordRow[]>("leaderboard_words", {
      p_before: before,
      p_since: since,
      p_limit: WORDS_LIMIT,
    });
    return reply(200, { words: toWords(rows ?? null) }, WORDS_CACHE_SECONDS);
  } catch (error) {
    console.error("[leaderboard] words read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handleGet(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // The finds feed, on its own. Checked before anything else is read, because
  // this request carries none of the rest -- no week, no limit, no player -- and
  // that is the whole point of it: a URL identical for every player is a URL the
  // CDN can answer once.
  if (params.get("words") === "1") return handleWordsGet(params);
  const since = params.get("since") ?? "";
  if (!validWindowStart(since)) {
    return reply(400, { ok: false, reason: "bad-since" });
  }
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  // Who is asking, so the boards can hand back their own row from below the cut.
  // A malformed id is dropped rather than refused: not knowing where somebody
  // stands is a reason to show them the board anyway, not a reason to show them
  // an error.
  const claimedPlayer = params.get("player") ?? "";
  const player = UUID_RE.test(claimedPlayer) ? claimedPlayer.toLowerCase() : null;
  // Open for whoever has actually reached the date. Local calendars run ahead of
  // and behind UTC by up to a day, so the later of the two is the one that says
  // "it is Sunday somewhere the player is" -- a player is never made to wait past
  // their own Sunday, and a client with a slow clock is not held back either.
  const claimed = params.get("today") ?? "";
  const playerToday = DATE_RE.test(claimed) ? claimed : utcToday();
  // `preview=1` opens the gate early, for looking at the real boards before the
  // day they go live -- a launch you cannot see until the morning it happens is
  // one you cannot check. Safe to honour on request: the boards are built from
  // scores players already published, so the most it can do is show a real
  // leaderboard a few days early, and it changes nothing about what is counted
  // or written. It is part of the URL, so a preview is cached apart from an
  // ordinary open rather than poisoning it for everybody else.
  const preview = params.get("preview") === "1";
  const open =
    preview || (playerToday > utcToday() ? playerToday : utcToday()) >= BOARDS_OPEN_FROM;

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    // One call for the gate, both boards and the words feed: they answer one
    // question -- what should this page show right now -- and asking once means
    // the player count can never disagree with the rows beside it.
    const result = await rpc<BoardsResult>("leaderboard_boards", {
      p_since: since,
      p_limit: limit,
      p_open: open,
      p_player: player,
      p_season_since: SEASON_START,
      p_season_until: SEASON_END,
    });
    const weekly = toBoard(result?.weekly ?? null, limit);
    const allTime = toBoard(result?.allTime ?? null, limit);
    return reply(
      200,
      {
        weekStart: since,
        ready: Boolean(result?.ready),
        opensOn: BOARDS_OPEN_FROM,
        weekly: weekly.entries,
        // Null whenever the asking player is on the board already, or did not
        // say who they are. The page shows this row under the board, so "null"
        // and "on the board" have to be the same thing to it.
        weeklySelf: weekly.self,
        allTime: allTime.entries,
        allTimeSelf: allTime.self,
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
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST", "cache-control": "no-store" },
  });
}
