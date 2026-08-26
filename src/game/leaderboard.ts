/**
 * The client half of the leaderboard: submit scores, fetch the boards.
 *
 * Both directions are strictly optional to the game. Submitting is
 * fire-and-forget -- it happens after a word has already been accepted, saved
 * and rendered, or on opening the app for a player already on the board, and a
 * failure is never surfaced either way. Fetching is only ever done by
 * the leaderboard page, so a player who never visits it never makes the request,
 * and that page's own error state is the whole of the failure handling. Nothing
 * here can keep anyone from playing a puzzle.
 */

import { maxGuessesFor } from "./constants";
import {
  rarityFor,
  rarityForZipf,
  rarityScore,
  topRarityScore,
  totalRarityScore,
} from "./dictionary";
import { formatDateLabel, todayDateString } from "./date";
import { handleFor } from "./handle";
import { loadPlayerId } from "./player";
import { playedOnItsDay } from "./storage";
import { sampleBoardsResponse, usingSampleData } from "../dev/sampleData";
import type { AcceptedWord, DailyProgress, Rarity } from "./types";
import { weekStart } from "./week";

export interface BoardEntry {
  /** Rank on this board, as the database ranked it. */
  rank: number;
  playerId: string;
  /**
   * What the board calls this player, like `StormyFox47`.
   *
   * Derived from the id here rather than sent by the server: the same player
   * gets the same handle on every device, nothing is stored, and it is
   * unmistakably a name -- which naming people after their rarest find was not,
   * on a page that also lists found words.
   */
  name: string;
  /**
   * The rarest word inside this board's window -- on the weekly board, what they
   * found *this* week; on the all-time board, their best ever.
   */
  windowWord: string;
  windowScore: number;
  /** Summed rarity score over the board's window. */
  score: number;
  /** How many puzzles the player scored on inside the window. */
  puzzles: number;
}

/**
 * A word somebody found, as the feed shows it.
 *
 * Priced and labelled by today's dictionary, like everything else on the page --
 * so a word that has been rescored since somebody found it reads at what it is
 * worth now, and two players seeing the same word see the same badge.
 */
export interface FoundWord {
  word: string;
  rarity: Rarity;
  /** Frequency, kept so the badge can render the score the same way the game does. */
  zipf: number;
  /** How many players found it on this puzzle. */
  finders: number;
  /** The puzzle it was found on -- the drop the feed is headed with. */
  foundOn: string;
  /** Found on the puzzle the player is looking at, rather than an older one. */
  today: boolean;
}

export interface Boards {
  /**
   * Whether the boards are published yet. Before the opening date the server
   * sends no rows at all and this is false, so a page that shows rows only when
   * `ready` can never render a board ahead of time.
   */
  ready: boolean;
  /** The date the boards open, echoed back so the page can name it. */
  opensOn: string;
  weekly: BoardEntry[];
  /**
   * This player's own row on the weekly board, when they rank below the last one
   * shown -- carrying the rank they actually hold. Null when they are already on
   * the board, or when nobody has joined on this browser.
   */
  weeklySelf: BoardEntry | null;
  allTime: BoardEntry[];
  /** The same, on the all-time board. */
  allTimeSelf: BoardEntry | null;
  /** The day the weekly board is counting from, echoed back by the server. */
  weekStart: string;
}

/**
 * The Sunday the boards go live, whatever the data looks like by then.
 *
 * A date rather than a player count. The count was the cautious version of the
 * same instinct -- don't show a three-name board -- but it makes the launch
 * unpredictable, and a leaderboard nobody can put a date on is one nobody plans
 * around. A Sunday because that is when a week starts here (see week.ts), so the
 * first published week is a whole one rather than a stub.
 *
 * Changing this is a one-line change: the client decides from its own calendar,
 * the endpoint checks the same date against both clocks, and no SQL knows it.
 */
export const BOARDS_OPEN_FROM = "2026-08-30";

