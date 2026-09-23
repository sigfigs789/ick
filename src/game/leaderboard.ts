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
  rawTotalRarityScore,
  topRarityScore,
} from "./dictionary";
import { todayDateString } from "./date";
import { FIRST_PUZZLE } from "./drop";
import { handleFor } from "./handle";
import { loadPlayerId } from "./player";
import { isRanked, modeForDate, type GameMode } from "./mode";
import { playedOnItsDay } from "./storage";
import type { AcceptedWord, DailyProgress, Rarity } from "./types";
import { monthStart } from "./month";
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
   * found *this* week; on the monthly board, their best this month.
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
   * One puzzle's standing: everybody who scored on the day the page is showing.
   *
   * The shortest window the game has, and the one a player can actually enter
   * from nothing -- a week's board is most of a week's play by the time anybody
   * looks at it, while today's is one puzzle everyone starts level on. It is the
   * same query the weekly board runs, bounded to a single date at both ends (see
   * api/leaderboard.ts), so a row means exactly what it means on the other two.
   */
  daily: BoardEntry[];
  /** The same row-below-the-cut the other boards get, on the daily one. */
  dailySelf: BoardEntry | null;
  weekly: BoardEntry[];
  /**
   * This player's own row on the weekly board, when they rank below the last one
   * shown -- carrying the rank they actually hold. Null when they are already on
   * the board, or when nobody has joined on this browser.
   */
  weeklySelf: BoardEntry | null;
  /**
   * The monthly board.
   *
   * Read from a response key still called `allTime`, which is what the SQL
   * function builds and what this board was before it was a season and then a
   * month. Renaming it means a migration to rename a key nobody outside these
   * two files reads, so the wire keeps the old word and everything above the
   * parse calls the board what it is.
   */
  monthly: BoardEntry[];
  /** The same, on the monthly board. */
  monthlySelf: BoardEntry | null;
  /** The day the weekly board is counting from, echoed back by the server. */
  weekStart: string;
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
/**
 * The first puzzle any find was ever recorded against.
 *
 * The finds table is younger than the game (see the 2026-08-28 migration): every
 * word before this day was played, scored and forgotten, because there was
 * nowhere to write it down. Days before it come back empty and always will.
 *
 * Which makes it a floor rather than a thing to render. "Nobody found anything
 * on this puzzle" is a sentence about the players; on one of those days it would
 * be a sentence about the schema, and it would be the same lie every time -- the
 * puzzle had finders, we simply were not keeping them. Better not to offer the
 * step at all than to answer it wrongly.
 *
 * A constant rather than a query: it is a fact about this deployment's history,
 * fixed forever, and asking the server which days it has rows for would be a
 * request per page open to learn something that has not changed since August.
 */
const FINDS_EPOCH = "2026-08-26";

/**
 * The earliest puzzle whose finds the feed will step back to: the first day any
 * were recorded.
 *
 * It used to stop at the week's reset, on the reasoning that the feed was the
 * companion to the weekly board above it. Once the finds became their own page
 * that stopped being true -- the page is the game's record of what has been
 * found, and a record that forgets on Sunday night is a strange thing to keep.
 * Stepping back is one press at a time and every day is one request, so the
 * whole archive costs a reader exactly what they walk through.
 *
 * `FINDS_EPOCH` rather than `FIRST_PUZZLE`: the days before it were played and
 * forgotten, and offering a step to one would say nobody found anything on a
 * puzzle that had finders.
 */
export function feedFloor(): string {
  return FINDS_EPOCH;
}
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
  /**
   * Where this row was played, on a board that holds more than one game's
   * players. Sent only by the Reddit build, whose board merges its own players
   * with the ones imported from this site; this site's own endpoint sends no
   * such key, and a row without one is named exactly as it always was.
   */
  source?: unknown;
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
  // The find is priced from the frequency it was stored with, which is the one
  // the puzzle it was found on gave it -- so the number here is the number its
  // finder was shown.
  return {
    rank: ranked,
    playerId,
    name: nameFor(playerId, item.source),
    windowWord,
    windowScore: scoreOf(windowWord, windowZipf),
    score,
    puzzles: typeof puzzles === "number" && Number.isFinite(puzzles) ? puzzles : 0,
  };
}

