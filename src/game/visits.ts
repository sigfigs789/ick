import { todayDateString } from "./date";

/**
 * Tracks whether a player is a first-timer or a returning visitor, where they
 * originally arrived from, and how engaged they are, using only local storage.
 *
 * Two counters are kept:
 *   - `timesReturned` counts distinct return *sessions* (a page reload within
 *     the same tab does not count; closing and reopening does).
 *   - `daysReturned` counts return *days* and advances at most once per calendar
 *     day, so many visits in one day still only add one.
 *
 * `sessionStorage` flags dedupe within a single browsing session so neither the
 * return count nor the analytics events double-fire on a refresh.
 */

const VISITS_KEY = "ick:visits";
// Holds this session's VisitOutcome as JSON, so both the visit and the later
// engagement event report identical params, and reloads don't recount.
const VISIT_SESSION_KEY = "ick:visit-counted";
const ENGAGED_SESSION_KEY = "ick:visit-engaged";

export interface VisitState {
  /** The `s=X` code the player first arrived with, e.g. "sh", "t", "reddit". */
  source: string | null;
  firstVisitDate: string;
  lastVisitDate: string;
  /** Distinct return sessions after the very first visit. */
  timesReturned: number;
  /** Distinct calendar days visited after the first, one per day at most. */
  daysReturned: number;
}

export interface VisitOutcome {
  state: VisitState;
  isFirstVisit: boolean;
  /** True when this visit falls on a different calendar day than the last. */
  isNewDay: boolean;
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Private-browsing or disabled storage: analytics is best-effort and must
    // never break the game, so silently skip persistence.
  }
}

function loadState(): VisitState | null {
  const raw = safeGet(localStorage, VISITS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VisitState;
  } catch {
    return null;
  }
}

function saveState(state: VisitState): void {
  safeSet(localStorage, VISITS_KEY, JSON.stringify(state));
}

/** Reads and sanitizes the `s=X` arrival code into a safe analytics dimension. */
export function arrivalSource(search: string): string | null {
  const code = new URLSearchParams(search).get("s");
  if (!code) return null;
  const cleaned = code.trim().toLowerCase().slice(0, 32);
  return /^[a-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

/**
 * Records that the app was opened. Returns the visit outcome for the *first*
 * page load of a session, or `null` on later reloads in the same session (so
 * callers fire a visit event exactly once per session). The original arrival
 * source is sticky — a later visit without `s=X` never overwrites it.
 */
export function recordVisit(search: string, today: string = todayDateString()): VisitOutcome | null {
  if (safeGet(sessionStorage, VISIT_SESSION_KEY)) return null;

  const source = arrivalSource(search);
  const existing = loadState();

  let outcome: VisitOutcome;
  if (!existing) {
    const state: VisitState = {
      source,
      firstVisitDate: today,
      lastVisitDate: today,
      timesReturned: 0,
      daysReturned: 0,
    };
    outcome = { state, isFirstVisit: true, isNewDay: true };
  } else {
    const isNewDay = existing.lastVisitDate !== today;
    const state: VisitState = {
      source: existing.source ?? source,
      firstVisitDate: existing.firstVisitDate,
      lastVisitDate: today,
      timesReturned: existing.timesReturned + 1,
      daysReturned: existing.daysReturned + (isNewDay ? 1 : 0),
    };
    outcome = { state, isFirstVisit: false, isNewDay };
  }

  saveState(outcome.state);
  safeSet(sessionStorage, VISIT_SESSION_KEY, JSON.stringify(outcome));
  return outcome;
}

/**
 * Marks that the player actually engaged this session (submitted an answer)
 * rather than just opening and closing. Returns this session's visit outcome
 * the first time it's called so the caller can fire an engagement event with
 * the same params as the visit, or `null` on later submissions in the session
 * (or if no visit was recorded first).
 */
export function markSessionEngaged(): VisitOutcome | null {
  if (safeGet(sessionStorage, ENGAGED_SESSION_KEY)) return null;
  const raw = safeGet(sessionStorage, VISIT_SESSION_KEY);
  if (!raw) return null;
  safeSet(sessionStorage, ENGAGED_SESSION_KEY, "1");
  try {
    return JSON.parse(raw) as VisitOutcome;
  } catch {
    return null;
  }
}
