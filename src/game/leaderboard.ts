/**
 * The client half of the leaderboard: submit scores, fetch the boards.
 *
 * Both directions are strictly optional to the game. Submitting is
 * fire-and-forget -- it happens after a word has already been accepted, saved
 * and rendered, and a failure is never surfaced. Fetching is only ever done by
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
import { todayDateString } from "./date";
import { loadPlayerId } from "./player";
import { isWinningRarity } from "./rank";
import { playedOnItsDay } from "./storage";
import { sampleBoardsResponse, usingSampleData } from "../dev/sampleData";
import type { AcceptedWord, DailyProgress, Rarity } from "./types";
import { weekStart } from "./week";

export interface BoardEntry {
  /** Rank on this board, as the database ranked it. */
  rank: number;
  playerId: string;
  /**
   * The player's rarest word ever -- their name, and the same on both boards.
   *
   * Stable on purpose. A name that changed every week would make a rival
   * unrecognisable week to week, and being beaten by someone you recognise is
   * most of why a weekly board is worth coming back to.
   */
  name: string;
  /** What that word scores today. Priced here, not by the server. */
  nameScore: number;
  /**
   * The rarest word inside this board's window -- on the weekly board, what they
   * found *this* week. Equal to `name` on the all-time board, whose window is
   * everything.
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
  /** How many players this was the best word of the day for. */
  finders: number;
  /** Found on today's puzzle, so the feed can mark it as it happens. */
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
  allTime: BoardEntry[];
  /**
   * The best words other players found recently, rarest first.
   *
   * Never includes today: the same drop goes to everybody, so a word found today
   * is an answer to today's puzzle (the server enforces this -- see
   * api/leaderboard.ts). Not behind the player threshold either, because a short
   * list of good words is interesting at any size.
   */
  words: FoundWord[];
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

/** Whether the boards are published yet, on this player's own calendar. */
export function boardsOpen(date: string = todayDateString()): boolean {
  return date >= BOARDS_OPEN_FROM;
}

/** How many rows each board returns. Enough to scroll, not enough to be a wall. */
const BOARD_LIMIT = 50;
// A board is worth waiting a moment for, but not worth a spinner that never
// ends -- past this the page says it couldn't load and offers a retry.
const FETCH_TIMEOUT_MS = 6000;

interface RawEntry {
  rank?: unknown;
  playerId?: unknown;
  name?: unknown;
  nameZipf?: unknown;
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
    if (!item || typeof item !== "object") continue;
    const { rank, playerId, name, nameZipf, windowWord, windowZipf, score, puzzles } = item;
    if (typeof playerId !== "string" || typeof name !== "string") continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    // Every word on the board is priced here, at today's rates, from the word
    // itself -- so two players holding the same word always show the same
    // number, however long ago either of them found it.
    entries.push({
      rank: typeof rank === "number" && Number.isFinite(rank) ? rank : entries.length + 1,
      playerId,
      name,
      nameScore: scoreOf(name, nameZipf),
      windowWord: typeof windowWord === "string" ? windowWord : name,
      windowScore:
        typeof windowWord === "string" ? scoreOf(windowWord, windowZipf) : scoreOf(name, nameZipf),
      score,
      puzzles: typeof puzzles === "number" && Number.isFinite(puzzles) ? puzzles : 0,
    });
  }
  return entries;
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
    const isToday = foundOn === today;
    // Today's finds have to clear Rare to make the list. The bar is what makes a
    // live feed readable rather than a running commentary: on a busy day most
    // finds are ordinary, and the ones worth interrupting the page for are the
    // ones you would be pleased to have been beaten by.
    if (isToday && !isWinningRarity(rarity)) continue;
    words.push({
      word,
      zipf: current,
      rarity,
      finders: typeof finders === "number" && Number.isFinite(finders) ? finders : 1,
      today: isToday,
    });
  }
  return words;
}

/**
 * Fetch both boards in one request.
 *
 * The week's start is sent rather than derived server-side: the puzzle date is
 * already the player's own local calendar date, so the window that brackets it
 * has to come from the same clock (see game/week.ts). Rejects on failure; the
 * caller turns that into the page's error state.
 */
