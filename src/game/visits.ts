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
  /** First-touch: the origin the player *originally* arrived from (sticky). */
  source: string | null;
  /** Last-touch: the most recent identifiable origin, holding its previous
   * value across return visits that carry no new signal (direct/refresh). */
  lastSource: string | null;
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

/** The referring URL for this load, or "" when unavailable (e.g. tests, SSR). */
function safeReferrer(): string {
  try {
    return document.referrer;
  } catch {
    return "";
  }
}

/** This site's own hostname, used to treat internal navigations as direct. */
function safeSelfHost(): string {
  try {
    return location.hostname;
  } catch {
    return "";
  }
}

/**
 * Classifies the referring site into a coarse traffic source so organic
 * arrivals (with no `s=X` code) are still attributed. Returns null for direct
 * navigation, same-site hops, and malformed referrers.
 */
function referrerSource(referrer: string, selfHost: string): string | null {
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === selfHost) return null;
  if (host.includes("reddit")) return "reddit";
  if (host.includes("google")) return "google";
  if (host === "t.co" || host.includes("twitter") || host === "x.com" || host.endsWith(".x.com")) return "twitter";
  if (host.includes("facebook") || host.includes("fb.")) return "facebook";
  if (host.includes("bing")) return "bing";
  if (host.includes("duckduckgo")) return "duckduckgo";
  // Unknown site: keep the bare host so it stays distinguishable from direct.
  const cleaned = host.replace(/^www\./, "").slice(0, 40);
  return /^[a-z0-9.-]+$/.test(cleaned) ? cleaned : null;
}

/** Normalizes a raw campaign token into a safe, bounded analytics dimension. */
function sanitizeSource(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().slice(0, 32);
  return /^[a-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

/**
 * Determines where this visit came from, in priority order: our compact `s=X`
 * campaign code, then a standard `utm_source`, then the referring site — so
 * organic Reddit/Google/etc. traffic is attributed instead of "direct".
 */
export function arrivalSource(
  search: string,
  referrer: string = safeReferrer(),
  selfHost: string = safeSelfHost()
): string | null {
  const params = new URLSearchParams(search);
  return (
    sanitizeSource(params.get("s")) ??
    sanitizeSource(params.get("utm_source")) ??
    referrerSource(referrer, selfHost)
  );
}

/**
 * Records that the app was opened. Returns the visit outcome for the *first*
 * page load of a session, or `null` on later reloads in the same session (so
 * callers fire a visit event exactly once per session). First-touch `source`
 * is sticky; last-touch `lastSource` tracks the most recent identifiable
 * origin and holds its previous value when a return carries no new signal.
 */
export function recordVisit(
  search: string,
  today: string = todayDateString(),
  referrer: string = safeReferrer(),
  selfHost: string = safeSelfHost()
): VisitOutcome | null {
  if (safeGet(sessionStorage, VISIT_SESSION_KEY)) return null;

  const source = arrivalSource(search, referrer, selfHost);
  const existing = loadState();

  let outcome: VisitOutcome;
  if (!existing) {
    const state: VisitState = {
      source,
      lastSource: source,
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
      lastSource: source ?? existing.lastSource ?? null,
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

/**
 * The player's persisted visit state, or `null` before any visit is recorded.
 * Lets non-visit events (like sharing) attach the player's original arrival
 * source and return counts so those actions can be sliced by cohort.
 */
export function currentVisit(): VisitState | null {
  return loadState();
}