/**
 * What to call a player, which depends on which game they played.
 *
 * On this site there is one kind of player and the name is what it has always
 * been: a handle derived from their id (see game/handle.ts). The Reddit build
 * shows one board holding both its own players and the ones imported from here,
 * and a board mixing two populations has to say which is which -- so it marks
 * each row's origin and the two read as the prefixes their homes already use.
 * A Reddit row's id *is* the username, so it needs no derivation.
 */
function nameFor(playerId: string, source: unknown): string {
  if (source === "r") return `u/${playerId}`;
  if (source === "w") return `w/${handleFor(playerId)}`;
  return handleFor(playerId);
}

/** Read the player's own row from below the cut, or null if there isn't one. */
function parseSelf(raw: unknown): BoardEntry | null {
  return parseEntry((raw ?? null) as RawEntry | null);
}

/**
 * Price one player's best find, from the frequency stored with it.
 *
 * The stored number first, and a fresh lookup only for a row that arrived
 * without one. That is the other way round from how this read for most of the
 * board's life, and the reason is that the stored number is no longer a stale
 * copy of something this client could work out for itself -- it is the price the
 * word carried on the puzzle it was found on (see `scoreFor`), and this row does
 * not say which puzzle that was. Looking it up again here can only answer a
 * different question.
 *
 * What that buys is the board agreeing with the game. A word found during
 * freeform week scored on its own frequency, and a fresh undated lookup folds it
 * back onto its common form -- so a player's headline find showed one number in
 * the game and a smaller one on the board beside it.
 *
 * What it costs is that a later correction to a word's frequency no longer
 * reaches this column, and that two players holding the same word can show
 * different numbers if they found it under different systems. Both follow from
 * pricing by the puzzle, and the score this sits next to has always worked this
 * way: `total_score` is computed once, on the day, and never re-derived.
 */
function scoreOf(word: string, storedZipf: unknown): number {
  if (typeof storedZipf === "number" && Number.isFinite(storedZipf)) return rarityScore(storedZipf);
  const zipf = rarityFor(word)?.zipf;
  return zipf === undefined ? 0 : rarityScore(zipf);
}

/**
 * Read the words feed, dropping anything malformed rather than throwing.
 *
 * Each word is priced by the puzzle it was found on, and only falls back to the
 * frequency the server stored for a word that puzzle's dictionary doesn't carry.
 *
 * By the puzzle's date rather than today's, which is the difference between a
 * record and a re-reckoning. This feed is an account of what happened on one
 * drop -- these words, these players, that day -- and the player who banked one
 * watched the game put a number on it. Pricing it again on today's terms is how
 * a word the game called Mythic an hour ago turns up here as Very Common.
 *
 * That was invisible while every scoring change moved forward, because today's
 * system was then the newest anything had ever been priced at. Freeform week is
 * the first that does not: the puzzle in front of the player runs a system the
 * undated call does not return, so the feed disagreed with the game about the
 * same word on the same afternoon.
 *
 * Deliberately unlike the board above it, where a find is still priced at
 * today's rates for everyone (see `scoreOf`). A board is a comparison between
 * players and has to put two people holding the same word on the same number; a
 * feed is a record of a puzzle and has to agree with the puzzle.
 */
