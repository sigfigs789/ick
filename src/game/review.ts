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
export function fetchAnalytics(days: number): Promise<AnalyticsReport> {
  return read("analytics", (body) => parseAnalytics(body.report), `&days=${days}`);
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
  windowDays: number;
  totals: {
    players: number;
    plays: number;
    today: number;
    last7: number;
    last30: number;
    avgDaysPerPlayer: number | null;
    firstDay: string | null;
  };
  daily: Array<{
    date: string;
    players: number;
    newPlayers: number;
    standard: number;
    freeform: number;
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
    firstVisits: number;
    engaged: number;
    completed: number;
    won: number;
    shared: number;
    sharedOnX: number;
    toFreeform: number;
    toStandard: number;
  };
  sources: Array<{ source: string; visits: number; firstVisits: number; engaged: number }>;
  sessions: {
    sessions: number;
    medianVisibleMs: number | null;
    medianPlayingMs: number | null;
    medianFirstGuessMs: number | null;
    guessedShare: number | null;
  };
  /** Visits by hour of day, Mountain Time. */
  hours: Array<{ hour: number; visits: number }>;
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
  const retention = obj(r.retention);
  const funnel = obj(r.funnel);
  const sessions = obj(r.sessions);
  return {
    asOf: text(r.asOf),
    windowDays: count(r.windowDays),
    totals: {
      players: count(totals.players),
      plays: count(totals.plays),
      today: count(totals.today),
      last7: count(totals.last7),
      last30: count(totals.last30),
      avgDaysPerPlayer: maybe(totals.avgDaysPerPlayer),
      firstDay: text(totals.firstDay),
    },
    daily: list(r.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        players: count(d.players),
        newPlayers: count(d.newPlayers),
        standard: count(d.standard),
        freeform: count(d.freeform),
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
      firstVisits: count(funnel.firstVisits),
      engaged: count(funnel.engaged),
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
      firstVisits: count(s.firstVisits),
      engaged: count(s.engaged),
    })),
    sessions: {
      sessions: count(sessions.sessions),
      medianVisibleMs: maybe(sessions.medianVisibleMs),
      medianPlayingMs: maybe(sessions.medianPlayingMs),
      medianFirstGuessMs: maybe(sessions.medianFirstGuessMs),
      guessedShare: maybe(sessions.guessedShare),
    },
    hours: list(r.hours).map((h) => ({ hour: count(h.hour), visits: count(h.visits) })),
  };
}
