// The client side of the two review lists: the word queue and the feedback
// players have left. See api/review.ts for what answers these.
//
// Both are read the same way, so they share one function and differ only in the
// shape that comes back. Nothing here touches gameplay: these lists are read by
// two pages that have no link in the app, and a failure on either is a page that
// says it could not load.


/** How long a read waits before giving up, matching the leaderboard's. */
const FETCH_TIMEOUT_MS = 6000;

/** The mark a row wears, or null for one nobody has judged yet. */
export type Mark = "accepted" | "rejected" | null;

/**
 * The next mark in the cycle.
 *
 * Unmarked, accepted, rejected, and round again -- so the same control both
 * sets a mark and takes it back, and a misclick is one more click rather than a
 * state you cannot get out of.
 */
export function nextMark(mark: Mark): Mark {
  if (mark === null) return "accepted";
  if (mark === "accepted") return "rejected";
  return null;
}

/** One word in the review queue, as the endpoint returns it. */
export interface SuggestedWord {
  word: string;
  /** Where the candidate came from: 'player', 'live-lookup', or 'both'. */
  origin: string;
  /** Frequency, or null when no corpus attests the word at all. */
  zipf: number | null;
  /** Merriam-Webster's functional labels. */
  pos: readonly string[];
  firstUse: string | null;
  mwSource: string | null;
  /** Live-lookup cache misses, which is "seen again" and never popularity. */
  lookups: number;
  /** How many times a player typed it into the suggestion box. */
  suggestions: number;
  /** When the word first turned up, by either door: the queue's own order. */
  firstAt: string | null;
  /** The most recent of the two, which is not what the list is sorted on. */
  lastAt: string | null;
  /** Its triage mark, which for a word is `word_sightings.status`. */
  mark: Mark;
  /**
   * Whether the live Merriam-Webster check approved it mid-puzzle, so it was
   * played without anybody judging it first. A different fact from `mark`: one
   * is what the game did at the time, the other what a person decided after.
   */
  liveApproved: boolean;
}

/** The side a player came down on in the Freeform week trial. */
export type Vote = "love" | "boo";

/** One note left under the Freeform week vote. */
export interface FreeformNote {
  id: number;
  text: string;
  at: string;
  /** The puzzle the writer was looking at, or null on an older event. */
  date: string | null;
  /**
   * The verdict this note sits beside: the one it was sent with, or failing
   * that the one its writer ended up on. Null where they never voted at all --
   * a note without a tap is still a note, and guessing a side for it would be
   * putting words in somebody's mouth.
   */
  vote: Vote | null;
}

/** How the two sides stand: a count of players, not of taps. */
export interface FreeformTally {
  love: number;
  boo: number;
}

/** The whole trial as the page reads it. */
export interface FreeformVerdict {
  tally: FreeformTally;
  /** The same tally per puzzle date, oldest day first. */
  byDate: readonly (FreeformTally & { date: string })[];
  notes: readonly FreeformNote[];
}

/** One note a player left in the how-to-play sheet. */
export interface FeedbackNote {
  id: number;
  text: string;
  at: string;
  mark: Mark;
}

/**
 * The token the deployment may require, taken from the page's own URL.
 *
 * Both pages are linked from the game now -- a player who leaves a note or
 * suggests a word is offered the list it landed on -- so the way somebody
 * reaches one no longer says anything about who they are. What still does is
 * the `?key=` on a curator's URL, which is the whole difference between reading
 * these lists and triaging them: see hasReviewKey below. Read from the address
 * bar rather than stored, so nothing leaves a review key sitting in
 * localStorage on a player's phone.
 */
function reviewKey(): string | null {
  return new URLSearchParams(window.location.search).get("key");
}

/**
 * Whether this reader arrived holding a key, and so may be shown the triage
 * controls.
 *
 * Not a permission check -- the endpoint does that, and refuses a mark from
 * anybody whose key does not match REVIEW_TOKEN. This is what the page draws:
 * a player following the link from the how-to-play sheet has no key, and
 * putting an accept/reject control in front of them would be offering a button
 * that can only fail. A curator opening the URL they were given has one.
 */
export function hasReviewKey(): boolean {
  return (reviewKey() ?? "") !== "";
}

/** The key as a trailing parameter, for a URL that already has one. */
function keyParam(): string {
  const key = reviewKey();
  return key ? `&key=${encodeURIComponent(key)}` : "";
}

/** The key as a whole query string, for a URL that has none. */
function keyQuery(): string {
  const key = reviewKey();
  return key ? `?key=${encodeURIComponent(key)}` : "";
}