/**
 * The season the second board counts, and what to call it.
 *
 * Kept in step with api/leaderboard.ts, which holds the same two dates and is
 * what actually bounds the query -- this pair only names it. Same arrangement as
 * BOARDS_OPEN_FROM above: the server decides, the page says.
 *
 * The board was "All time" and counted every puzzle ever. A season is the more
 * honest thing to rank: it ends, which means a player who arrives in November
 * has something they can still win, and the standings that stand at the end are
 * final rather than merely current.
 */
export const SEASON = {
  number: 1,
  start: "2026-08-01",
  end: "2026-12-31",
} as const;

/** `Season 1`, and the range under it. */
export function seasonName(): string {
  return `Season ${SEASON.number}`;
}

/**
 * `Aug 1 – Dec 31 2026`, to sit beside the heading.
 *
 * Months abbreviated because the range shares a line with the name now: spelled
 * out, "Season 1 August 10 – December 31 2026" wraps on any phone and reads as a
 * sentence rather than as a label on the board.
 */
export function seasonRange(): string {
  // The same short form the weekly board's range and the opening date use, so
  // every date on this page is written the same way.
  return `${formatDateLabel(SEASON.start)} – ${formatDateLabel(SEASON.end)} ${SEASON.end.slice(0, 4)}`;
}

/** Whether the boards are published yet, on this player's own calendar. */
export function boardsOpen(date: string = todayDateString()): boolean {
  return date >= BOARDS_OPEN_FROM;
}

/**
 * The URL switch that opens the boards early: `/leaderboard?preview=1`.
 *
 * For looking at the real thing before its opening date -- a launch you cannot
 * see until the morning it happens is one you cannot check. It shows the live
 * data, not a fixture (that is dev-only sample data), so what it proves is that
 * the page will work on the day.
 *
 * Deliberately not a secret and deliberately harmless: the boards are built
 * from what players have already chosen to publish, so the only thing this
 * param can leak is a leaderboard a few days ahead of schedule. It changes
 * nothing about how scores are counted.
 */
const PREVIEW_PARAM = "preview";

/**
 * Remembered for the tab, because the address bar does not survive the trip.
 *
 * `navigate` pushes a bare path (see routes.ts), so a player who lands on the
 * game with the param and then taps through to the leaderboard would arrive
 * without it. Session storage rather than local: a preview is something you are
 * doing right now, and it should end when the tab does rather than quietly
 * outlive the launch on somebody's phone.
 */
const PREVIEW_KEY = "ick:leaderboard-preview";

/**
 * Whether this browser is previewing the boards ahead of their opening date.
 *
 * Sticky once seen: the param is read from wherever the player entered, and
 * then held for the rest of the session.
 */
export function previewRequested(search: string = window.location.search): boolean {
  let asked = false;
  try {
    asked = new URLSearchParams(search).get(PREVIEW_PARAM) === "1";
  } catch {
    // A search string URLSearchParams won't take is simply not a request.
  }
  try {
    if (asked) sessionStorage.setItem(PREVIEW_KEY, "1");
    return asked || sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    // Storage unavailable: the param still works, it just won't survive a
    // navigation inside the app.
    return asked;
  }
}

/**
 * How many rows each board shows.
 *
 * Fifteen rather than the fifty it started at: fifty is a list you scroll,
 * fifteen is a list you read, and a top fifteen is something a player can
 * picture being in. What makes the shorter board safe is that it no longer hides
 * anybody -- a player below the cut gets their own row underneath it, at their
 * real rank (see `weeklySelf`), so the board got shorter without answering fewer
 * questions.
 */
export const BOARD_LIMIT = 15;
// A board is worth waiting a moment for, but not worth a spinner that never
// ends -- past this the page says it couldn't load and offers a retry.
const FETCH_TIMEOUT_MS = 6000;

interface RawEntry {
  rank?: unknown;
  playerId?: unknown;
  windowWord?: unknown;
  windowZipf?: unknown;
  score?: unknown;
  puzzles?: unknown;
}

