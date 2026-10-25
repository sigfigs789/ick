import { parseExperiment, type Experiment } from "./experiment";

/**
 * The /analyticsV2 report: what `analytics_v2` returns (see the 2026-10-30
 * migration, which is where every number is defined), read into types.
 *
 * Two populations run through it. A visitor turned up; a player banked a word.
 * Everything about coming back, how often, and sharing is over players.
 */

/** People, and how many of them did the thing. */
export interface Rate {
  cohort: number;
  returned: number;
}

export interface Day {
  date: string;
  visitors: number;
  newVisitors: number;
  players: number;
  /** Players whose first-ever word was this day. */
  newPlayers: number;
}

export interface Cohort {
  /** The Monday the week starts on. */
  start: string;
  /** Players whose first word was in the week. */
  players: number;
  /** How many of them banked a word in each later week that is over: [0] is the week after. */
  weeks: number[];
}

export interface Week {
  start: string;
  visitors: number;
  players: number;
  newPlayers: number;
  /** Players by how many of the week's days they banked a word on, 1 to 7. */
  daysPlayed: Record<number, number>;
}

export interface Source {
  source: string;
  /** New visitors from it over the last 28 closed days, and the 28 before. */
  recent: number;
  prior: number;
  /** How many of those became players. */
  recentPlayers: number;
  priorPlayers: number;
}

/** Returns from a player's day, next day and within a week. */
export interface Returns extends Rate {
  weekCohort: number;
  weekReturned: number;
}

/** A span of days: the last 28 closed ones, or the reader's range. */
export interface Window {
  visitors: number;
  /** Players whose first-ever word was in it. */
  newPlayers: number;
  firstVisits: number;
  firstVisitStarted: number;
  firstVisitPlayed: number;
  players: number;
  visitorDays: number;
  startedDays: number;
  playerDays: number;
  completedDays: number;
  sharedDays: number;
  completedSharedDays: number;
  sharers: number;
  boardViewers: number;
  boardViewDays: number;
  boardOpens: number;
  referralVisits: number;
  referralNewVisitors: number;
  referralNewPlayers: number;
  afterBoard: { viewed: Rate; notViewed: Rate };
  afterShare: { shared: Returns; notShared: Returns };
}

export interface Tier extends Rate {
  tier: string;
  finished: number;
  shared: number;
}

/** Back on exactly day N; `week` and `month`: back on any of the 7, or 30, days after. */
export type Retention = Record<"d1" | "d7" | "d30" | "week" | "month", { players: Rate; visitors: Rate }>;

/** The window the reader picked, counted the way the last 28 closed days are. */
export interface Range {
  from: string;
  to: string;
  window: Window;
  /** Against the same number of days just before. */
  sources: Source[];
  scores: Scores;
  /**
   * Over the players (or visitors) whose first word (or visit) was in the
   * window and whose day N is over; null from a database that does not count
   * it yet (before the 2026-11-11 migration).
   */
  retention: Retention | null;
  /** The same number of days just before the window; null as for `retention`. */
  prior: { playerDays: number; visitorDays: number } | null;
}

export interface Scores {
  tiers: Tier[];
  buckets: Record<number, number>;
}

export interface Report {
  today: string;
  /** The first day a visit was recorded against a player; visitor numbers before it are not numbers. */
  trackedSince: string | null;
  daily: Day[];
  /** Over the 28 days up to the last one with day N over. */
  retention: Retention;
  cohorts: Cohort[];
  weekly: Week[];
  sources: Source[];
  /** The last 28 closed days, which the scorecard is set against. */
  window: Window;
  scores: Scores;
  /** The reader's window, when one was asked for. */
  range: Range | null;
}

/** The experiments on /experimentsV2 (see experiment.ts); null for one the database sent nothing for. */
export interface Experiments {
  wordOfDay: Experiment | null;
  comeBack: Experiment | null;
  headerCelebrations: Experiment | null;
  shareName: Experiment | null;
  /** Its `shown` arm is the input below the guess log, `hidden` above (see game/inputPlacementTest.ts). */
  inputPlacement: Experiment | null;
  /** The draw days counted, both ends, or null for everyone drawn. */
  span: { from: string; to: string } | null;
}

type Json = Record<string, unknown>;

const obj = (raw: unknown): Json => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Json) : {});
const arr = (raw: unknown): Json[] => (Array.isArray(raw) ? raw.map(obj) : []);
const num = (raw: unknown): number => (typeof raw === "number" && Number.isFinite(raw) ? raw : 0);
const str = (raw: unknown): string | null => (typeof raw === "string" ? raw : null);

function rate(raw: unknown): Rate {
  const r = obj(raw);
  return { cohort: num(r.cohort), returned: num(r.returned) };
}

function returns(raw: unknown): Returns {
  const r = obj(raw);
  return { ...rate(r), weekCohort: num(r.weekCohort), weekReturned: num(r.weekReturned) };
}

function counts(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    if (Number.isInteger(Number(k))) out[Number(k)] = num(v);
  }
  return out;
}

function parseSources(raw: unknown): Source[] {
  return arr(raw)
    .filter((s) => str(s.source))
    .map((s) => ({
      source: s.source as string,
      recent: num(s.recent),
      prior: num(s.prior),
      recentPlayers: num(s.recentPlayers),
      priorPlayers: num(s.priorPlayers),
    }));
}

