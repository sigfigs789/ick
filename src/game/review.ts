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
export function keyQuery(): string {
  const key = reviewKey();
  return key ? `?key=${encodeURIComponent(key)}` : "";
}

async function read<T>(
  list: "suggested-words" | "my-suggestions" | "feedback" | "freeform" | "analytics",
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

/** One of a player's own suggestions, and the mark it wears on the queue. */
export interface PlayerSuggestion {
  word: string;
  /** When it was first suggested, as an ISO timestamp. */
  at: string;
  mark: Mark;
}

/** The words `player` has suggested, newest first. */
export function fetchPlayerSuggestions(player: string): Promise<PlayerSuggestion[]> {
  return read(
    "my-suggestions",
    (body) => parsePlayerSuggestions(body.suggestions),
    `&player=${encodeURIComponent(player)}`,
  );
}

function parsePlayerSuggestions(raw: unknown): PlayerSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const rows: PlayerSuggestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.word !== "string" || row.word === "" || typeof row.at !== "string") continue;
    const mark = row.mark === "accepted" || row.mark === "rejected" ? row.mark : null;
    rows.push({ word: row.word, at: row.at, mark });
  }
  return rows;
}

/** Every note players have left, newest first. */
export function fetchFeedback(): Promise<FeedbackNote[]> {
  return read("feedback", (body) => parseFeedback(body.feedback));
}

/** The Freeform week trial: where the vote stands, and what people wrote. */
export function fetchFreeform(): Promise<FreeformVerdict> {
  return read("freeform", parseFreeform);
}

/**
 * How the game is doing, over the window `from` to `to`, both ends counted. A
 * null `from` is all time. `today` is the puzzle the viewer is on, which is
 * what closes a player's seven days.
 */
