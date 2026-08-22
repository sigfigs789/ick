/**
 * Measures how long a player actually spends on the site, and how much of that
 * time falls after their first guess.
 *
 * Time is counted while the page is *visible*, not from open to close: a tab
 * left behind a lock screen or another app all afternoon is not somebody
 * playing, and wall-clock alone would report it as a two-hour session. The
 * wall-clock span is still reported alongside it (`total_ms`) so the two can be
 * compared, but `visible_ms` is the number that means "time spent".
 *
 * The end of a session is not an event a browser reliably gives us -- there is
 * no close hook that fires everywhere, and on mobile a tab is usually
 * backgrounded rather than closed. So every hide is treated as a possible end
 * and reported: each report carries the cumulative totals *and* the segment
 * since the last one, so a session that resumes and hides again is not counted
 * twice. Per session id, `max(visible_ms)` is the session's length and
 * `sum(segment_ms)` reaches the same number.
 *
 * All of this lives in `sessionStorage`, so it is per-tab, cleared when the
 * browsing session ends, and survives a reload -- the same store the visit
 * dedupe flags use (see visits.ts).
 */

const SESSION_KEY = "ick:session-time";

/** Ignore a segment shorter than this: a hide/show flicker is not time spent. */
const MIN_SEGMENT_MS = 1000;
/**
 * A clamp on a single visible stretch, for the cases where a browser simply
 * never tells us the page went away (a suspended tab, a machine that slept).
 * Half an hour of uninterrupted visible time is already far past any real
 * session of a one-drop word game, so counting past it only adds noise.
 */
const MAX_SEGMENT_MS = 30 * 60 * 1000;

interface SessionTimeState {
  /** Groups this tab's reports together; not tied to any player identity. */
  id: string;
  /** Wall-clock start of the session, for the open-to-close span. */
  startedAt: number;
  /** Visible time banked from stretches that have already ended. */
  visibleMs: number;
  /** When the current visible stretch began, or null while hidden. */
  resumedAt: number | null;
  /** Visible time at the moment of the first guess, or null before one. */
  firstGuessVisibleMs: number | null;
  /** Visible time at the most recent guess; moves with every submission. */
  lastGuessVisibleMs: number | null;
  /** Submissions made this session, accepted or not. */
  guesses: number;
  /** Visible time at the first share of the session, or null if none. */
  shareVisibleMs: number | null;
  /** Visible time already reported, so each report's segment is the new part. */
  reportedVisibleMs: number;
  /** How many reports this session has already sent. */
  reports: number;
}

/** One session-length report, as the analytics layer sends it. */
export interface SessionTimeReport {
  sessionId: string;
  /** Visible time from the first page load of the session until now. */
  visibleMs: number;
  /** Wall-clock time from the first page load until now, hidden time included. */
  totalMs: number;
  /** Visible time accrued since the previous report. */
  segmentMs: number;
  /** Visible time before the first guess, or null if the player never guessed. */
  timeToFirstGuessMs: number | null;
  /** Visible time from the first guess to now, or null if there was no guess. */
  fromFirstGuessMs: number | null;
  /** Visible time before the most recent guess, or null if the player never guessed. */
  timeToLastGuessMs: number | null;
  /** Submissions made this session, accepted or not. */
  guessCount: number;
  /** Visible time before the first share, or null if the player never shared. */
  timeToShareMs: number | null;
  shared: boolean;
  guessed: boolean;
  /** 1 for the first report of a session, 2 for the next, and so on. */
  reportNumber: number;
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private browsing or disabled storage: timing is best-effort and must never
    // break the game, so the session simply goes unmeasured.
  }
}

function loadState(): SessionTimeState | null {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as SessionTimeState;
    return typeof state?.id === "string" && typeof state.startedAt === "number" ? state : null;
  } catch {
    return null;
  }
}