function parseWindow(raw: unknown): Window {
  const w = obj(raw);
  return {
    visitors: num(w.visitors),
    newPlayers: num(w.newPlayers),
    firstVisits: num(w.firstVisits),
    firstVisitStarted: num(w.firstVisitStarted),
    firstVisitPlayed: num(w.firstVisitPlayed),
    players: num(w.players),
    visitorDays: num(w.visitorDays),
    startedDays: num(w.startedDays),
    playerDays: num(w.playerDays),
    completedDays: num(w.completedDays),
    sharedDays: num(w.sharedDays),
    completedSharedDays: num(w.completedSharedDays),
    sharers: num(w.sharers),
    boardViewers: num(w.boardViewers),
    boardViewDays: num(w.boardViewDays),
    boardOpens: num(w.boardOpens),
    referralVisits: num(w.referralVisits),
    referralNewVisitors: num(w.referralNewVisitors),
    referralNewPlayers: num(w.referralNewPlayers),
    afterBoard: { viewed: rate(obj(w.afterBoard).viewed), notViewed: rate(obj(w.afterBoard).notViewed) },
    afterShare: { shared: returns(obj(w.afterShare).shared), notShared: returns(obj(w.afterShare).notShared) },
  };
}

function parseScores(raw: unknown): Scores {
  const s = obj(raw);
  return {
    tiers: arr(s.tiers)
      .filter((t) => str(t.tier))
      .map((t) => ({ tier: t.tier as string, finished: num(t.finished), shared: num(t.shared), ...rate(t) })),
    buckets: counts(s.buckets),
  };
}

function parseRetention(raw: unknown): Retention {
  const r = obj(raw);
  const one = (key: string) => ({ players: rate(obj(r[key]).players), visitors: rate(obj(r[key]).visitors) });
  return { d1: one("d1"), d7: one("d7"), d30: one("d30"), week: one("week"), month: one("month") };
}

function parseRange(raw: unknown): Range | null {
  const r = obj(raw);
  const from = str(r.from);
  const to = str(r.to);
  if (from === null || to === null) return null;
  const prior = r.prior === undefined || r.prior === null ? null : obj(r.prior);
  return {
    from,
    to,
    window: parseWindow(r.window),
    sources: parseSources(r.sources),
    scores: parseScores(r.scores),
    retention: r.retention === undefined || r.retention === null ? null : parseRetention(r.retention),
    prior: prior && { playerDays: num(prior.playerDays), visitorDays: num(prior.visitorDays) },
  };
}

/** The report as typed values; anything the database left out reads as zero rather than taking the page down. */
export function parseReport(raw: unknown): Report {
  const r = obj(raw);
  return {
    today: str(r.today) ?? "",
    trackedSince: str(r.trackedSince),
    daily: arr(r.daily)
      .filter((d) => str(d.date))
      .map((d) => ({
        date: d.date as string,
        visitors: num(d.visitors),
        newVisitors: num(d.newVisitors),
        players: num(d.players),
        newPlayers: num(d.newPlayers),
      })),
    retention: parseRetention(r.retention),
    cohorts: arr(r.cohorts)
      .filter((c) => str(c.start))
      .map((c) => ({
        start: c.start as string,
        players: num(c.players),
        weeks: Array.isArray(c.weeks) ? c.weeks.map(num) : [],
      })),
    weekly: arr(r.weekly)
      .filter((x) => str(x.start))
      .map((x) => ({
        start: x.start as string,
        visitors: num(x.visitors),
        players: num(x.players),
        newPlayers: num(x.newPlayers),
        daysPlayed: counts(x.daysPlayed),
      })),
    sources: parseSources(r.sources),
    window: parseWindow(r.window),
    scores: parseScores(r.scores),
    range: parseRange(r.range),
  };
}

/** How long one try may take, the download included: a weak connection is slow, not broken. */
const TRY_MS = 30_000;

/**
 * One read of the report, tried twice before it counts as failed.
 *
 * The second try is the one a reader on a weak connection was pressing "Try
 * again" for, and it is usually quick: the first warmed the CDN's copy (see
 * ANALYTICS_V2_CACHE in api/review.ts). No `cache: "no-store"`, which would
 * skip that copy; the response's `max-age=0` already keeps the browser asking.
 */
async function readReport(url: string): Promise<Json> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TRY_MS) });
      if (!response.ok) throw new Error(`analytics-v2 ${response.status}`);
      return (await response.json()) as Json;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** The report for the puzzle the reader is on, with `range` counted over their window when one is given. */
export async function fetchReport(today: string, span?: { from: string; to: string }): Promise<Report> {
  const query = span ? `&from=${span.from}&to=${span.to}` : "";
  const body = await readReport(`/api/review?list=analytics-v2&today=${today}${query}`);
  return parseReport(body.report);
}

/** The experiments, counted up to the puzzle the reader is on, over the players drawn in `span` when one is given. */
export async function fetchExperiments(today: string, span?: { from: string; to: string }): Promise<Experiments> {
  const query = span ? `&from=${span.from}&to=${span.to}` : "";
  const body = await readReport(`/api/review?list=experiments-v2&today=${today}${query}`);
  return {
    wordOfDay: parseExperiment(body.wordOfDay),
    comeBack: parseExperiment(body.comeBack),
    headerCelebrations: parseExperiment(body.headerCelebrations),
    shareName: parseExperiment(body.shareName),
    inputPlacement: parseExperiment(body.inputPlacement),
    span: span ?? null,
  };
}