function parseWords(raw: unknown, today: string): FoundWord[] {
  if (!Array.isArray(raw)) return [];
  const words: FoundWord[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const { word, zipf, finders, foundOn } = item;
    if (typeof word !== "string" || !word) continue;
    // An absent or malformed date has to read as "no date", not as the empty
    // string: every cutover here is a string comparison, and "" sorts below all
    // of them -- so passing it through would price the word on the legacy scale
    // the game used in July.
    const playedOn = typeof foundOn === "string" && foundOn ? foundOn : undefined;
    const stored = typeof zipf === "number" && Number.isFinite(zipf) ? zipf : undefined;
    const current = rarityFor(word, playedOn)?.zipf ?? stored;
    if (current === undefined) continue;
    const rarity = rarityForZipf(current, playedOn);
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
 * Which windows the boards should count, when the reader has stepped off the
 * present.
 *
 * Both default to the windows bracketing the date being played, which is what
 * the page opens on and what every caller but the board navigation wants. A
 * window given here is used as sent: the server bounds each board at both ends
 * from it (see api/leaderboard.ts), so a past week is a closed seven days rather
 * than "everything since".
 */
export interface BoardOptions extends FetchOptions {
  /** The single puzzle the daily board counts. */
  day?: string;
  /** The Sunday the weekly board counts from. */
  week?: string;
  /** The first of the month the monthly board counts. */
  month?: string;
}

/**
 * The earliest windows the boards will step back to: the ones bracketing the
 * first puzzle.
 *
 * Nothing was ever scored before the game dropped, so a step past these could
 * only ever produce an empty board -- and unlike the finds feed, which has a
 * floor of its own because its table is younger than the game (see
 * `FINDS_EPOCH`), scores really do go back this far: a player who joins today
 * backfills every puzzle their browser remembers, all the way to the first one.
 */
export function weekFloor(): string {
  return weekStart(FIRST_PUZZLE);
}

/**
 * The earliest day the daily board will step back to: the first puzzle.
 *
 * Further back than the finds feed, which stops at the first day its own table
 * recorded anything (see `feedFloor`): scores really do go back this far -- a
 * player who joins today backfills every puzzle their browser remembers.
 */
export function dayFloor(): string {
  return FIRST_PUZZLE;
}

export function monthFloor(): string {
  return monthStart(FIRST_PUZZLE);
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
 * Both windows are sent rather than derived server-side: the puzzle date is
 * already the player's own local calendar date, so the windows that bracket it
 * have to come from the same clock (see game/week.ts, game/month.ts). Rejects on
 * failure; the caller turns that into the page's error state.
 */
export async function fetchBoards(
  date: string = todayDateString(),
  options: BoardOptions = {}
): Promise<Boards> {
  // The window the reader has stepped to, or the one they are in. Either way it
  // is a date this client computed, because the puzzle dates it brackets are
  // this player's own local calendar dates.
  const since = options.week ?? weekStart(date);
  // The single puzzle the daily board counts, which is the day being played
  // until a reader steps it. Sent like the other two windows because it is one:
  // a puzzle date is the player's own local calendar date, and nothing on the
  // server shares that clock.
  const day = options.day ?? date;
  // The month goes up for the same reason the week does: both windows bracket
  // the player's own local puzzle date, so both have to be computed off the same
  // clock. The server bounds the far end of both itself.
  const month = options.month ?? monthStart(date);
  // Who is asking, so the server can send their own row back from below the cut.
  // Nobody has to have joined for the page to work: without an id the boards
  // come back exactly as before, minus a row that would be about nobody.
  const playerId = loadPlayerId();
  // The player's own date goes up because the puzzle a find belongs to is the
  // player's own local calendar date, not a moment in UTC.
  const response = await fetch(
    `/api/leaderboard?since=${encodeURIComponent(since)}&today=${encodeURIComponent(date)}` +
      `&month=${encodeURIComponent(month)}` +
      `&day=${encodeURIComponent(day)}` +
      `&limit=${BOARD_LIMIT}` +
      (playerId ? `&player=${encodeURIComponent(playerId)}` : "") +
      freshParam(options),
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
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
  // The date is the only thing this request carries, so two players on the same
  // day send byte-identical URLs and share one cached answer. The server bounds
  // it against its own clock either way (see api/leaderboard.ts).
  const response = await fetch(
    `/api/leaderboard?words=1&today=${encodeURIComponent(date)}${freshParam(options)}`,
    // `no-store` keeps this out of *this browser's* cache, and nothing else:
    // the request still goes out and the CDN still answers it from the copy it
    // shares with everybody, which is the whole arrangement. Without it a poll
    // could be served from disk, and a page that polls a list it cannot see
    // change is worse than one that does not poll at all.
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  if (!response.ok) throw new Error(`leaderboard words ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseWords(body.words, date);
}

/** Turn one response body -- real or sample -- into the boards the page renders. */
function readBoards(body: Record<string, unknown>, since: string): Boards {
  return {
    daily: parseBoard(body.daily),
    dailySelf: parseSelf(body.dailySelf),
    weekly: parseBoard(body.weekly),
    weeklySelf: parseSelf(body.weeklySelf),
    monthly: parseBoard(body.allTime),
    monthlySelf: parseSelf(body.allTimeSelf),
    weekStart: typeof body.weekStart === "string" ? body.weekStart : since,
  };
}

/**
 * What a word was worth on the puzzle it was played on.
 *
 * Looked up fresh rather than trusted from the record, because the dictionary
 * keeps being corrected and a stored Zipf can be a year out of date -- but
 * looked up *at that puzzle's date*, so the answer is the one the game gave.
 * The stored value remains the fallback for a word the dictionary does not
 * carry at all, a live Merriam-Webster approval most often.
 *
 * This used to ask what the word is worth *today*, on the reasoning that a
 * player's best find is a current claim rather than a past result, and so should
 * be judged on the same terms for everyone. That reasoning quietly depended on
 * scoring only ever moving forward: today's system was the newest anything had
 * been priced at, so "today's terms" could only bring a past find up to date.
 * Freeform week is the first range where the puzzle in front of the player is
 * not on the newest system, and the same call started pulling the current
 * puzzle's finds *backwards* -- naming a player with a word the game had scored
 * quite differently an hour earlier.
 */
function scoreOnItsDay(word: AcceptedWord, date: string): number {
  return rarityScore(rarityFor(word.word, date)?.zipf ?? word.zipf, date);
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
   * Whether this day has spent its one retry (see game/storage.ts, retryWord).
   *
   * Sent only when true, and it is not a claim about the score: it says which
   * side of the retry this account of the day comes from. The board's write is
   * monotonic per day, so without it a word the player took back would go on
   * being ranked -- with it, the first submission after a retry is assigned
   * rather than maxed, and a pre-retry submission still in flight is dropped.
   * See the 20260831 migration for the four cases.
   */
  retried?: boolean;
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
 *
 * Every number here goes up unrounded. What precision a stored score has is the
 * endpoint's decision, and it makes it: api/leaderboard.ts rounds each number in
 * a submission to hundredths as it reads it. A client that rounds first has
 * taken that decision away, and nothing downstream can give it back -- this
 * file used to post a day's total already rounded to tenths, so a puzzle worth
 * 39.95 was stored as 40 and the hundredths were gone before any server saw
 * them. The screen rounds; the wire does not.
 */
function scoreFor(
  date: string,
  words: readonly AcceptedWord[],
  options: { withFound?: boolean; retried?: boolean } = {}
): ScorePayload {
  const best = rarest(words, date);
  return {
    date,
    word: best.word.toLowerCase(),
    // The measurement this puzzle gave it. This is the number the board shows
    // back as the player's find (see `scoreOf`), and it is the only place the
    // puzzle's date is still known, so it has to leave carrying that price.
    zipf: rarityFor(best.word, date)?.zipf ?? best.zipf,
    total: rawTotalRarityScore(words, date),
    top: topRarityScore(words, date),
    // Capped rather than trusted: the endpoint bounds this too, and sending more
    // than the day's guess limit allows would only get the batch rejected.
    words: Math.min(words.length, maxGuessesFor(date)),
    // Only when true. False is what the server assumes of an absent flag, so
    // sending it would put a field on every submission ever made to say the
    // ordinary thing.
    ...(options.retried ? { retried: true } : {}),
    ...(options.withFound ? { found: foundFor(date, words) } : {}),
  };
}

/**
 * A day's word list for the feed, priced by the day it was played.
 *
 * The sending half of `parseWords`, and dated for the same reason: this list is
 * what the feed shows back as a record of the puzzle, so the number that leaves
 * here has to be the number the player was shown. It is only ever read for a
 * word the reader's own dictionary does not carry -- a live Merriam-Webster
 * approval, most often -- but that is exactly the case with no second chance to
 * get it right.
 *
 * Unlike the rarest word in `scoreFor` above, which is a claim about the player
 * rather than a record of the puzzle and stays on today's terms.
 *
 * Trimmed to the day's guess limit for the same reason `words` is capped: the
 * endpoint refuses a longer list, and a batch it refuses costs the player the
 * whole day rather than one word.
 */
function foundFor(date: string, words: readonly AcceptedWord[]): FoundPayload[] {
  return words.slice(0, maxGuessesFor(date)).map((word) => ({
    word: word.word.toLowerCase(),
    zipf: rarityFor(word.word, date)?.zipf ?? word.zipf,
  }));
}

/** The rarest of one day's words, by that day's reckoning. */
function rarest(words: readonly AcceptedWord[], date: string): AcceptedWord {
  return words.reduce((best, word) =>
    scoreOnItsDay(word, date) > scoreOnItsDay(best, date) ? word : best
  );
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
  /** Whether this puzzle's one retry has been spent (DailyProgress.retryUsed). */
  retried?: boolean;
  /**
   * Which rules the day was played under. Taken from the progress record rather
   * than from the switch, so a word banked by a live lookup that settled after
   * the player flipped modes is judged by the game it was submitted to.
   */
  mode?: GameMode;
  playerId?: string | null;
}): boolean {
  const { date, isToday, words, retried } = options;
  const mode = options.mode ?? modeForDate(date);
  const playerId = options.playerId ?? loadPlayerId();
  if (!playerId || !isToday || words.length === 0) return false;
  // A day the player chose to spend in Freeform is not on the board. The two
  // systems do not produce comparable numbers -- Freeform prices every word on
  // its own frequency and hands out a Legend where Standard folds the word onto
  // its common form -- so one board holding both would rank whoever had the
  // switch on, and two boards would split a daily game's population in half to
  // no one's benefit.
  //
  // So Freeform is a way to play rather than a way to compete: you get your
  // score, you can share it, and nothing leaves the browser. The words go with
  // it -- `found` is what the finds feed is built from, and a feed priced on
  // Standard's terms is the wrong place for a word only Freeform would accept.
  //
  // The trial week is untouched by this and still submits: everybody was on the
  // same rules on those days, so they ranked against each other fairly, and they
  // are on the board already (see `isRanked`).
  if (!isRanked(date, mode)) return false;
  // The whole running word list goes with it, which is what the finds feed is
  // built from. Re-sent in full after every accepted word: each word is written
  // once and the repeats are discarded, so this is idempotent rather than
  // wasteful, and a player who joined halfway through the day still gets their
  // earlier finds onto the feed with their next word.
  // The name is the player's best word *ever*, not this puzzle's best, so it
  // comes from the whole stored history -- which already includes the words
  // being submitted, since they were saved before this was called. The fallback
  // covers a record too old to carry the timestamp that makes a day eligible.
  return post(playerId, [scoreFor(date, words, { withFound: true, retried })]);
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
    // Ranked days only, for the reason `submitScore` gives: a chosen Freeform
    // day is not on the board, and a history import is the one path that could
    // quietly put it there -- a browser that has been playing both ways holds a
    // record of each.
    .filter((progress) => isRanked(progress.date, progress.mode))
    // Words with today's puzzle and no other. Somebody who joins after playing
    // gets the finds they already made onto the feed rather than waiting for
    // their next word -- while a browser with a year of history sends a year of
    // scores and not a year of words, which is what keeps the batch inside the
    // request body cap and off a feed that shows one drop at a time.
    .map((progress) =>
      scoreFor(progress.date, progress.acceptedWords, {
        withFound: progress.date === today,
        // Carried on a repaired day too. A day whose retry was spent has a
        // retracted row on the board, and a submission that says otherwise is
        // dropped as a straggler -- so a sync that left this off would quietly
        // stop repairing exactly the days most likely to need it.
        retried: progress.retryUsed === true,
      })
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
