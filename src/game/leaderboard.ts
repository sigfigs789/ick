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
  scoringLoaded,
  scoringReady,
  topRarityScore,
} from "./dictionary";
import { todayDateString } from "./date";
import { FIRST_PUZZLE } from "./drop";
import { handleFor } from "./handle";
import { loadPlayerId } from "./player";
import { currentMode, freeformForDate, modeForDate, type GameMode } from "./mode";
import { loadStreak, playedHistory, playedOnItsDay } from "./storage";
import { streakReport } from "./streakFreeze";
import { offlineVerdict } from "./submit";
import type { AcceptedWord, DailyProgress, Rarity } from "./types";
import { monthStart } from "./month";
import { APP_VERSION } from "../version";
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
 * One row of the streak board: a player on a run right now.
 *
 * The numbers are the ones each player's own game reported with its last write
 * (see `streakReport` in game/streakFreeze.ts and the 20261016000000
 * migration), so the number here is the number the player sees beside their
 * puzzle. The server only decides whether the run is still alive today.
 */
export interface StreakEntry {
  /** Null on a lost run: it keeps its place on the board but holds no rank. */
  rank: number | null;
  playerId: string;
  name: string;
  /** Days played in the run they are on now. */
  current: number;
  /** The longest run they have ever had, this one included. */
  best: number;
  /**
   * A saved freeze is covering missed days and today is not played yet -- the
   * day the game shows 🧊 instead of 🔥.
   */
  frozen: boolean;
  /**
   * At least one day missed and today not played: a saved freeze is holding
   * the run up. The same as `frozen` since 20261026000000, which dropped the
   * free day; wider than it before.
   */
  covered: boolean;
  /**
   * Missing today ends the run: every saved freeze is spent.
   * The day the game shows ⏳ (`atRisk` in game/streakFreeze.ts). A run with a freeze left for today is not at risk.
   */
  atRisk: boolean;
  /**
   * The run has ended: the board keeps it, at the length it reached, for its
   * first two days over and marks it 💀. Playing again replaces it.
   */
  lost: boolean;
  /**
   * Today is a Saturday off the run's week earned, not played yet: missing it cannot
   * end the run, and the board shows 🕺, 💃 or 😴 (see `resting` in
   * game/streakFreeze.ts). Playing turns it back to 🔥.
   */
  resting: boolean;
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
  /**
   * The frequency the finder's game sent, for a word this dictionary does not
   * carry (a live Merriam-Webster approval, most often). Kept so the feed can be
   * repriced when the reader flips modes -- see `repriceFoundWords`.
   */
  stored?: number;
  /**
   * False when every finder banked it in Freeform. Absent otherwise, and on a
   * feed read before finds carried a mode. See `repriceFoundWords`.
   */
  standard?: false;
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
  /**
   * Everybody on a streak, longest first. One list for both modes: a day played
   * either way keeps the game's own streak alive, so it keeps this one alive too.
   *
   * Null when the server sent no streak board at all -- the Reddit build's own
   * endpoint, which renders this page and has no such board -- so the page can
   * leave it out rather than claim nobody is on a streak.
   */
  streak: StreakEntry[] | null;
  /** The same row-below-the-cut, on the streak board. */
  streakSelf: StreakEntry | null;
  /** The day the weekly board is counting from, echoed back by the server. */
  weekStart: string;
  /**
   * Which of the two boards these rows are: the mode they rank.
   *
   * Echoed back by the server rather than assumed from what was asked for, for
   * the same reason `weekStart` is -- a board labelled with the request rather
   * than the answer is a board that lies the one time it matters.
   */
  mode: GameMode;
}

/**
 * How many rows each board asks for.
 *
 * The whole board, not a top fifteen. Fifteen was a list you read rather than
 * scrolled, but the box already shows five and scrolls to the rest, so the cut
 * only hid people: a player sixteenth on the day had to rely on their own row
 * under the gap to know they were there at all, and could see nobody around
 * them. 999 is "everybody" with a ceiling on the response, and it is the
 * server's own maximum (`MAX_LIMIT` in api/leaderboard.ts, which says why it is
 * not a round thousand) -- a player past it still gets their own row below the
 * cut, at their real rank.
 */