/**
 * Read one board out of the response, dropping anything malformed rather than
 * throwing. The rank comes from the server -- it did the sorting, so it is the
 * thing that gets to say what position a player is in. The fallback to array
 * position is for a row that arrives without one, and keeps the ranks a reader
 * sees contiguous.
 */
function parseBoard(raw: unknown): BoardEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: BoardEntry[] = [];
  for (const item of raw as RawEntry[]) {
    const entry = parseEntry(item, entries.length + 1);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Read one row, or null if it isn't one.
 *
 * `fallbackRank` is reached only by a row that arrived without a rank of its
 * own. A row from below the cut is the one place an invented rank would be a
 * lie -- its rank is the whole reason it was sent -- so `parseSelf` passes none
 * and such a row is dropped instead.
 */
function parseEntry(item: RawEntry | null, fallbackRank?: number): BoardEntry | null {
  if (!item || typeof item !== "object") return null;
  const { rank, playerId, windowWord, windowZipf, score, puzzles } = item;
  if (typeof playerId !== "string" || typeof windowWord !== "string") return null;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const ranked = typeof rank === "number" && Number.isFinite(rank) ? rank : fallbackRank;
  if (ranked === undefined) return null;
  // The find is priced here, at today's rates, from the word itself -- so two
  // players holding the same word always show the same number, however long
  // ago either of them found it.
  return {
    rank: ranked,
    playerId,
    name: handleFor(playerId),
    windowWord,
    windowScore: scoreOf(windowWord, windowZipf),
    score,
    puzzles: typeof puzzles === "number" && Number.isFinite(puzzles) ? puzzles : 0,
  };
}

/** Read the player's own row from below the cut, or null if there isn't one. */
function parseSelf(raw: unknown): BoardEntry | null {
  return parseEntry((raw ?? null) as RawEntry | null);
}

/**
 * Price one word at today's rates: today's dictionary first, and the frequency
 * the server stored only for a word today's dictionary doesn't carry -- a live
 * Merriam-Webster approval, most often.
 */
function scoreOf(word: string, storedZipf: unknown): number {
  const zipf = rarityFor(word)?.zipf;
  if (zipf !== undefined) return rarityScore(zipf);
  if (typeof storedZipf === "number" && Number.isFinite(storedZipf)) return rarityScore(storedZipf);
  return 0;
}

/**
 * Read the words feed, dropping anything malformed rather than throwing.
 *
 * Each word is looked up fresh in today's dictionary and only falls back to the
 * frequency the server stored for a word today's dictionary doesn't carry.
 */
function parseWords(raw: unknown, today: string): FoundWord[] {
  if (!Array.isArray(raw)) return [];
  const words: FoundWord[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const { word, zipf, finders, foundOn } = item;
    if (typeof word !== "string" || !word) continue;
    const stored = typeof zipf === "number" && Number.isFinite(zipf) ? zipf : undefined;
    const current = rarityFor(word)?.zipf ?? stored;
    if (current === undefined) continue;
    const rarity = rarityForZipf(current);
    // No rarity bar. The feed is what the day's players found, and a Common word
    // is part of what happened -- cutting it would quietly turn a record of the
    // puzzle into a highlight reel, which the boards above already are.
    words.push({
      word,
      zipf: current,
      rarity,
      finders: typeof finders === "number" && Number.isFinite(finders) ? finders : 1,
      foundOn: typeof foundOn === "string" ? foundOn : "",
      today: foundOn === today,
    });
  }
  return words;
}

/**
 * Whether this fetch is a reader asking by hand, rather than the page asking on
 * their behalf.
 *
 * A poll should be answered from the shared copy -- that is what the copy is
 * for. A person who taps refresh is saying they have seen it and want the next
 * one, and handing them the same bytes back is the one answer that is certainly
 * wrong. So an asked-for fetch carries a cache-buster.
 */
export interface FetchOptions {
  fresh?: boolean;
}

/**
 * The cache-buster: a five-second bucket, not a timestamp.
 *
 * The URL is the cache key, so a unique one per tap means an origin read per
 * tap -- and a refresh button is a thing people press twice. Rounding to five
 * seconds means a flurry of taps shares one key and one query, while any two
 * taps a reader could tell apart get different ones. It also expires by itself,
 * so nothing accumulates in the cache beyond a few seconds' worth of keys.
 */
function freshParam(options: FetchOptions): string {
  if (!options.fresh) return "";
  return `&t=${Math.floor(Date.now() / 5000)}`;
}

/**
 * Fetch both boards in one request.
 *
 * The week's start is sent rather than derived server-side: the puzzle date is
 * already the player's own local calendar date, so the window that brackets it
 * has to come from the same clock (see game/week.ts). Rejects on failure; the
 * caller turns that into the page's error state.
 */
export async function fetchBoards(
  date: string = todayDateString(),
  options: FetchOptions = {}
): Promise<Boards> {
  const since = weekStart(date);
  // Who is asking, so the server can send their own row back from below the cut.
  // Nobody has to have joined for the page to work: without an id the boards
  // come back exactly as before, minus a row that would be about nobody.
  const playerId = loadPlayerId();
  // Development only, and compiled out of a production build entirely: the
  // fixture stands in for the server so the page can be worked on without one.
  // Parsed by exactly the same code as a real response, so a change to that
  // parsing cannot pass here and fail in production.
  if (import.meta.env.DEV && usingSampleData()) {
    return readBoards(sampleBoardsResponse() as Record<string, unknown>, since);
  }
  // The player's own date goes up so the server can tell whether the boards have
  // opened on the calendar this player is actually on -- local dates run a day
  // either side of UTC, and nobody should be made to wait past their own Sunday.
  // The gate is the server's to open, so previewing is a thing this request
  // asks for rather than something the page does with the answer. It is part of
  // the URL, so a preview and an ordinary open are cached apart from each other.
  const preview = previewRequested();
  const response = await fetch(
    `/api/leaderboard?since=${encodeURIComponent(since)}&today=${encodeURIComponent(date)}` +
      `&limit=${BOARD_LIMIT}` +
      (playerId ? `&player=${encodeURIComponent(playerId)}` : "") +
      (preview ? `&${PREVIEW_PARAM}=1` : "") +
      freshParam(options),
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`leaderboard ${response.status}`);
  return readBoards((await response.json()) as Record<string, unknown>, since);
}

/**
 * Read today's finds.
 *
 * Its own request, and not because the page wants two: the boards have to say
 * who is asking so they can return that player's own row, which makes their
 * response private to them, while this list is the same for every player alive.
 * Asking separately is what lets one of them be cached for everybody -- and it
 * is the one that has to be live, so it is the one that gets polled.
 *
 * Rejects on failure like `fetchBoards`; the caller decides whether a failed
 * refresh is worth telling anyone about.
 */
export async function fetchFoundWords(
  date: string = todayDateString(),
  options: FetchOptions = {}
): Promise<FoundWord[]> {
  if (import.meta.env.DEV && usingSampleData()) {
    return parseWords((sampleBoardsResponse() as Record<string, unknown>).words, date);
  }
  // The date is the only thing this request carries, so two players on the same
  // day send byte-identical URLs and share one cached answer. The server bounds
  // it against its own clock either way (see api/leaderboard.ts).
  const response = await fetch(
    `/api/leaderboard?words=1&today=${encodeURIComponent(date)}${freshParam(options)}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`leaderboard words ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseWords(body.words, date);
}

/** Turn one response body -- real or sample -- into the boards the page renders. */
function readBoards(body: Record<string, unknown>, since: string): Boards {
  return {
    // Rows are shown only when the server says the boards are published, so a
    // missing or malformed flag holds them back rather than letting them out.
    ready: body.ready === true,
    opensOn: typeof body.opensOn === "string" ? body.opensOn : BOARDS_OPEN_FROM,
    weekly: parseBoard(body.weekly),
    weeklySelf: parseSelf(body.weeklySelf),
    allTime: parseBoard(body.allTime),
    allTimeSelf: parseSelf(body.allTimeSelf),
    weekStart: typeof body.weekStart === "string" ? body.weekStart : since,
  };
}

/**
 * What a word is worth *today*, whatever it was worth the day it was played.
 *
 * Two things can have moved since: the scoring curve, which has been retuned
 * more than once, and the word's own frequency data, which the dictionary keeps
 * being corrected. So the word is looked up fresh (`rarityFor` with no date =
 * the current system) and only falls back to the stored Zipf for a word today's
 * dictionary doesn't carry -- a live Merriam-Webster approval, most often.
 *
 * Deliberately different from how a *score* is computed: a puzzle's score is
 * frozen at the system in effect that day, because a past game should keep the
 * result it was played for. A name is not a result, it is a current claim about
 * the player -- "the best word I have ever found" -- so it is judged on today's
 * terms, and every player's is judged on the same terms.
 */
function scoreToday(word: AcceptedWord): number {
  return rarityScore(rarityFor(word.word)?.zipf ?? word.zipf);
}

/** One word of a day's list, in the shape the endpoint takes. */
interface FoundPayload {
  word: string;
  zipf: number;
}

/** One puzzle's score, in the shape the endpoint takes. */
interface ScorePayload {
  date: string;
  /** That day's rarest word, and the frequency it is judged on. */
  word: string;
  zipf: number;
  total: number;
  top: number;
  words: number;
  /**
   * Every word accepted that day, which is what the finds feed is built from.
   *
   * Sent only for the puzzle being played, never for a backfilled day: the feed
   * shows one drop at a time, so past words would be rows nobody can ever see,
   * and a browser with a year of history would not fit the request body.
   */
  found?: FoundPayload[];
}

/**
 * One day's submission: the two numbers the game already shows the player, plus
 * the rarest word of that day.
 *
 * The word is sent per day rather than a name per player, because the board
 * derives both the words it shows from these rows -- a player's name is the
 * rarest across all of them, and the weekly detail is the rarest inside the
 * window. Nothing here asserts what the player should be called.
 */
function scoreFor(
  date: string,
  words: readonly AcceptedWord[],
  options: { withFound?: boolean } = {}
): ScorePayload {
  const best = rarest(words);
  return {
    date,
    word: best.word.toLowerCase(),
    // Today's measurement where there is one, so the board ranks words on the
    // same footing whenever they were played.
    zipf: Math.round((rarityFor(best.word)?.zipf ?? best.zipf) * 100) / 100,
    total: totalRarityScore(words, date),
    top: topRarityScore(words, date),
    // Capped rather than trusted: the endpoint bounds this too, and sending more
    // than the day's guess limit allows would only get the batch rejected.
    words: Math.min(words.length, maxGuessesFor(date)),
    ...(options.withFound ? { found: foundFor(date, words) } : {}),
  };
}

/**
 * A day's word list for the feed, priced the same way the day's rarest word is.
 *
 * Trimmed to the day's guess limit for the same reason `words` is capped: the
 * endpoint refuses a longer list, and a batch it refuses costs the player the
 * whole day rather than one word.
 */
function foundFor(date: string, words: readonly AcceptedWord[]): FoundPayload[] {
  return words.slice(0, maxGuessesFor(date)).map((word) => ({
    word: word.word.toLowerCase(),
    zipf: Math.round((rarityFor(word.word)?.zipf ?? word.zipf) * 100) / 100,
  }));
}

/** The rarest of one day's words, by today's reckoning. */
function rarest(words: readonly AcceptedWord[]): AcceptedWord {
  return words.reduce((best, word) => (scoreToday(word) > scoreToday(best) ? word : best));
}

/**
 * Post a batch of scores. Never awaited by a caller on the play path.
 *
 * The name goes up with every batch, recomputed each time, and the write keeps
 * the newest -- so finding a better word renames the player across their whole
 * history on their next submission, with nothing to migrate.
 *
 * `keepalive` so a submission survives the tab being closed right after a word
 * lands, and every failure is swallowed: a score that didn't make it is not
 * something to interrupt a game over. Returns whether a request was actually
 * started, which is what the tests assert on.
 */
function post(playerId: string, scores: ScorePayload[]): boolean {
  if (scores.length === 0) return false;
  const body = JSON.stringify({ playerId, scores });
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

/**
 * Send this puzzle's score up, if there is anything to send.
 *
 * Refuses in three cases, each on purpose:
 *   - nobody has joined the board on this browser, so there is no name to post;
 *   - the puzzle isn't today's, because archive play is off the board for the
 *     same reason it is off the streak (you can look up the answers);
 *   - no words have been accepted, so there is no score.
 */
export function submitScore(options: {
  date: string;
  isToday: boolean;
  words: readonly AcceptedWord[];
  playerId?: string | null;
}): boolean {
  const { date, isToday, words } = options;
  const playerId = options.playerId ?? loadPlayerId();
  if (!playerId || !isToday || words.length === 0) return false;
  // The whole running word list goes with it, which is what the finds feed is
  // built from. Re-sent in full after every accepted word: each word is written
  // once and the repeats are discarded, so this is idempotent rather than
  // wasteful, and a player who joined halfway through the day still gets their
  // earlier finds onto the feed with their next word.
  // The name is the player's best word *ever*, not this puzzle's best, so it
  // comes from the whole stored history -- which already includes the words
  // being submitted, since they were saved before this was called. The fallback
  // covers a record too old to carry the timestamp that makes a day eligible.
  return post(playerId, [scoreFor(date, words, { withFound: true })]);
}

/**
 * Import a joining player's history from what this browser already remembers.
 *
 * Somebody who joins the board today has often been playing for weeks, and
 * starting them at zero throws away a record that is sitting in localStorage
 * already. Only days completed on their own calendar date are eligible -- that
 * is the part the stored record can prove, and it keeps archive play off the
 * board the same way the live path does (see storage.playedOnItsDay).
 *
 * One request for the whole history: the write is monotonic per day, so
 * re-sending it is a no-op and the later per-word submissions layer over it
 * without conflict. Returns how many days were sent, for the page to report.
 */
export function backfillHistory(
  playerId: string,
  history?: readonly DailyProgress[],
  today: string = todayDateString()
): number {
  const played = history ?? playedOnItsDay();
  const scores = played
    .filter((progress) => progress.acceptedWords.length > 0)
    // Words with today's puzzle and no other. Somebody who joins after playing
    // gets the finds they already made onto the feed rather than waiting for
    // their next word -- while a browser with a year of history sends a year of
    // scores and not a year of words, which is what keeps the batch inside the
    // request body cap and off a feed that shows one drop at a time.
    .map((progress) =>
      scoreFor(progress.date, progress.acceptedWords, { withFound: progress.date === today })
    );
  // Named from exactly the days being submitted, so the name and the scores in
  // one request always describe the same history.
  return post(playerId, scores) ? scores.length : 0;
}

/**
 * Re-send what this browser knows, for a player who is already on the board.
 *
 * Opening the app is the trigger, not opening the leaderboard. A player's rows
 * are written on the play path (`submitScore`, after every accepted word) and
 * that path is the only one that ever ran again after joining -- so a day played
 * with the network down, a submission that failed in flight, or a tab closed
 * before `keepalive` got the last word out left a gap that nothing on the game
 * page would ever close. The board would go on being wrong about somebody who
 * kept playing every day.
 *
 * The write is monotonic per day, so this is a repair rather than a rewrite:
 * a day already recorded is a no-op, and only the missing ones land. Which is
 * what makes it safe to do unconditionally on open.
 *
 * Deliberately does not join. Minting an id is the one thing that puts a player
 * on the board at all, and that stays where the player asked for it -- on the
 * leaderboard page. Somebody who has never opened it still sends nothing.
 *
 * Fire-and-forget like every other write here (see `post`); returns how many
 * days were sent, for the tests.
 */
export function syncHistory(today: string = todayDateString()): number {
  const playerId = loadPlayerId();
  if (!playerId) return 0;
  return backfillHistory(playerId, undefined, today);
}
