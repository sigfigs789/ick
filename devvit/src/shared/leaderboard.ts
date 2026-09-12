/**
 * The leaderboard's wire shapes, and the bounds the server checks them against.
 *
 * Deliberately the same shapes `api/leaderboard.ts` speaks, down to the
 * response key still being called `allTime` for what is now the monthly board.
 * The client parsing them (`src/game/leaderboard.ts`) is shared with the
 * website, so the wire is not ours to redesign here: a rename would be a change
 * to the website's endpoint, its client, and this one, to no one's benefit.
 *
 * What does change is identity. The website's player is a UUID the browser
 * invents; inside a post the player is a Reddit account, and the server is told
 * who they are rather than asked. `playerId` on the wire therefore carries a
 * username, and the POST body no longer carries one at all -- a client that
 * says who it is, on a board it competes in, is a client that can say it is
 * somebody else.
 */

/** One board row, as both boards and the self-row below the cut return it. */
export interface BoardRow {
  rank: number;
  /** The Reddit username. Named `player_id` on the wire for the shared client. */
  player_id: string;
  window_word: string;
  window_zipf: number;
  total_score: number;
  puzzles: number;
}

/** One word in the finds feed. */
export interface FoundRow {
  word: string;
  zipf: number;
  finders: number;
  found_on: string;
}

/** The boards response, keys as the shared client reads them. */
export interface BoardsResponse {
  ready: boolean;
  weekStart: string;
  daily: BoardRow[];
  dailySelf: BoardRow | null;
  weekly: BoardRow[];
  weeklySelf: BoardRow | null;
  /** The monthly board, under the name the wire has always used for it. */
  allTime: BoardRow[];
  allTimeSelf: BoardRow | null;
}

/** One puzzle's score, as the game submits it. */
export interface ScoreSubmission {
  date: string;
  word: string;
  zipf: number;
  total: number;
  top: number;
  words: number;
  retried?: boolean;
  found?: { word: string; zipf: number }[];
}

/**
 * The bounds, carried over from the website's endpoint unchanged.
 *
 * The most a single puzzle can be worth is six guesses -- the pre-2026-08-20
 * limit, and the highest the game has ever allowed -- at a perfect 10. Bounding
 * on the historical maximum rather than today's five keeps an archived six-word
 * day submittable if that path is ever opened, and still rejects anything
 * arithmetic cannot reach.
 */
export const MAX_TOTAL = 60;
export const MAX_TOP = 10;
export const MAX_WORDS = 6;
/** Zipf runs roughly -2 (attested nowhere) to 8 ("the"); bounded wide. */
export const MIN_ZIPF = -10;
export const MAX_ZIPF = 10;
/**
 * A day's rarest word, which is also what the board calls players.
 *
 * The website validates this tightly because its endpoint is unauthenticated
 * and the value is shown to other players: a pattern this narrow leaves nothing
 * expressible that is invisible, right-to-left, or a passable imitation of the
 * page's own copy. None of that gets safer for being behind a Reddit account,
 * so the rule is kept exactly. 30 is the longest word the game accepts.
 */
export const WORD_RE = /^[a-z]{2,30}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How many rows a board shows. Fifteen is a list you read. */
export const BOARD_LIMIT = 15;
export const MAX_LIMIT = 200;
/**
 * A batch is a player's whole history, so it holds a couple of years of dailies.
 * This stops a caller naming the same handful of days ten thousand times.
 */
export const MAX_SCORES = 800;
/** A backstop on the finds feed, not a page. If it is ever reached, it wants paging. */
export const WORDS_LIMIT = 500;

/** Whether one submitted score is something the board can store. */
export function validScore(value: unknown): value is ScoreSubmission {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.date === 'string' &&
    DATE_RE.test(s.date) &&
    typeof s.word === 'string' &&
    WORD_RE.test(s.word) &&
    inRange(s.zipf, MIN_ZIPF, MAX_ZIPF) &&
    inRange(s.total, 0, MAX_TOTAL) &&
    inRange(s.top, 0, MAX_TOP) &&
    inRange(s.words, 0, MAX_WORDS) &&
    (s.retried === undefined || typeof s.retried === 'boolean')
  );
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