export function fetchAnalytics(from: string | null, to: string, today: string): Promise<AnalyticsReport> {
  const window = `${from ? `&from=${from}` : ""}&to=${to}&today=${today}`;
  return read("analytics", (body) => parseAnalytics(body.report), window);
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

/** Who a row of the report is about. */
export const GROUPS = ["all", "new", "returning"] as const;
export type Group = (typeof GROUPS)[number];

/**
 * Returns within a wait (seven days, or the next day): `rate` over the players
 * whose wait is over, and `soFar`, every return seen yet, for a window too
 * recent to have a rate.
 */
export interface Returns {
  rate: Rate;
  soFar: number;
  /**
   * The players who banked a word: those whose wait is over and how many
   * of them came back, and `soFar`, every guesser seen back yet.
   */
  guessers: Rate & { soFar: number };
}

/** The modes a player was in over the window: one of them, or both. */
export const PUZZLE_TYPES = ["standard", "freeform", "both"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** The key numbers for one set of players over the window. */
export interface KeyMetrics {
  players: number;
  acted: number;
  guessed: number;
  /** Shared their result on a day in the window (only possible once they have guessed). */
  shared: number;
  /** Finished a puzzle on a day in the window: used every guess or locked in (only a guesser can). */
  completed: number;
  returned: Returns;
  /** Played again on the very next puzzle, read like `returned` with a one-day wait. */
  nextDay: Returns;
}

/**
 * The key numbers for one puzzle. `returned` is a floor until the day is
 * `closed`, and `nextDay` until the puzzle after it is over.
 */
export interface DayMetrics {
  players: number;
  acted: number;
  guessed: number;
  shared: number;
  completed: number;
  returned: number;
  nextDay: number;
}

/**
 * The analytics page's one document, as `analytics_overview` builds it (see the
 * 2026-10-18 migration, which is where every one of these numbers is defined).
 */
export interface AnalyticsReport {
  /** The puzzle that closes the seven-day returns. */
  today: string | null;
  /** The first day anybody turned up. */
  firstDay: string | null;
  from: string | null;
  to: string | null;
  groups: Record<Group, KeyMetrics>;
  /**
   * Each grouping, split by the puzzle types the player was in over the
   * window: one of them, or both (see the 2026-10-28 migrations).
   */
  modes: Record<Group, Record<PuzzleType, KeyMetrics>>;
  /** Each grouping, split by whether the player opened the chat in the window. */
  chat: Record<Group, { opened: KeyMetrics; notOpened: KeyMetrics }>;
  chatSince: string | null;
  /**
   * The idle hint test: each grouping, split by arm, over the players who sat
   * idle long enough to be hinted in the window. New and returning are the
   * test's own two experiments (see game/idleHint.ts).
   */
  idleHint: Record<Group, Record<IdleHintVariant, KeyMetrics>>;
  /** The first day anybody was triggered. */
  idleHintSince: string | null;
  /**
   * Players dropped from every number above as automated, by the day of their
   * first visit: a same-second twin that never did anything, or a visit that
   * said it was a bot (see the analytics_filter_bots migration).
   */
  botsFiltered: number;
  daily: Array<{ date: string; closed: boolean; groups: Record<Group, DayMetrics> }>;
  /**
   * Weekly active and playing players, newest week first: Monday to Sunday,
   * the latest the week `today` is in, up to 13 weeks whatever the window (see
   * the 2026-10-27, 2026-10-30 and 2026-11-07 migrations). New is a player whose
   * first-ever day is in the week.
   */
  weekly: WeekActives[];
  /**
   * Retention by the week players arrived, newest first, up to 13 weeks (see
   * the 2026-10-29 migration).
   */
  cohorts: Cohort[];
  /** The window's new players by where their first visit came from, most first. */
  sources: SourceRow[];
  /** Muse AI, which every number above leaves out (see game/visitor.ts). */
  muse: MuseReport;
}

/** One week's active players: the ones who turned up on any of its puzzles. */
export interface WeekActives {
  start: string;
  end: string;
  players: Record<Group, number>;
  /** The week's playing players: the ones who banked a word in any of its puzzles. */
  playing: Record<Group, number>;
  /**
   * Where the week's players came from: new (first-ever day that week), kept
   * (played the week before too) or resurrected (played before, but not the
   * week before). Lost is the week before's players who did not turn up.
   */
  flow: { new: number; kept: number; resurrected: number; resurrectedStayed: number; lost: number };
  /** Whether the week after is over, so `resurrectedStayed` is final. */
  nextWeekOver: boolean;
  /** Players by how many of the week's puzzles they banked a word in. */
  played: { oneDay: number; twoToThree: number; fourPlus: number };
}

/**
 * The players whose first-ever day fell in the week starting `start`, and how
 * many of them turned up in each later week: `weeks[0]` is the week after, and
 * the last one is still counting up. `guessers` is the same for the ones who
 * banked a word in their first week.
 */
export interface Cohort {
  start: string;
  players: number;
  guessers: number;
  weeks: Array<{ players: number; guessers: number }>;
}

/** New players from one first-touch source (see game/visits.ts). */
export interface SourceRow {
  source: string;
  players: number;
  guessed: number;
  returned: { rate: Rate; soFar: number };
}

/** How Muse AI played in the window, by puzzle. Averages are null with no puzzles. */
export interface MuseNumbers {
  /** Times it opened the game. */
  visits: number;
  /** Puzzles it banked at least one word in. */
  puzzles: number;
  avgScore: number | null;
  avgWords: number | null;
  /** Tries turned away, per puzzle played. */
  avgRejected: number | null;
  /** Messages it wrote in the chat. */
  messages: number;
}

export interface MuseReport extends MuseNumbers {
  /** Distinct browsers it played from. */
  browsers: number;
  /** Puzzles it opened the chat on. */
  chatDays: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Newest puzzle first. */
  days: Array<MuseNumbers & { date: string; chatOpened: boolean }>;
  /** Each browser it played from in the window, most recently seen first. */
  bots: MuseBot[];
}

/** One Muse browser: its board identity and how it played in the window. */
export interface MuseBot extends MuseNumbers {
  /** The leaderboard id; the board's name for it is `handleFor(playerId)`. */
  playerId: string;
  chatDays: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export const IDLE_HINT_VARIANTS = ["control", "treatment"] as const;
export type IdleHintVariant = (typeof IDLE_HINT_VARIANTS)[number];

type Json = Record<string, unknown>;

function obj(raw: unknown): Json {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Json) : {};
}

function list(raw: unknown): Json[] {
  return Array.isArray(raw) ? raw.map(obj) : [];
}

function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

function average(raw: unknown): number | null {
  // Postgres numerics arrive as numbers; a string is read too, in case one
  // ever comes back quoted.
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function museNumbers(m: Json): MuseNumbers {
  return {
    visits: count(m.visits),
    puzzles: count(m.puzzles),
    avgScore: average(m.avgScore),
    avgWords: average(m.avgWords),
    avgRejected: average(m.avgRejected),
    messages: count(m.messages),
  };
}

function muse(raw: unknown): MuseReport {
  const m = obj(raw);
  return {
    ...museNumbers(m),
    browsers: count(m.browsers),
    chatDays: count(m.chatDays),
    firstSeen: text(m.firstSeen),
    lastSeen: text(m.lastSeen),
    days: list(m.days)
      .filter((d) => text(d.date))
      .map((d) => ({ ...museNumbers(d), date: d.date as string, chatOpened: d.chatOpened === true })),
    bots: list(m.bots)
      .filter((b) => text(b.playerId))
      .map((b) => ({
        ...museNumbers(b),
        playerId: b.playerId as string,
        chatDays: count(b.chatDays),
        firstSeen: text(b.firstSeen),
        lastSeen: text(b.lastSeen),
      })),
  };
}

function returns(raw: unknown): Returns {
  const r = obj(raw);
  const g = obj(r.guessers);
  return {
    rate: { cohort: count(r.cohort), returned: count(r.returned) },
    soFar: count(r.soFar),
    guessers: { cohort: count(g.cohort), returned: count(g.returned), soFar: count(g.soFar) },
  };
}

function metrics(raw: unknown): KeyMetrics {
  const m = obj(raw);
  return {
    players: count(m.players),
    acted: count(m.acted),
    guessed: count(m.guessed),
    shared: count(m.shared),
    completed: count(m.completed),
    returned: returns(m.returned),
    nextDay: returns(m.nextDay),
  };
}

function byGroup<T>(raw: unknown, read: (raw: unknown) => T): Record<Group, T> {
  const r = obj(raw);
  return Object.fromEntries(GROUPS.map((g) => [g, read(r[g])])) as Record<Group, T>;
}

/**
 * The report as a typed value, every part of it optional in the reading: a
 * part the database left out renders as zeros rather than taking the page down.
 */
export function parseAnalytics(raw: unknown): AnalyticsReport {
  const r = obj(raw);
  return {
    today: text(r.today),
    firstDay: text(r.firstDay),
    from: text(r.from),
    to: text(r.to),
    groups: byGroup(r.groups, metrics),
    modes: byGroup(r.modes, (raw) => {
      const m = obj(raw);
      return Object.fromEntries(PUZZLE_TYPES.map((t) => [t, metrics(m[t])])) as Record<PuzzleType, KeyMetrics>;
    }),
    chat: byGroup(r.chat, (raw) => ({ opened: metrics(obj(raw).opened), notOpened: metrics(obj(raw).notOpened) })),
    chatSince: text(r.chatSince),
    idleHint: byGroup(r.idleHint, (raw) => ({
      control: metrics(obj(raw).control),
      treatment: metrics(obj(raw).treatment),
    })),
    idleHintSince: text(r.idleHintSince),
    botsFiltered: count(r.botsFiltered),
    daily: list(r.daily)
      .filter((d) => text(d.date))
      .map((d) => ({
        date: d.date as string,
        closed: d.closed === true,
        groups: byGroup(d.groups, (raw) => {
          const m = obj(raw);
          return {
            players: count(m.players),
            acted: count(m.acted),
            guessed: count(m.guessed),
            shared: count(m.shared),
            completed: count(m.completed),
            returned: count(m.returned),
            nextDay: count(m.nextDay),
          };
        }),
      })),
    weekly: list(r.weekly)
      .filter((w) => text(w.start) && text(w.end))
      .map((w) => ({
        start: w.start as string,
        end: w.end as string,
        players: byGroup(w.groups, count),
        playing: byGroup(w.playing, count),
        flow: {
          new: count(obj(w.flow).new),
          kept: count(obj(w.flow).kept),
          resurrected: count(obj(w.flow).resurrected),
          resurrectedStayed: count(obj(w.flow).resurrectedStayed),
          lost: count(obj(w.flow).lost),
        },
        nextWeekOver: w.nextWeekOver === true,
        played: {
          oneDay: count(obj(w.played).oneDay),
          twoToThree: count(obj(w.played).twoToThree),
          fourPlus: count(obj(w.played).fourPlus),
        },
      })),
    cohorts: list(r.cohorts)
      .filter((c) => text(c.start))
      .map((c) => ({
        start: c.start as string,
        players: count(c.players),
        guessers: count(c.guessers),
        weeks: list(c.weeks).map((w) => ({ players: count(w.players), guessers: count(w.guessers) })),
      })),
    sources: list(r.sources)
      .filter((s) => text(s.source))
      .map((s) => {
        const ret = obj(s.returned);
        return {
          source: s.source as string,
          players: count(s.players),
          guessed: count(s.guessed),
          returned: { rate: { cohort: count(ret.cohort), returned: count(ret.returned) }, soFar: count(ret.soFar) },
        };
      }),
    muse: muse(r.muse),
  };
}