export const BOARD_LIMIT = 999;
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
  /** The puzzle the window word was found on; absent from an older server. */
  windowDate?: unknown;
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
  const { rank, playerId, windowWord, windowZipf, windowDate, score, puzzles } = item;
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
    windowScore: scoreOf(
      windowWord,
      windowZipf,
      typeof windowDate === "string" && windowDate ? windowDate : undefined
    ),
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

/** Read the streak board, dropping anything malformed. */
function parseStreaks(raw: unknown): StreakEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: StreakEntry[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    // A lost run holds no rank, so the fallback counts the live runs alone.
    const entry = parseStreak(item, entries.filter((e) => e.rank !== null).length + 1);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** One streak row, or null. Like `parseEntry`, a self row needs its own rank. */
function parseStreak(
  item: Record<string, unknown> | null,
  fallbackRank?: number
): StreakEntry | null {
  if (!item || typeof item !== "object") return null;
  const { rank, playerId, current, best, frozen, covered, atRisk, lost, resting } = item;
  if (typeof playerId !== "string") return null;
  if (typeof current !== "number" || !Number.isFinite(current) || current < 1) return null;
  const ranked = typeof rank === "number" && Number.isFinite(rank) ? rank : fallbackRank;
  if (ranked === undefined && lost !== true) return null;
  return {
    rank: lost === true ? null : (ranked as number),
    playerId,
    name: nameFor(playerId, item.source),
    current,
    best: typeof best === "number" && Number.isFinite(best) ? Math.max(best, current) : current,
    frozen: frozen === true,
    covered: covered === true,
    atRisk: atRisk === true,
    lost: lost === true,
    resting: resting === true,
  };
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
 *
 * The stored number is a Zipf, though, not a score, so turning it back into the
 * number the finder saw needs the puzzle's rules as well: `foundOn`. Priced
 * undated, the 0.3 lift went missing here -- "morus" read 8.9 on the board
 * beside the 9.2 the game and the finds page showed. Undated only for a server
 * older than the column.
 */
function scoreOf(word: string, storedZipf: unknown, foundOn: string | undefined): number {
  if (typeof storedZipf === "number" && Number.isFinite(storedZipf)) {
    return rarityScore(storedZipf, foundOn);
  }
  const zipf = rarityFor(word)?.zipf;
  return zipf === undefined ? 0 : rarityScore(zipf, foundOn);
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
 * a word the game called Mythic an hour ago turns up here as Common.
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
 *
 * Priced as Standard, whatever the reader has their own switch set to and
 * whatever mode the finder was playing in. This feed holds both -- there is one
 * list of what the day's players turned up, because a word is a word whichever
 * rules the person who found it was under, and halving it would halve the one
 * part of this page that reads as live.
 *
 * Which leaves one number to choose for a word two people may have found under
 * two different systems, and Standard is the one to choose. It is the game as it
 * has been for months and as every archived puzzle scored; Freeform is the
 * variant. A feed priced on the reader's own switch would be worse than either:
 * the same list would read differently to two people looking at it side by side,
 * and a word would reprice itself under somebody who flipped a switch about
 * their own game. So the mode is named here rather than left to be read off the
 * session -- see `modeForDate` in game/mode.ts, which honours it for a chosen
 * day and ignores it for the trial week, which was nobody's choice.
 */
function parseWords(raw: unknown, today: string): FoundWord[] {
  if (!Array.isArray(raw)) return [];
  const words: FoundWord[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const { word, zipf, finders, foundOn, standard } = item;
    if (typeof word !== "string" || !word) continue;
    // An absent or malformed date has to read as "no date", not as the empty
    // string: every cutover here is a string comparison, and "" sorts below all
    // of them -- so passing it through would price the word on the legacy scale
    // the game used in July.
    const playedOn = typeof foundOn === "string" && foundOn ? foundOn : undefined;
    const stored = typeof zipf === "number" && Number.isFinite(zipf) ? zipf : undefined;
    const price = priceFind(word, playedOn, stored);
    if (!price) continue;
    // No rarity bar. The feed is what the day's players found, and a Common word
    // is part of what happened -- cutting it would quietly turn a record of the
    // puzzle into a highlight reel, which the boards above already are.
    words.push({
      word,
      ...price,
      finders: typeof finders === "number" && Number.isFinite(finders) ? finders : 1,
      foundOn: typeof foundOn === "string" ? foundOn : "",
      today: foundOn === today,
      ...(stored !== undefined ? { stored } : {}),
      ...(standard === false ? { standard: false as const } : {}),
    });
  }
  return words;
}

/**
 * What one find is worth to the reader, by the rules of the mode they are in.
 *
 * The feed holds finds from both modes, and a word is the same word whichever
 * game it was banked in -- so it is priced the way the reader would have been
 * scored for it, not the way the finder was. `rarityFor` reads the mode for any
 * puzzle from MODE_CHOICE_START on, which is what makes that the default.
 */
function priceFind(
  word: string,
  playedOn: string | undefined,
  stored: number | undefined
): { zipf: number; rarity: Rarity } | undefined {
  const zipf = rarityFor(word, playedOn)?.zipf ?? stored;
  if (zipf === undefined) return undefined;
  return { zipf, rarity: rarityForZipf(zipf, playedOn) };
}

/**
 * Whether the reader's own rules would have taken this find.
 *
 * The local lists settle most words (see `offlineVerdict`). The rest are words
 * only Merriam-Webster has judged, and for those the feed's record decides: a
 * word somebody banked in Standard plays in Standard. A Freeform reader, or a
 * day before the reader had a choice, takes every find the feed has.
 */
function readerCouldPlay(found: FoundWord): boolean {
  if (!found.foundOn) return true;
  const verdict = offlineVerdict(found.word, found.foundOn);
  if (verdict !== "unknown") return verdict === "playable";
  return found.standard !== false || freeformForDate(found.foundOn);
}

/**
 * The same feed, priced again under whatever mode the reader is in now, and
 * without the finds that mode would have refused.
 *
 * Nothing is fetched: the words and dates are already on screen, and flipping
 * the switch changes only the rules they are judged by. A Freeform find of an
 * archaic word is still a find, so a Freeform reader sees it; a Standard reader
 * does not, because their game would have turned it away.
 */
export function repriceFoundWords(words: readonly FoundWord[]): FoundWord[] {
  const playable = words.filter((found) => readerCouldPlay(found));
  return playable.map((found) => {
    const price = priceFind(found.word, found.foundOn || undefined, found.stored);
    return price ? { ...found, ...price } : found;
  });
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
  /**
   * Which of the two boards to read. Defaults to the mode the player is in,
   * which is the one they want to see first and the one their own scores are
   * landing on.
   */
  mode?: GameMode;
  /**
   * How many rows each board asks for. The whole board unless a caller says
   * otherwise; one that only wants the winner's name asks for one row rather
   * than downloading three boards of everybody to read the top of one.
   */
  limit?: number;
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
  // Which board. The player's own mode unless the page says otherwise, so
  // somebody who opens this page sees the board their scores are going onto
  // rather than one they are not on.
  const mode = options.mode ?? currentMode();
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
      `&mode=${encodeURIComponent(mode)}` +
      // The streak board rides along: it has no window to step, so it is the
      // same answer on every request the page makes, and it is one cheap read.
      `&streak=1` +
      `&limit=${options.limit ?? BOARD_LIMIT}` +
      (playerId ? `&player=${encodeURIComponent(playerId)}` : "") +
      freshParam(options),
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  if (!response.ok) throw new Error(`leaderboard ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  // A row without a stored Zipf is priced here (see `scoreOf`).
  await scoringReady();
  return readBoards(body, since, mode);
}

/** One row of the puzzles-played board. */
export interface TotalEntry {
  rank: number;
  playerId: string;
  name: string;
  /** Distinct puzzles played, either mode -- what ranks them. */
  puzzles: number;
  firstPlayed: string;
  lastPlayed: string;
}

/** The puzzles-played board, and the asking player's row from below its cut. */
export interface TotalBoard {
  entries: TotalEntry[];
  self: TotalEntry | null;
}

/** Read one puzzles-played row, or null for one that is malformed. */
function parseTotal(raw: unknown, fallbackRank: number): TotalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const { rank, playerId, puzzles, firstPlayed, lastPlayed } = item;
  if (typeof playerId !== "string" || !playerId) return null;
  if (typeof puzzles !== "number" || !Number.isFinite(puzzles) || puzzles < 1) return null;
  return {
    rank: typeof rank === "number" && Number.isFinite(rank) ? rank : fallbackRank,
    playerId,
    name: nameFor(playerId, item.source),
    puzzles,
    firstPlayed: typeof firstPlayed === "string" ? firstPlayed : "",
    lastPlayed: typeof lastPlayed === "string" ? lastPlayed : "",
  };
}

/**
 * Read the puzzles-played board: every player, most puzzles played first.
 *
 * `player` is the reader, so their own row comes back from below the cut.
 * Rejects on failure; the caller turns that into the page's error state.
 */
export async function fetchTotalBoard(
  player: string | null,
  options: FetchOptions = {}
): Promise<TotalBoard> {
  const who = player ? `&player=${encodeURIComponent(player)}` : "";
  const response = await fetch(`/api/leaderboard?total=1${who}${freshParam(options)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`leaderboard total ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const entries: TotalEntry[] = [];
  for (const item of Array.isArray(body.total) ? body.total : []) {
    const entry = parseTotal(item, entries.length + 1);
    if (entry) entries.push(entry);
  }
  return { entries, self: parseTotal(body.totalSelf, 0) };
}

/** One row of the dead-streaks board: a streak that ended and never restarted. */
export interface DeadStreakEntry {
  rank: number;
  playerId: string;
  name: string;
  /** Days in the run that ended. */
  lost: number;
  /** The longest run they ever had, which is what ranks them. */
  best: number;
  /** Their last day played. */
  lastPlayed: string;
  /** How many days they played in all. */
  days: number;
}

/** Read the dead-streaks board, dropping anything malformed. */
function parseDeadStreaks(raw: unknown): DeadStreakEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: DeadStreakEntry[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const { rank, playerId, lost, best, lastPlayed, days } = item;
    if (typeof playerId !== "string" || typeof lastPlayed !== "string") continue;
    if (typeof best !== "number" || !Number.isFinite(best) || best < 1) continue;
    const lostDays = typeof lost === "number" && Number.isFinite(lost) ? lost : 0;
    entries.push({
      rank: typeof rank === "number" && Number.isFinite(rank) ? rank : entries.length + 1,
      playerId,
      name: nameFor(playerId, item.source),
      lost: lostDays,
      best: Math.max(best, lostDays),
      lastPlayed,
      days: typeof days === "number" && Number.isFinite(days) ? days : 0,
    });
  }
  return entries;
}

/**
 * Read the dead-streaks board: players with two or more days played whose
 * streak ended and who never came back, longest streak first.
 *
 * Counted up to the player's own today, like the streak board. Rejects on
 * failure; the caller turns that into the page's error state.
 */
export async function fetchDeadStreaks(
  date: string = todayDateString(),
  options: FetchOptions = {}
): Promise<DeadStreakEntry[]> {
  const response = await fetch(
    `/api/leaderboard?dead=1&today=${encodeURIComponent(date)}${freshParam(options)}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  if (!response.ok) throw new Error(`leaderboard dead streaks ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseDeadStreaks(body.deadStreaks);
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
  // Each word is priced by its puzzle here (see `priceFind`).
  await scoringReady(date);
  return parseWords(body.words, date);
}

/**
 * The player ids that found `word` on `date`'s puzzle, first finder first.
 * Shared by every reader like the feed, so it carries no player of its own.
 */
export async function fetchWordFinders(word: string, date: string): Promise<string[]> {
  const response = await fetch(
    `/api/leaderboard?finders=${encodeURIComponent(word)}&today=${encodeURIComponent(date)}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  if (!response.ok) throw new Error(`leaderboard finders ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return Array.isArray(body.finders)
    ? body.finders.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * How many days each player has had the best word, on the puzzles before
 * `date`: player id to count, for the players who have had it at all. Shared
 * by every reader like the feed. Read only to settle a tie for the best word
 * (see `pickBest` in game/yesterdaysBest.ts).
 */
export async function fetchBestWordWins(date: string): Promise<Record<string, number>> {
  const response = await fetch(`/api/leaderboard?bestWins=1&today=${encodeURIComponent(date)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`leaderboard best wins ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const wins: Record<string, number> = {};
  if (body.wins && typeof body.wins === "object") {
    for (const [id, count] of Object.entries(body.wins as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isFinite(count)) wins[id.toLowerCase()] = count;
    }
  }
  return wins;
}

/** Turn one response body -- real or sample -- into the boards the page renders. */
function readBoards(
  body: Record<string, unknown>,
  since: string,
  asked: GameMode
): Boards {
  return {
    daily: parseBoard(body.daily),
    dailySelf: parseSelf(body.dailySelf),
    weekly: parseBoard(body.weekly),
    weeklySelf: parseSelf(body.weeklySelf),
    monthly: parseBoard(body.allTime),
    monthlySelf: parseSelf(body.allTimeSelf),
    streak: Array.isArray(body.streak) ? parseStreaks(body.streak) : null,
    streakSelf: parseStreak((body.streakSelf ?? null) as Record<string, unknown> | null),
    weekStart: typeof body.weekStart === "string" ? body.weekStart : since,
    // What came back, falling back to what was asked for -- which covers the
    // dev fixture and a deployment that predates the second board.
    mode: body.mode === "freeform" || body.mode === "standard" ? body.mode : asked,
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
function scoreOnItsDay(word: AcceptedWord, date: string, mode?: GameMode): number {
  return rarityScore(rarityFor(word.word, date, mode)?.zipf ?? word.zipf, date);
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
   * Which board this day belongs on: the rules it was played under.
   *
   * Sent on every submission rather than only on a Freeform one. There are two
   * boards now, not a default one with a flag, and a server that has to infer
   * which from an absent field is a server with a silent default in it.
   *
   * The endpoint honours it only for days on or after the split and writes every
   * earlier day to both boards whatever this says -- a day played before there
   * was a choice is not the client's to assign. See the 20260925 migration.
   */
  mode: GameMode;
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
   * A day played in Freeform by choice: its words go onto the finds feed, and
   * nothing goes onto the board. Sent only when true. See `submitScore`.
   */
  unranked?: boolean;
  /**
   * Every word accepted that day, which is what the finds feed is built from.
   *
   * Sent for the puzzle being played, and by `backfillFinds` for any past day
   * whose words the server has not yet taken -- never with the board's backfill,
   * because a browser with a year of history would not fit the request body.
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
  options: { withFound?: boolean; retried?: boolean; unranked?: boolean; mode?: GameMode } = {}
): ScorePayload {
  // The mode this day was *played* in, which is the one thing that must not be
  // read off the live switch here. A browser holding both modes' records
  // re-sends them together (see `backfillHistory`), so a day has to carry its
  // own rules or half of them get priced by whichever way the player happens to
  // be playing this afternoon.
  const mode = options.mode ?? modeForDate(date);
  const best = rarest(words, date, mode);
  return {
    date,
    word: best.word.toLowerCase(),
    // The measurement this puzzle gave it. This is the number the board shows
    // back as the player's find (see `scoreOf`), and it is the only place the
    // puzzle's date is still known, so it has to leave carrying that price.
    zipf: rarityFor(best.word, date, mode)?.zipf ?? best.zipf,
    // Priced off each word's stored frequency, which was measured under this
    // day's own rules when the word was banked -- so unlike the two lookups
    // above, these need no mode: every scoring profile prices a given frequency
    // the same way, and only the frequency itself forks.
    total: rawTotalRarityScore(words, date),
    top: topRarityScore(words, date),
    // Capped rather than trusted: the endpoint bounds this too, and sending more
    // than the day's guess limit allows would only get the batch rejected.
    words: Math.min(words.length, maxGuessesFor(date)),
    mode,
    // Only when true. False is what the server assumes of an absent flag, so
    // sending it would put a field on every submission ever made to say the
    // ordinary thing.
    ...(options.retried ? { retried: true } : {}),
    ...(options.unranked ? { unranked: true } : {}),
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

/** The rarest of one day's words, by that day's reckoning and that day's mode. */
function rarest(
  words: readonly AcceptedWord[],
  date: string,
  mode?: GameMode
): AcceptedWord {
  return words.reduce((best, word) =>
    scoreOnItsDay(word, date, mode) > scoreOnItsDay(best, date, mode) ? word : best
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
  const request = send(playerId, scores);
  if (!request) return false;
  void request.catch(() => {});
  return true;
}

/** The streak to send, or null when there is none or it cannot be read. */
function currentStreakReport(): ReturnType<typeof streakReport> {
  try {
    return streakReport(loadStreak());
  } catch {
    return null;
  }
}

/** `post`, handing back the request for a caller that wants to see it land. */
function send(playerId: string, scores: ScorePayload[]): Promise<Response> | null {
  // `version` is the release this client's scoring was built from. The server
  // ranks only clients at or above its floor (see MIN_RANKED_VERSION in
  // api/leaderboard.ts): a phone app is a frozen copy of these rules, so an
  // install that never updates would otherwise keep pricing words by a system
  // the website has since replaced, on the same board.
  //
  // `streak` is the game's own streak as of its last played day, for the streak
  // board, which shows what the game shows rather than working it out again
  // from the days on the board (see streakReport in game/streakFreeze.ts). Sent
  // with every write, so a sync on open repairs it the way it repairs the days.
  const streak = currentStreakReport();
  const body = JSON.stringify({
    playerId,
    version: APP_VERSION,
    scores,
    ...(streak ? { streak } : {}),
  });
  try {
    return Promise.resolve(fetch("/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }));
  } catch {
    // Recording a score must never be able to break the move that earned it.
    return null;
  }
}

/**
 * Send this puzzle's score up, if there is anything to send.
 *
 * Refuses in two cases, each on purpose:
 *   - nobody has joined the board on this browser, so there is no name to post;
 *   - no words have been accepted, so there is no score.
 *
 * A puzzle that isn't today's is sent, but `unranked`: archive play is off the
 * board for the same reason it is off the streak (you can look up the answers),
 * and on the feed because the feed is a record of what was found on each drop,
 * not a ranking. See below.
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
  if (!playerId || words.length === 0) return false;
  // Played after its own day -- out of the archive, or on a tab left open past
  // midnight. The words go up to that drop's feed, and the day goes nowhere near
  // a board: a past puzzle's answers are a page away, so a score earned on it
  // says nothing about the player. The server writes an `unranked` day's finds
  // and skips its board row.
  if (!isToday) {
    return post(playerId, [
      scoreFor(date, words, { withFound: true, retried, unranked: true, mode }),
    ]);
  }
  // Every mode submits. Which board the day lands on is decided from the mode it
  // was played in -- there is one per mode from the choice date on, and a day
  // played before that counts on both (see `boardFor` in game/mode.ts).
  //
  // Freeform used to be sent `unranked`, on the reasoning that the two systems
  // do not produce comparable numbers and one board holding both would rank
  // whoever had the switch on. The first half of that is still true and is
  // exactly why there are two boards; what does not follow from it is that one
  // of the two ways to play should have nowhere to be ranked at all.
  //
  // The words go up either way, and they are not split: `found` is what the
  // finds feed is built from, one list of what the day's players turned up,
  // which every reader reprices by their own mode (see `repriceFoundWords`).
  //
  // The whole running word list goes with it, which is what the finds feed is
  // built from. Re-sent in full after every accepted word: each word is written
  // once and the repeats are discarded, so this is idempotent rather than
  // wasteful, and a player who joined halfway through the day still gets their
  // earlier finds onto the feed with their next word.
  // The name is the player's best word *ever*, not this puzzle's best, so it
  // comes from the whole stored history -- which already includes the words
  // being submitted, since they were saved before this was called. The fallback
  // covers a record too old to carry the timestamp that makes a day eligible.
  return post(playerId, [scoreFor(date, words, { withFound: true, retried, mode })]);
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
      scoreFor(progress.date, progress.acceptedWords, {
        withFound: progress.date === today,
        // Carried on a repaired day too. A day whose retry was spent has a
        // retracted row on the board, and a submission that says otherwise is
        // dropped as a straggler -- so a sync that left this off would quietly
        // stop repairing exactly the days most likely to need it.
        retried: progress.retryUsed === true,
        // Off the record rather than off the switch, and this is the path that
        // makes it matter. A browser that has been playing both ways holds a
        // record of each and sends them in one batch, so a day priced by whoever
        // is playing this afternoon would put a Freeform afternoon on the
        // Standard board -- which is the one mistake two boards exist to prevent.
        mode: progress.mode,
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
  backfillFinds(playerId);
  return backfillHistory(playerId, undefined, today);
}

/**
 * `syncHistory`, once the deferred scoring data every played day needs is in
 * (see `scoringReady` in dictionary.ts). The history is re-priced on its way to
 * the board, and a day priced without the estimates and reviewed folds would
 * overwrite a right score with a wrong one. The oldest day decides whether the
 * legacy rarity is needed too. A file that failed to arrive skips this sync;
 * the next one tries again.
 */
export function syncHistoryWhenReady(): void {
  let oldest: string | undefined;
  for (const progress of playedHistory()) {
    if (oldest === undefined || progress.date < oldest) oldest = progress.date;
  }
  // At once when it is already in, as it is on every open after the first.
  if (scoringLoaded(oldest)) {
    syncHistory();
    return;
  }
  scoringReady(oldest).then(
    () => syncHistory(),
    () => {}
  );
}

/**
 * Which words this browser has seen the server take, per puzzle date.
 *
 * What lets `backfillFinds` send each word once rather than the whole history
 * on every open, which a long history would not fit in one request. Only ever
 * written after a 2xx: the play path is fire-and-forget, so a word is not
 * "sent" until something has watched it land. A ledger that is lost -- another
 * browser, cleared storage -- costs one re-send, which the server discards.
 */
export const FINDS_SENT_KEY = "ick:finds-sent";

/**
 * The most days one sync sends finds for. A backstop on the request body (see
 * MAX_BODY_BYTES in api/leaderboard.ts), not a schedule: anything past it goes
 * on the next open, because the ledger remembers where this one stopped.
 */
const FINDS_BATCH_DAYS = 60;

function loadFindsSent(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FINDS_SENT_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

function markFindsSent(days: readonly ScorePayload[]): void {
  try {
    const sent = loadFindsSent();
    for (const day of days) {
      const words = new Set(sent[day.date] ?? []);
      for (const find of day.found ?? []) words.add(find.word);
      sent[day.date] = [...words];
    }
    localStorage.setItem(FINDS_SENT_KEY, JSON.stringify(sent));
  } catch {
    // Storage full or disabled: the next sync re-sends, which is harmless.
  }
}

/**
 * Put every word this browser has found onto its drop's feed, if it isn't yet.
 *
 * The play path sends each word as it is banked, but it is fire-and-forget: a
 * word banked offline, or before this browser joined, or on an archive puzzle
 * by a client from before those were sent at all, never reached the feed and
 * nothing would ever send it again. This does, on every open.
 *
 * Every day goes up `unranked`, whatever it was: this is the feed's repair and
 * not the board's, and `backfillHistory` is what keeps the board. A day before
 * the feed's floor is skipped -- the page cannot show it.
 *
 * Fire-and-forget like every other write here: nothing waits on it, and the
 * ledger is only updated once the server has said yes. Returns how many days
 * were sent, for the tests.
 */
export function backfillFinds(
  playerId: string,
  history: readonly DailyProgress[] = playedHistory()
): number {
  const sent = loadFindsSent();
  // Keyed by day *and* mode, so each batch entry carries the mode its words were
  // banked in. A day played both ways sends two entries, and the server keeps
  // the Standard one where they share a word (see the 20260925 migration).
  const byDay = new Map<string, { date: string; mode: GameMode; words: AcceptedWord[] }>();
  for (const progress of history) {
    if (progress.date < FINDS_EPOCH) continue;
    const mode = progress.mode ?? modeForDate(progress.date);
    const key = `${progress.date}:${mode}`;
    const already = new Set(sent[progress.date] ?? []);
    const day = byDay.get(key) ?? { date: progress.date, mode, words: [] };
    for (const word of progress.acceptedWords) {
      const lower = word.word.toLowerCase();
      if (already.has(lower) || day.words.some((w) => w.word.toLowerCase() === lower)) continue;
      day.words.push(word);
    }
    if (day.words.length > 0) byDay.set(key, day);
  }
  const scores = [...byDay.values()]
    .slice(0, FINDS_BATCH_DAYS)
    .map(({ date, mode, words }) =>
      scoreFor(date, words, { withFound: true, unranked: true, mode })
    );
  if (scores.length === 0) return 0;
  const request = send(playerId, scores);
  if (!request) return 0;
  request.then(
    (response) => {
      if (response?.ok) markFindsSent(scores);
    },
    () => {}
  );
  return scores.length;
}