function saveState(state: SessionTimeState): void {
  safeSet(SESSION_KEY, JSON.stringify(state));
}

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the arithmetic id below.
  }
  return `s-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Visible time as of `now`, including the stretch currently in progress. */
function visibleAt(state: SessionTimeState, now: number): number {
  if (state.resumedAt === null) return state.visibleMs;
  const open = Math.min(Math.max(now - state.resumedAt, 0), MAX_SEGMENT_MS);
  return state.visibleMs + open;
}

/**
 * Start timing this browsing session, or pick up the existing one on a reload.
 * Safe to call on every page load; only the first load of a session creates the
 * record, so a refresh does not restart the clock.
 */
export function beginSession(now: number = Date.now()): void {
  const existing = loadState();
  if (existing) {
    // A reload lands here mid-session. Whatever stretch was open ended when the
    // old document went away, so start a fresh one from this load.
    saveState({ ...existing, visibleMs: visibleAt(existing, now), resumedAt: now });
    return;
  }
  saveState({
    id: newSessionId(),
    startedAt: now,
    visibleMs: 0,
    resumedAt: now,
    firstGuessVisibleMs: null,
    lastGuessVisibleMs: null,
    guesses: 0,
    shareVisibleMs: null,
    reportedVisibleMs: 0,
    reports: 0,
  });
}

/** Resume counting after the page comes back into view. */
export function resumeSession(now: number = Date.now()): void {
  const state = loadState();
  if (!state || state.resumedAt !== null) return;
  saveState({ ...state, resumedAt: now });
}

/**
 * Record a guess at the visible time it happened. The first one is sticky and
 * splits the session into "deciding whether to play" and "playing"; every one
 * after it moves the last-guess mark, which is where play effectively ends --
 * the gap between that and the end of the session is the tail spent reading
 * results, sharing, or simply leaving the tab open.
 */
export function markGuess(now: number = Date.now()): void {
  const state = loadState();
  if (!state) return;
  const visibleMs = visibleAt(state, now);
  saveState({
    ...state,
    firstGuessVisibleMs: state.firstGuessVisibleMs ?? visibleMs,
    lastGuessVisibleMs: visibleMs,
    guesses: (state.guesses ?? 0) + 1,
  });
}

/**
 * Record the player's first share of the session. Only the first: a player who
 * copies the result and then posts it to X has shared once, at the moment they
 * decided to, and that decision is what the timing is measuring.
 */
export function markShare(now: number = Date.now()): void {
  const state = loadState();
  if (!state || state.shareVisibleMs !== null) return;
  saveState({ ...state, shareVisibleMs: visibleAt(state, now) });
}

/**
 * Close the current visible stretch and return what to report, or null when
 * there is nothing worth sending (no session, or less than a second of new time
 * since the last report). Called when the page hides or unloads.
 */
export function endSessionSegment(now: number = Date.now()): SessionTimeReport | null {
  const state = loadState();
  if (!state) return null;

  const visibleMs = visibleAt(state, now);
  const segmentMs = visibleMs - state.reportedVisibleMs;
  const paused: SessionTimeState = { ...state, visibleMs, resumedAt: null };

  if (segmentMs < MIN_SEGMENT_MS) {
    // Still bank the time -- it counts towards the next report, it just isn't
    // worth an event of its own.
    saveState(paused);
    return null;
  }

  saveState({ ...paused, reportedVisibleMs: visibleMs, reports: state.reports + 1 });

  const firstGuess = state.firstGuessVisibleMs;
  const lastGuess = state.lastGuessVisibleMs;
  const share = state.shareVisibleMs;
  return {
    sessionId: state.id,
    visibleMs: Math.round(visibleMs),
    totalMs: Math.round(Math.max(now - state.startedAt, visibleMs)),
    segmentMs: Math.round(segmentMs),
    timeToFirstGuessMs: firstGuess === null ? null : Math.round(firstGuess),
    fromFirstGuessMs: firstGuess === null ? null : Math.round(Math.max(visibleMs - firstGuess, 0)),
    timeToLastGuessMs: lastGuess === null ? null : Math.round(lastGuess),
    guessCount: state.guesses ?? 0,
    timeToShareMs: share === null ? null : Math.round(share),
    shared: share !== null,
    guessed: firstGuess !== null,
    reportNumber: state.reports + 1,
  };
}