export async function fetchBoards(date: string = todayDateString()): Promise<Boards> {
  const since = weekStart(date);
  // Development only, and compiled out of a production build entirely: the
  // fixture stands in for the server so the page can be worked on without one.
  // Parsed by exactly the same code as a real response, so a change to that
  // parsing cannot pass here and fail in production.
  if (import.meta.env.DEV && usingSampleData()) {
    return readBoards(sampleBoardsResponse() as Record<string, unknown>, since, date);
  }
  // The player's own date goes up so the server can keep today's finds out of
  // the words feed -- a word found today is an answer to today's puzzle. The
  // server takes the earlier of this and its own, so sending a later one buys
  // nothing (see api/leaderboard.ts).
  const response = await fetch(
    `/api/leaderboard?since=${encodeURIComponent(since)}&today=${encodeURIComponent(date)}` +
      `&limit=${BOARD_LIMIT}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`leaderboard ${response.status}`);
  return readBoards((await response.json()) as Record<string, unknown>, since, date);
}

/** Turn one response body -- real or sample -- into the boards the page renders. */
function readBoards(body: Record<string, unknown>, since: string, date: string): Boards {
  return {
    // Rows are shown only when the server says the boards are published, so a
    // missing or malformed flag holds them back rather than letting them out.
    ready: body.ready === true,
    opensOn: typeof body.opensOn === "string" ? body.opensOn : BOARDS_OPEN_FROM,
    weekly: parseBoard(body.weekly),
    allTime: parseBoard(body.allTime),
    words: parseWords(body.words, date),
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

/** A word the player could be known by, and what it is worth today. */
export interface NameCandidate {
  word: string;
  score: number;
}

/**
 * How many finds a player gets to choose a name from. Ten is enough that the
 * choice is a real one and few enough to read without scrolling; beyond that the
 * words are not good enough to want anyway.
 */
export const NAME_CHOICES = 10;

/**
 * The words this player may be called by: the rarest word of each day they
 * played, best first.
 *
 * One word per day rather than every word ever, because that is what the server
 * stores and therefore what it will authorise -- offering a word it would refuse
 * would be offering a choice that doesn't work. It also picks the right ten: a
 * player's best days are exactly the finds worth being known for.
 *
 * Priced at today's rates, like everything else the board shows.
 */
export function nameCandidates(history?: readonly DailyProgress[]): NameCandidate[] {
  const best = new Map<string, number>();
  for (const progress of history ?? playedOnItsDay()) {
    if (progress.acceptedWords.length === 0) continue;
    const word = rarest(progress.acceptedWords);
    const name = word.word.toLowerCase();
    const score = scoreToday(word);
    // A word played on more than one day appears once, at its best showing.
    if (score > (best.get(name) ?? -1)) best.set(name, score);
  }
  return [...best.entries()]
    .map(([word, score]) => ({ word, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, NAME_CHOICES);
}

/**
 * Ask the board to call this player by one of their own words.
 *
 * Awaited, unlike a score: the player is watching, and a rename that quietly
 * didn't happen is worse than a slow one. Resolves false when the request failed
 * or the server refused the word, which the page reports rather than pretending.
 */
export async function chooseName(playerId: string, word: string): Promise<boolean> {
  try {
    const response = await fetch("/api/leaderboard", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, name: word }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
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
function scoreFor(date: string, words: readonly AcceptedWord[]): ScorePayload {
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
  };
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
  // The name is the player's best word *ever*, not this puzzle's best, so it
  // comes from the whole stored history -- which already includes the words
  // being submitted, since they were saved before this was called. The fallback
  // covers a record too old to carry the timestamp that makes a day eligible.
  return post(playerId, [scoreFor(date, words)]);
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
export function backfillHistory(playerId: string, history?: readonly DailyProgress[]): number {
  const played = history ?? playedOnItsDay();
  const scores = played
    .filter((progress) => progress.acceptedWords.length > 0)
    .map((progress) => scoreFor(progress.date, progress.acceptedWords));
  // Named from exactly the days being submitted, so the name and the scores in
  // one request always describe the same history.
  return post(playerId, scores) ? scores.length : 0;
}