async function read<T>(
  list: "suggested-words" | "feedback" | "freeform" | "analytics",
  pick: (body: Record<string, unknown>) => T,
  extra = "",
): Promise<T> {
  const response = await fetch(`/api/review?list=${list}${extra}${keyParam()}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`review ${list} ${response.status}`);
  return pick((await response.json()) as Record<string, unknown>);
}

/** Every word waiting to be triaged into the dictionary, oldest arrival first. */
export function fetchSuggestedWords(): Promise<SuggestedWord[]> {
  return read("suggested-words", (body) => parseWords(body.words));
}

/** Every note players have left, newest first. */
export function fetchFeedback(): Promise<FeedbackNote[]> {
  return read("feedback", (body) => parseFeedback(body.feedback));
}

/** The Freeform week trial: where the vote stands, and what people wrote. */
export function fetchFreeform(): Promise<FreeformVerdict> {
  return read("freeform", parseFreeform);
}

/** How the game is doing: play, retention, and what they depend on. */
/**
 * A window of 1 is today: the one puzzle `date` names, which is the viewer's own
 * calendar date. Longer windows send no date and end at the latest puzzle
 * anybody played.
 */
export function fetchAnalytics(days: number, date?: string): Promise<AnalyticsReport> {
  const window = days === 1 && date ? `&days=1&date=${date}` : `&days=${days}`;
  return read("analytics", (body) => parseAnalytics(body.report), window);
}

/** The most calendar days a picked range may span, as the endpoint allows. */
export const MAX_RANGE_DAYS = 365;

/** Days from `from` to `to`, both counted: 2026-09-01 to 2026-09-01 is 1. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * A picked calendar range, `from` to `to` inclusive, sent as the window the
 * report already speaks: its width in days, ending on `to`.
 */
export function fetchAnalyticsRange(from: string, to: string): Promise<AnalyticsReport> {
  return read("analytics", (body) => parseAnalytics(body.report), `&days=${rangeDays(from, to)}&date=${to}`);
}

/**
 * Rows are read rather than cast.
 *
 * The endpoint bounds and shapes them already, so this is not validation of
 * anything untrusted -- it is the boundary where a JSON body becomes a typed
 * list, and a row missing the one field the list is *about* is dropped rather
 * than rendered as a blank line.
 */
function parseWords(raw: unknown): SuggestedWord[] {
  if (!Array.isArray(raw)) return [];
  const words: SuggestedWord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.word !== "string" || row.word === "") continue;
    words.push({
      word: row.word,
      origin: typeof row.origin === "string" ? row.origin : "player",
      zipf: typeof row.zipf === "number" ? row.zipf : null,
      pos: Array.isArray(row.pos) ? row.pos.filter((p): p is string => typeof p === "string") : [],
      firstUse: typeof row.firstUse === "string" ? row.firstUse : null,
      mwSource: typeof row.mwSource === "string" ? row.mwSource : null,
      lookups: typeof row.lookups === "number" ? row.lookups : 0,
      suggestions: typeof row.suggestions === "number" ? row.suggestions : 0,
      mark: asMark(row.mark),
      firstAt: typeof row.firstAt === "string" ? row.firstAt : null,
      lastAt: typeof row.lastAt === "string" ? row.lastAt : null,
      liveApproved: row.liveApproved === true,
    });
  }
  return words;
}

/**
 * The trial as a typed value.
 *
 * Every part of it is optional in the reading: a tally with no votes yet, a
 * breakdown with no dated ones, a list with no notes. All three are real states
 * of a trial in its first hours, and none of them is an error -- the page says
 * "nothing yet" where it finds one, which is different from "could not load".
 */
function parseFreeform(body: Record<string, unknown>): FreeformVerdict {
  return {
    tally: parseTally(body.tally),
    byDate: Array.isArray(body.byDate)
      ? body.byDate.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const row = entry as Record<string, unknown>;
          if (typeof row.date !== "string" || row.date === "") return [];
          return [{ date: row.date, ...parseTally(row) }];
        })
      : [],
    notes: parseFreeformNotes(body.notes),
  };
}

function parseTally(raw: unknown): FreeformTally {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    love: typeof row.love === "number" ? row.love : 0,
    boo: typeof row.boo === "number" ? row.boo : 0,
  };
}

function parseFreeformNotes(raw: unknown): FreeformNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: FreeformNote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text === "") continue;
    notes.push({
      id: typeof row.id === "number" ? row.id : notes.length,
      text,
      at: typeof row.at === "string" ? row.at : "",
      date: typeof row.date === "string" ? row.date : null,
      vote: row.vote === "love" || row.vote === "boo" ? row.vote : null,
    });
  }
  return notes;
}

/** Anything that is not one of the two marks is an unmarked row. */
function asMark(value: unknown): Mark {
  return value === "accepted" || value === "rejected" ? value : null;
}

function parseFeedback(raw: unknown): FeedbackNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: FeedbackNote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text === "") continue;
    notes.push({
      id: typeof row.id === "number" ? row.id : notes.length,
      text,
      at: typeof row.at === "string" ? row.at : "",
      mark: asMark(row.mark),
    });
  }
  return notes;
}

/**
 * Set or clear the mark on one row, and answer with what is stored.
 *
 * The stored value rather than the asked-for one: the page draws the mark
 * optimistically, and this is what lets it correct itself instead of leaving a
 * tick over a row the database never marked. Rejects on failure, so the caller
 * can put the old mark back.
 */
export async function setMark(
  list: "suggested-words" | "feedback",
  ref: string | number,
  mark: Mark,
): Promise<Mark> {
  const response = await fetch(`/api/review${keyQuery()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ list, ref, mark }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`review mark ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return asMark(body.mark);
}

/** A count of people and how many of them did the thing, which a rate is made of. */
export interface Rate {
  cohort: number;
  returned: number;
}

/**
 * The analytics page's one document, as `analytics_report` builds it (see the
 * 2026-09-27 migration, which is where every one of these numbers is defined).
 *
 * The play half -- totals through depth -- counts players off the board's
 * table, a row per player per live puzzle they banked a word on. The visit half
 * -- funnel through hours -- counts events over the last `windowDays` days.
 */
export interface AnalyticsReport {
  /** The latest puzzle anybody played; null when nobody has. */
  asOf: string | null;
  /** 1 for the today window, otherwise how many puzzles and days it spans. */
  windowDays: number;
  /**
   * The first puzzle a visit event is stamped with. Before it, visits carry no
   * puzzle, so the today window's visit half only counts from here.
   */
  visitsSince: string | null;
  /** The day the first visit carrying a player id arrived: where visitor counts begin. */
  visitorsSince: string | null;
  totals: {
    players: number;
    plays: number;
    today: number;
    last7: number;
    last30: number;
    avgDaysPerPlayer: number | null;
    firstDay: string | null;
    /**
     * Players who opened the leaderboard or the found words for a puzzle and
     * banked no word on it -- on the latest puzzle, and on any of the last 7.
     */
    lookersToday: number;
    lookersLast7: number;
    /** Looked at some point, and have never banked a word at all. */
    lookersNeverPlayed: number;
    /** The first puzzle a look was recorded against; null before any was. */
    lookersSince: string | null;
  };
  /**
   * The headline numbers over exactly the puzzles `daily` spans, so they follow
   * the window the page picked.
   */
  window: {
    puzzles: number;
    /** Distinct players on any puzzle in the window. */
    players: number;
    /** Whose first puzzle ever is in the window. */
    newPlayers: number;
    /** Puzzles played per player, over the window's players; null when none. */
    avgDaysPerPlayer: number | null;
    /** The average puzzle's players; null when nobody played. */
    avgDailyPlayers: number | null;
    /** Looked at a puzzle in the window without banking a word on it. */
    lookers: number;
    /**
     * DAU/MAU: each puzzle's players over the 30 puzzles ending on it, averaged
     * over the window. Null before the report carried it, or when nobody played.
     */
    dauMau: number | null;
    /** The window's first and last puzzle; null before the report carried them. */
    from: string | null;
    to: string | null;
  };
  daily: Array<{
    date: string;
    players: number;
    newPlayers: number;
    standard: number;
    freeform: number;
    /** Opened the leaderboard or the found words, and banked no word. */
    lookers: number;
  }>;
  retention: { d1: Rate; d7: Rate; d30: Rate; week1: Rate };
  /** Sunday-started weeks of first play; `active[k]` is who played in week k. */
  cohorts: Array<{ week: string; size: number; active: number[] }>;
  /** 0 is Sunday. */
  weekday: Array<{
    dow: number;
    puzzles: number;
    avgPlayers: number | null;
    avgNewPlayers: number | null;
    avgWords: number | null;
    avgTotal: number | null;
    nextDay: Rate;
  }>;
  modes: Array<{
    mode: string;
    players: number;
    plays: number;
    avgWords: number | null;
    avgTotal: number | null;
    avgTop: number | null;
    nextDay: Rate;
  }>;
  depth: Array<{ bucket: string; players: number }>;
  funnel: {
    visits: number;
    /** Distinct browsers, by player id, that opened the game in the window. */
    visitors: number;
    /** The visits those browsers made: the numerator for visits per visitor. */
    visitsWithId: number;
    firstVisits: number;
    /** Visits that guessed, or opened the leaderboard or the found words. */
    engaged: number;
    /** Of those, the ones whose first act was opening one of the two pages. */
    engagedByLooking: number;
    completed: number;
    won: number;
    shared: number;
    sharedOnX: number;
    toFreeform: number;
    toStandard: number;
  };
  sources: Array<{ source: string; visits: number; visitors: number; firstVisits: number; engaged: number }>;
  sessions: {
    sessions: number;
    medianVisibleMs: number | null;
    medianPlayingMs: number | null;
    medianFirstGuessMs: number | null;
    guessedShare: number | null;
    /** Sessions that opened the leaderboard or the found words and never guessed. */
    lookedOnly: number;
    /** That, as a share of the sessions recent enough to report it. */
    lookedOnlyShare: number | null;
  };
  /** Visits by hour of day, Mountain Time. */
  hours: Array<{ hour: number; visits: number }>;
  /**
   * The chat room, from `chat_report` (the 2026-09-30 migration). Null when that
   * read failed or predates it -- the page then leaves the section out rather
   * than showing zeros that would read as "nobody chats".
   */
  chat: ChatReport | null;
  /**
   * New players by the mode they were started in, from `onboarding_report` (the
   * 20260930020000 migration). Null when that read failed or predates it.
   */
  onboarding: OnboardingReport | null;
  /**
   * Words copied into the other mode, and the retention of the players who
   * copy, from `copy_report` (the 20261001000000 migration). Null when that read
   * failed or predates it.
   */
  copies: CopyReport | null;
  /**
   * What the players who come back went through, from `retention_report` (the
   * 20261005000000 migration). Null when that read failed or predates it.
   */
  returners: ReturnersReport | null;
  /**
   * Answers scored from Claude's estimated Zipf, and the game before and after
   * the first one, from `estimated_score_report` (the 20261006000000
   * migration). Null when that read failed or predates it.
   */
  estimates: EstimatesReport | null;
}

/**
 * Who comes back, split by what happened to them rather than by the calendar.
 * Event splits cover only tracked days: the iOS app and the Reddit post send no
 * events. A group of fewer than five players never leaves the database.
 */
export interface ReturnersReport {
  from: string | null;
  to: string | null;
  /** The first puzzle any event named a player on. */
  trackedSince: string | null;
  firstPuzzle: {
    totals: { players: number; tracked: number; nextDay: Rate; week: Rate };
    /** One row per group of one split, e.g. split "outcome", group "Won". */
    groups: Array<{ split: string; group: string; players: number; nextDay: Rate; week: Rate }>;
  };
  /** Newest first. */
  puzzles: Array<{
    date: string;
    players: number;
    nextDay: Rate;
    newPlayers: number;
    /** Null when the puzzle had fewer than five new players. */
    newNextDay: Rate | null;
    avgWords: number | null;
    avgTop: number | null;
    tracked: number;
    completed: number;
    won: number;
    refusalsPerPlayer: number | null;
    foldsPerPlayer: number | null;
  }>;
  /** Players who stopped: their last day against their own earlier days. */
  lastDay: { players: number; last: StopStats | null; usual: StopStats | null };
  /** Newest build first. */
  versions: Array<{ version: number; players: number; firstDay: string; lastDay: string; nextDay: Rate }>;
}

export interface StopStats {
  days: number;
  avgWords: number | null;
  avgTop: number | null;
  tracked: number;
  finishShare: number | null;
  winShare: number | null;
  refusalsPerDay: number | null;
  foldsPerDay: number | null;
  revealedShare: number | null;
  lookedShare: number | null;
  sharedShare: number | null;
  afterGapShare: number | null;
  freeformShare: number | null;
}

/** Copies of a word into the other mode, over the same window as the report. */
export interface CopyReport {
  totals: {
    /** Taps on a copy control, whatever came of them. */
    taps: number;
    /** Words actually banked in the other mode. */
    copies: number;
    /** Distinct players with at least one copy. */
    copiers: number;
    toFreeform: number;
    toStandard: number;
    refused: number;
    full: number;
    lookupFailed: number;
    /** Distinct players who played in the window, for the share who copy. */
    players: number;
    avgCopiesPerCopier: number | null;
    /** Score in the other mode minus score in this one, averaged over copies. */
    avgScoreGain: number | null;
    /** Copies that scored higher over there. */
    higherThere: number;
    /** The first puzzle a copy tap was recorded against. */
    since: string | null;
  };
  daily: Array<{ date: string; copies: number; copiers: number; players: number }>;
  retention: {
    /** Player-days, by whether a word was copied that day; returned the next. */
    nextDay: { copied: Rate; other: Rate };
    /** Players, by whether they ever copied; returned within seven puzzles. */
    week: { copied: Rate; other: Rate };
  };
}

/** One side of the before/after comparison in `EstimatesReport`. */
export interface EstimatesSpan {
  from: string;
  to: string;
  playerDays: number;
  answers: number;
  /** Answers scored Legend. */
  legends: number;
  /** Answers scored on the unattested sentinel. */
  unattested: number;
  /** Player-days that finished the puzzle. */
  completions: number;
  avgScore: number | null;
  nextDay: Rate;
}

/** What Claude's estimated Zipf did to the game -- see estimated_score_report. */
export interface EstimatesReport {
  totals: {
    /** The first puzzle a player banked an estimated word on. */
    since: string | null;
    answers: number;
    estimated: number;
    unattested: number;
    measured: number;
    players: number;
    /** Distinct players who banked at least one estimated word. */
    finders: number;
    avgScoreEstimated: number | null;
    avgScoreUnattested: number | null;
    avgScoreMeasured: number | null;
    estimatedLegends: number;
  };
  daily: Array<{
    date: string;
    answers: number;
    estimated: number;
    unattested: number;
    players: number;
    finders: number;
  }>;
  /** Equal spans either side of `since`; null before any estimate was banked. */
  compare: { before: EstimatesSpan; after: EstimatesSpan } | null;
  retention: { nextDay: { found: Rate; other: Rate } };
}

/** Why a new player started in the mode they did -- see game/onboarding.ts. */
export type OnboardingReason = "shared" | "default" | "split";

/** One starting mode, for one reason, over the window. */
export interface OnboardingArm {
  reason: OnboardingReason;
  mode: string;
  /** Every player assigned into it, whether or not they banked a word. */
  players: number;
  /** Of those, the ones who banked a word on some day. */
  played: number;
  /** Live days played, summed over the arm. */
  playedDays: number;
  avgDaysPlayed: number | null;
  d1: Rate;
  d7: Rate;
  /** Played again at least once in the seven days after arriving. */
  week1: Rate;
  /** Players who shared at least once. */
  sharers: number;
  shares: number;
  /** Players who moved the switch at least once. */
  switched: number;
}

export interface OnboardingReport {
  /** The first puzzle a starting mode was recorded on. */
  since: string | null;
  arms: OnboardingArm[];
  /** Taps on a share link, by link and the mode it carried (`none` before). */
  arrivals: Array<{ link: string; mode: string; arrivals: number }>;
}

/** Chat numbers over the same window of puzzles as the rest of the report. */
export interface ChatReport {
  totals: {
    /** Times the panel was opened. */
    opens: number;
    /** Distinct players who opened it. */
    viewers: number;
    /** Distinct players who sent at least one message. */
    senders: number;
    messages: number;
    /** Sends the room refused: the filter, the rate limit, or a failure. */
    blocked: number;
    blockedProfane: number;
    blockedRateLimited: number;
    viewersToday: number;
    sendersToday: number;
    messagesToday: number;
    viewersLast7: number;
    sendersLast7: number;
    /** Viewers who opened the chat on more than one puzzle. */
    returningViewers: number;
    /** Of the players who opened it, the share who ever sent. */
    senderShare: number | null;
    avgOpensPerViewer: number | null;
    avgMessageLength: number | null;
    /** The first puzzle a chat open was recorded against. */
    since: string | null;
  };
  time: {
    views: number;
    medianViewMs: number | null;
    avgViewMs: number | null;
    totalMs: number | null;
    /** Median time open, over the views that sent something. */
    medianSendingViewMs: number | null;
    sendingViewShare: number | null;
  };
  daily: Array<{
    date: string;
    viewers: number;
    senders: number;
    opens: number;
    messages: number;
    totalMs: number;
  }>;
  /** The room itself, all time, off the chat_messages table. */
  room: {
    messages: number;
    hidden: number;
    senders: number;
    last24h: number;
    lastAt: string | null;
  };
}

type Json = Record<string, unknown>;

function obj(raw: unknown): Json {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Json) : {};
}

function list(raw: unknown): Json[] {
  return Array.isArray(raw) ? raw.map(obj) : [];
}

/** A number, or null where the database had none (an average of nothing). */
function maybe(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A count, which is zero rather than missing when absent. */
function count(raw: unknown): number {
  return maybe(raw) ?? 0;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function rate(raw: unknown): Rate {
  const r = obj(raw);
  return { cohort: count(r.cohort), returned: count(r.returned) };
}

/**
 * The report as a typed value, every part of it optional in the reading: a
 * section the database left out renders as empty rather than taking the page
 * down with it.
 */
export function parseAnalytics(raw: unknown): AnalyticsReport {
  const r = obj(raw);
  const totals = obj(r.totals);
  const win = obj(r.window);
  const retention = obj(r.retention);
  const funnel = obj(r.funnel);
  const sessions = obj(r.sessions);
  return {
    asOf: text(r.asOf),
    windowDays: count(r.windowDays),
    visitsSince: text(r.visitsSince),
    visitorsSince: text(r.visitorsSince),
    totals: {
      players: count(totals.players),
      plays: count(totals.plays),
      today: count(totals.today),
      last7: count(totals.last7),
      last30: count(totals.last30),
      avgDaysPerPlayer: maybe(totals.avgDaysPerPlayer),
      firstDay: text(totals.firstDay),
      lookersToday: count(totals.lookersToday),
      lookersLast7: count(totals.lookersLast7),
      lookersNeverPlayed: count(totals.lookersNeverPlayed),
      lookersSince: text(totals.lookersSince),
    },
    window: {
      puzzles: count(win.puzzles),
      players: count(win.players),
      newPlayers: count(win.newPlayers),
      avgDaysPerPlayer: maybe(win.avgDaysPerPlayer),
      avgDailyPlayers: maybe(win.avgDailyPlayers),
      lookers: count(win.lookers),
      dauMau: maybe(win.dauMau),
      from: text(win.from),
      to: text(win.to),
    },
    daily: list(r.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        players: count(d.players),
        newPlayers: count(d.newPlayers),
        standard: count(d.standard),
        freeform: count(d.freeform),
        lookers: count(d.lookers),
      })),
    retention: {
      d1: rate(retention.d1),
      d7: rate(retention.d7),
      d30: rate(retention.d30),
      week1: rate(retention.week1),
    },
    cohorts: list(r.cohorts)
      .filter((c) => text(c.week))
      .map((c) => ({
        week: c.week as string,
        size: count(c.size),
        active: Array.isArray(c.active) ? c.active.map(count) : [],
      })),
    weekday: list(r.weekday).map((w) => ({
      dow: count(w.dow),
      puzzles: count(w.puzzles),
      avgPlayers: maybe(w.avgPlayers),
      avgNewPlayers: maybe(w.avgNewPlayers),
      avgWords: maybe(w.avgWords),
      avgTotal: maybe(w.avgTotal),
      nextDay: { cohort: count(w.nextDayCohort), returned: count(w.nextDayReturned) },
    })),
    modes: list(r.modes)
      .filter((m) => text(m.mode))
      .map((m) => ({
        mode: m.mode as string,
        players: count(m.players),
        plays: count(m.plays),
        avgWords: maybe(m.avgWords),
        avgTotal: maybe(m.avgTotal),
        avgTop: maybe(m.avgTop),
        nextDay: { cohort: count(m.nextDayCohort), returned: count(m.nextDayReturned) },
      })),
    depth: list(r.depth).map((d) => ({
      bucket: text(d.bucket) ?? "",
      players: count(d.players),
    })),
    funnel: {
      visits: count(funnel.visits),
      visitors: count(funnel.visitors),
      visitsWithId: count(funnel.visitsWithId),
      firstVisits: count(funnel.firstVisits),
      engaged: count(funnel.engaged),
      engagedByLooking: count(funnel.engagedByLooking),
      completed: count(funnel.completed),
      won: count(funnel.won),
      shared: count(funnel.shared),
      sharedOnX: count(funnel.sharedOnX),
      toFreeform: count(funnel.toFreeform),
      toStandard: count(funnel.toStandard),
    },
    sources: list(r.sources).map((s) => ({
      source: text(s.source) ?? "direct",
      visits: count(s.visits),
      visitors: count(s.visitors),
      firstVisits: count(s.firstVisits),
      engaged: count(s.engaged),
    })),
    sessions: {
      sessions: count(sessions.sessions),
      medianVisibleMs: maybe(sessions.medianVisibleMs),
      medianPlayingMs: maybe(sessions.medianPlayingMs),
      medianFirstGuessMs: maybe(sessions.medianFirstGuessMs),
      guessedShare: maybe(sessions.guessedShare),
      lookedOnly: count(sessions.lookedOnly),
      lookedOnlyShare: maybe(sessions.lookedOnlyShare),
    },
    hours: list(r.hours).map((h) => ({ hour: count(h.hour), visits: count(h.visits) })),
    chat: r.chat && typeof r.chat === "object" ? parseChat(r.chat) : null,
    onboarding:
      r.onboarding && typeof r.onboarding === "object" ? parseOnboarding(r.onboarding) : null,
    copies: r.copies && typeof r.copies === "object" ? parseCopies(r.copies) : null,
    returners: r.returners && typeof r.returners === "object" ? parseReturners(r.returners) : null,
    estimates: r.estimates && typeof r.estimates === "object" ? parseEstimates(r.estimates) : null,
  };
}

function parseStop(raw: unknown): StopStats | null {
  if (!raw || typeof raw !== "object") return null;
  const s = obj(raw);
  return {
    days: count(s.days),
    avgWords: maybe(s.avgWords),
    avgTop: maybe(s.avgTop),
    tracked: count(s.tracked),
    finishShare: maybe(s.finishShare),
    winShare: maybe(s.winShare),
    refusalsPerDay: maybe(s.refusalsPerDay),
    foldsPerDay: maybe(s.foldsPerDay),
    revealedShare: maybe(s.revealedShare),
    lookedShare: maybe(s.lookedShare),
    sharedShare: maybe(s.sharedShare),
    afterGapShare: maybe(s.afterGapShare),
    freeformShare: maybe(s.freeformShare),
  };
}

function parseReturners(raw: unknown): ReturnersReport {
  const r = obj(raw);
  const first = obj(r.firstPuzzle);
  const totals = obj(first.totals);
  const lastDay = obj(r.lastDay);
  return {
    from: text(r.from),
    to: text(r.to),
    trackedSince: text(r.trackedSince),
    firstPuzzle: {
      totals: {
        players: count(totals.players),
        tracked: count(totals.tracked),
        nextDay: rate(totals.nextDay),
        week: rate(totals.week),
      },
      groups: list(first.groups)
        .filter((g) => text(g.split) && text(g.group))
        .map((g) => ({
          split: g.split as string,
          group: g.group as string,
          players: count(g.players),
          nextDay: rate(g.nextDay),
          week: rate(g.week),
        })),
    },
    puzzles: list(r.puzzles)
      .filter((p) => text(p.date))
      .map((p) => ({
        date: p.date as string,
        players: count(p.players),
        nextDay: rate(p.nextDay),
        newPlayers: count(p.newPlayers),
        newNextDay: p.newNextDay && typeof p.newNextDay === "object" ? rate(p.newNextDay) : null,
        avgWords: maybe(p.avgWords),
        avgTop: maybe(p.avgTop),
        tracked: count(p.tracked),
        completed: count(p.completed),
        won: count(p.won),
        refusalsPerPlayer: maybe(p.refusalsPerPlayer),
        foldsPerPlayer: maybe(p.foldsPerPlayer),
      })),
    lastDay: {
      players: count(lastDay.players),
      last: parseStop(lastDay.last),
      usual: parseStop(lastDay.usual),
    },
    versions: list(r.versions)
      .filter((v) => maybe(v.version) !== null && text(v.firstDay) && text(v.lastDay))
      .map((v) => ({
        version: count(v.version),
        players: count(v.players),
        firstDay: v.firstDay as string,
        lastDay: v.lastDay as string,
        nextDay: rate(v.nextDay),
      })),
  };
}

function parseCopies(raw: unknown): CopyReport {
  const c = obj(raw);
  const t = obj(c.totals);
  const retention = obj(c.retention);
  const nextDay = obj(retention.nextDay);
  const week = obj(retention.week);
  return {
    totals: {
      taps: count(t.taps),
      copies: count(t.copies),
      copiers: count(t.copiers),
      toFreeform: count(t.toFreeform),
      toStandard: count(t.toStandard),
      refused: count(t.refused),
      full: count(t.full),
      lookupFailed: count(t.lookupFailed),
      players: count(t.players),
      avgCopiesPerCopier: maybe(t.avgCopiesPerCopier),
      avgScoreGain: maybe(t.avgScoreGain),
      higherThere: count(t.higherThere),
      since: text(t.since),
    },
    daily: list(c.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        copies: count(d.copies),
        copiers: count(d.copiers),
        players: count(d.players),
      })),
    retention: {
      nextDay: { copied: rate(nextDay.copied), other: rate(nextDay.other) },
      week: { copied: rate(week.copied), other: rate(week.other) },
    },
  };
}

function parseSpan(raw: unknown): EstimatesSpan | null {
  const s = obj(raw);
  const from = text(s.from);
  const to = text(s.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    playerDays: count(s.playerDays),
    answers: count(s.answers),
    legends: count(s.legends),
    unattested: count(s.unattested),
    completions: count(s.completions),
    avgScore: maybe(s.avgScore),
    nextDay: rate(s.nextDay),
  };
}

function parseEstimates(raw: unknown): EstimatesReport {
  const e = obj(raw);
  const t = obj(e.totals);
  const compare = obj(e.compare);
  const before = parseSpan(compare.before);
  const after = parseSpan(compare.after);
  const nextDay = obj(obj(e.retention).nextDay);
  return {
    totals: {
      since: text(t.since),
      answers: count(t.answers),
      estimated: count(t.estimated),
      unattested: count(t.unattested),
      measured: count(t.measured),
      players: count(t.players),
      finders: count(t.finders),
      avgScoreEstimated: maybe(t.avgScoreEstimated),
      avgScoreUnattested: maybe(t.avgScoreUnattested),
      avgScoreMeasured: maybe(t.avgScoreMeasured),
      estimatedLegends: count(t.estimatedLegends),
    },
    daily: list(e.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        answers: count(d.answers),
        estimated: count(d.estimated),
        unattested: count(d.unattested),
        players: count(d.players),
        finders: count(d.finders),
      })),
    compare: before && after ? { before, after } : null,
    retention: { nextDay: { found: rate(nextDay.found), other: rate(nextDay.other) } },
  };
}

const REASONS: readonly string[] = ["shared", "default", "split"];

function parseOnboarding(raw: unknown): OnboardingReport {
  const o = obj(raw);
  return {
    since: text(o.since),
    arms: list(o.arms)
      .filter((a) => REASONS.includes(text(a.reason) ?? "") && text(a.mode))
      .map((a) => ({
        reason: a.reason as OnboardingReason,
        mode: a.mode as string,
        players: count(a.players),
        played: count(a.played),
        playedDays: count(a.playedDays),
        avgDaysPlayed: maybe(a.avgDaysPlayed),
        d1: rate(a.d1),
        d7: rate(a.d7),
        week1: rate(a.week1),
        sharers: count(a.sharers),
        shares: count(a.shares),
        switched: count(a.switched),
      })),
    arrivals: list(o.arrivals)
      .filter((a) => text(a.link) && text(a.mode))
      .map((a) => ({ link: a.link as string, mode: a.mode as string, arrivals: count(a.arrivals) })),
  };
}

function parseChat(raw: unknown): ChatReport {
  const c = obj(raw);
  const t = obj(c.totals);
  const time = obj(c.time);
  const room = obj(c.room);
  return {
    totals: {
      opens: count(t.opens),
      viewers: count(t.viewers),
      senders: count(t.senders),
      messages: count(t.messages),
      blocked: count(t.blocked),
      blockedProfane: count(t.blockedProfane),
      blockedRateLimited: count(t.blockedRateLimited),
      viewersToday: count(t.viewersToday),
      sendersToday: count(t.sendersToday),
      messagesToday: count(t.messagesToday),
      viewersLast7: count(t.viewersLast7),
      sendersLast7: count(t.sendersLast7),
      returningViewers: count(t.returningViewers),
      senderShare: maybe(t.senderShare),
      avgOpensPerViewer: maybe(t.avgOpensPerViewer),
      avgMessageLength: maybe(t.avgMessageLength),
      since: text(t.since),
    },
    time: {
      views: count(time.views),
      medianViewMs: maybe(time.medianViewMs),
      avgViewMs: maybe(time.avgViewMs),
      totalMs: maybe(time.totalMs),
      medianSendingViewMs: maybe(time.medianSendingViewMs),
      sendingViewShare: maybe(time.sendingViewShare),
    },
    daily: list(c.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        viewers: count(d.viewers),
        senders: count(d.senders),
        opens: count(d.opens),
        messages: count(d.messages),
        totalMs: count(d.totalMs),
      })),
    room: {
      messages: count(room.messages),
      hidden: count(room.hidden),
      senders: count(room.senders),
      last24h: count(room.last24h),
      lastAt: text(room.lastAt),
    },
  };
}
