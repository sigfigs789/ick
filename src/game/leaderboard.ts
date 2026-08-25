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
import { rarityFor, rarityScore, topRarityScore, totalRarityScore } from "./dictionary";
import { todayDateString } from "./date";
import { loadPlayerId } from "./player";
import { playedOnItsDay } from "./storage";
import type { AcceptedWord, DailyProgress } from "./types";
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

export interface Boards {
  /**
   * Whether the boards are published yet. Below the player threshold the server
   * sends no rows at all and this is false, so a page that shows rows only when
   * `ready` can never accidentally render a three-name board.
   */
  ready: boolean;
  /** Distinct players who have scored all time. */
  players: number;
  /** How many are needed before the boards are shown. */
  minPlayers: number;
  weekly: BoardEntry[];
  allTime: BoardEntry[];
  /** The day the weekly board is counting from, echoed back by the server. */
  weekStart: string;
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
 * Fetch both boards in one request.
 *
 * The week's start is sent rather than derived server-side: the puzzle date is
 * already the player's own local calendar date, so the window that brackets it
 * has to come from the same clock (see game/week.ts). Rejects on failure; the
 * caller turns that into the page's error state.
 */
export async function fetchBoards(date: string = todayDateString()): Promise<Boards> {
  const since = weekStart(date);
  const response = await fetch(
    `/api/leaderboard?since=${encodeURIComponent(since)}&limit=${BOARD_LIMIT}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`leaderboard ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return {
    // Rows are shown only when the server says the boards are published, so a
    // missing or malformed flag holds them back rather than letting them out.
    ready: body.ready === true,
    players: typeof body.players === "number" ? body.players : 0,
    minPlayers: typeof body.minPlayers === "number" ? body.minPlayers : 0,
    weekly: parseBoard(body.weekly),
    allTime: parseBoard(body.allTime),
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

/** What the board calls a player, and what that word is worth today. */
export interface BoardIdentity {
  /** The rarest word this browser can prove was played on its own day. */
  name: string;
  /** That word's score under today's criteria -- shown as the player's "best". */
  score: number;
}

/**
 * The player's name on the board: the best word they have ever found, and what
 * it is worth today.
 *
 * Nobody types a name here. A word game's leaderboard is more interesting when
 * the names are the finds -- it says what each player is on the board *for*, and
 * it updates itself the moment somebody does better. It also means there is no
 * free-text field to police: nothing to impersonate, nothing to sanitise, and no
 * name to reserve.
 *
 * Drawn from the same days that get submitted (see storage.playedOnItsDay, which
 * includes today), so a word farmed out of the archive cannot become somebody's
 * name any more than it can become their score.
 *
 * Used by the page to show a player how they will appear before they join, and
 * to confirm it after. It is *not* what gets submitted: each day's own rarest
 * word goes up with that day's score, and the board derives the name from those
 * rows -- so nothing a client sends can assert what it should be called, and the
 * name can never drift out of step with the scores beside it.
 *
 * Returns null when this browser has no eligible word yet, which is what stops a
 * player joining with nothing to be called.
 */
export function boardIdentity(history?: readonly DailyProgress[]): BoardIdentity | null {
  return bestOf((history ?? playedOnItsDay()).map((progress) => progress.acceptedWords));
}

/** The rarest word across several days' worth, by today's reckoning. */
function bestOf(wordLists: Iterable<readonly AcceptedWord[]>): BoardIdentity | null {
  let best: AcceptedWord | undefined;
  let bestScore = -1;
  for (const words of wordLists) {
    for (const word of words) {
      const score = scoreToday(word);
      // Strictly greater, so the earliest of equally good words wins and a name
      // doesn't churn between ties on every submission.
      if (score > bestScore) {
        bestScore = score;
        best = word;
      }
    }
  }
  // Rounded to the two decimals the top of the scale displays at, so the number
  // stored is exactly the number shown.
  return best ? { name: best.word.toLowerCase(), score: Math.round(bestScore * 100) / 100 } : null;
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
