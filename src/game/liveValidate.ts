// Client for /api/validate -- the live dictionary fallback consulted when a
// submission clears every offline check but simply isn't in the curated list.
// The endpoint asks Merriam-Webster first and Wordnik only when MW has no entry;
// this module doesn't care which answered beyond reporting it as `source`.
//
// Two rules shape this module:
//   1. It only runs for players with a connection (`navigator.onLine`).
//   2. It never makes the player wait more than `LIVE_HANDOFF_MS`. Past that the
//      rejection is shown and the request is *not* cancelled -- it keeps going,
//      and whatever it finds is still reported (and still counted, see
//      useDailyPuzzle).

import { todayDateString } from "./date";
import type { RejectionReason } from "./types";

/**
 * How long a player waits for a live verdict before the rejection is shown.
 * Almost every real lookup lands far inside this (a warm CDN hit is instant, a
 * cold MW + Datamuse round-trip measured ~300ms), so the budget only bites on a
 * slow connection -- and because the player is told a check is running from the
 * moment it starts, a longer wait reads as progress rather than a hang.
 */
export const LIVE_HANDOFF_MS = 5000;

/** Hard ceiling on a single lookup, so a wedged request can't leak forever. */
const LIVE_ABORT_MS = 15000;

/** Words worth spending quota on: the game's own input rule. */
const ELIGIBLE_RE = /^[a-z]{2,30}$/;

/**
 * Failure reasons that will not fix themselves: the daily quota is spent, a key
 * is wrong, or none is configured. Once one of these comes back there is no
 * point asking again this session -- every further lookup would just be a
 * guaranteed-failing round-trip (and, for a quota error, more requests against
 * an allowance that is already gone).
 */
const PERMANENT_FAILURES = new Set(["quota-exceeded", "invalid-key", "unconfigured", "forbidden"]);

/**
 * The most lookups one browser may trigger in a day. MW's non-commercial
 * allowance is 1,000 requests per reference per day for the whole game, so no
 * single player gets to spend more than a small slice of it: 50 caps one browser
 * at 5%, while still being far more than a real session of six guesses a day
 * could use.
 *
 * This is a client-side budget, so it deters ordinary over-use rather than
 * enforcing anything -- clearing site data resets it. A hard limit would need
 * per-IP state on the server, which this deployment has nowhere to keep.
 */
export const LIVE_DAILY_LOOKUP_CAP = 50;

const DISABLED_KEY = "ick:live-check-disabled";
const COUNT_KEY = "ick:live-check-count";
const REPORTED_KEY = "ick:live-check-reported";

/**
 * Fallback for when sessionStorage is unavailable (Safari private mode throws on
 * access). Module-scoped, so it lasts as long as the page does.
 */
let disabledInMemory: string | null = null;

/** Stop trying for the rest of this session, remembering why. */
function disableForSession(reason: string): void {
  disabledInMemory = reason;
  try {
    sessionStorage.setItem(DISABLED_KEY, reason);
  } catch {
    // In-memory flag already set; nothing more to do.
  }
}

/** The reason live checks are switched off this session, if they are. */
function disabledReason(): string | null {
  if (disabledInMemory) return disabledInMemory;
  try {
    return sessionStorage.getItem(DISABLED_KEY);
  } catch {
    return null;
  }
}

/**
 * How many lookups this browser has already spent today. Keyed by date so the
 * budget refills when MW's own daily allowance does.
 */
function lookupsToday(): number {
  try {
    const raw = localStorage.getItem(COUNT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    if (parsed.date !== todayDateString()) return 0;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function countLookup(): void {
  try {
    localStorage.setItem(
      COUNT_KEY,
      JSON.stringify({ date: todayDateString(), count: lookupsToday() + 1 })
    );
  } catch {
    // Without storage the budget can't be tracked; the request still goes ahead.
  }
}

/**
 * Whether a failure with this reason still needs reporting this session. A
 * half-broken lookup (one reference down, the other answering) would otherwise
 * fire an identical event on every single word.
 */
export function shouldReportFailure(reason: string): boolean {
  try {
    const seen = (sessionStorage.getItem(REPORTED_KEY) ?? "").split(",").filter(Boolean);
    if (seen.includes(reason)) return false;
    sessionStorage.setItem(REPORTED_KEY, [...seen, reason].join(","));
    return true;
  } catch {
    // Can't dedupe without storage; better to report twice than never.
    return true;
  }
}

/** Clear this session's flags and today's budget. For tests and the dev reset. */
export function resetLiveCheckSession(): void {
  disabledInMemory = null;
  try {
    sessionStorage.removeItem(DISABLED_KEY);
    sessionStorage.removeItem(REPORTED_KEY);
    localStorage.removeItem(COUNT_KEY);
  } catch {
    // Nothing persisted, nothing to clear.
  }
}

export type LiveOutcome =
  /** A dictionary attests an ordinary, current, inoffensive sense -- it counts. */
  | "playable"
  /** A dictionary knows it, but the game shouldn't take it; `reason` says which. */
  | "rejected"
  /** No dictionary has a matching entry -- the original rejection stands. */
  | "unknown"
  /** The lookup failed; `reason`/`detail` say why. Says nothing about the word. */
  | "error"
  /** No connection, so no lookup was attempted. Not a failure -- reported nowhere. */
  | "offline"
  /**
   * A permanent failure already happened this session (see PERMANENT_FAILURES),
   * so no request was made. Reported nowhere: the failure that caused it was
   * reported once, when it happened.
   */
  | "disabled";

export interface LiveCheck {
  word: string;
  outcome: LiveOutcome;
  reason: string | null;
  detail: string | null;
  /** Upstream HTTP status, when the failure came from a response. */
  status: number | null;
  /** Measured Zipf when a frequency source attests one, else null. */
  zipf: number | null;
  /** Functional labels (parts of speech) from whichever dictionary answered. */
  pos: string[];
  /** MW's first-known-use date, e.g. "1961" or "12th century". */
  firstUse: string | null;
  /**
   * Which reference answered: "collegiate", "medical", "collegiate+medical", a
   * Wordnik one ("wordnik:ahd-5", "wordnik:wordnet"), or null.
   */
  source: string | null;
  /**
   * A lookup problem worth reporting even though a verdict was produced -- one MW
   * reference failed while the other answered, or the Wordnik tier failed after
   * MW came up empty. Null when the lookup was clean.
   */
  failure: { reason: string; detail: string | null; status: number | null } | null;
  /** Wall-clock time the lookup took, for latency reporting. */
  elapsedMs: number;
}

/** Reject reasons the API can return that the game already has wording for. */
const MAPPED_REASONS = new Set<string>([
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "archaic",
  "obsolete",
  "dated",
]);

/**
 * The player-facing rejection reason for a live verdict, so a word a dictionary
 * could explain gets the specific message instead of the generic "not in the
 * curated list". Anything the game has no wording for falls back to the generic
 * reason rather than inventing new copy -- deliberately so for "offensive" and for
 * "unattested" (a Wordnik word with no measurable frequency), neither of which is
 * a player's problem to understand.
 */
export function rejectionReasonForLive(check: LiveCheck): RejectionReason {
  if (check.outcome === "rejected" && check.reason && MAPPED_REASONS.has(check.reason)) {
    return check.reason as RejectionReason;
  }
  return "not-a-word";
}

/** Whether this input is worth a live lookup at all. */
export function eligibleForLiveCheck(word: string): boolean {
  return ELIGIBLE_RE.test(word);
}

/** Whether the player has a connection. Absent the API, assume they do. */
function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function blank(
  word: string,
  outcome: LiveOutcome,
  reason: string | null,
  elapsedMs: number,
  detail: string | null = null,
  status: number | null = null
): LiveCheck {
  return {
    word,
    outcome,
    reason,
    detail,
    status,
    zipf: null,
    pos: [],
    firstUse: null,
    source: null,
    failure: outcome === "error" && reason ? { reason, detail, status } : null,
    elapsedMs,
  };
}

/**
 * The lookup problem, if any, that the caller should report. The endpoint sends a
 * `failure` object when part of the lookup broke -- one MW reference while the
 * other answered, or Wordnik after an MW miss -- *and* the word wasn't approved;
 * a total failure carries its reason at the top level instead, so both shapes
 * normalise to the same thing here.
 */
function parsedFailure(
  parsed: { failure?: LiveCheck["failure"] },
  reason: string | null,
  detail: string | null,
  status: number | null
): LiveCheck["failure"] {
  const sent = parsed.failure;
  if (sent && typeof sent === "object" && typeof sent.reason === "string") {
    return {
      reason: sent.reason,
      detail: typeof sent.detail === "string" ? sent.detail : null,
      status: typeof sent.status === "number" ? sent.status : null,
    };
  }
  return reason ? { reason, detail, status } : null;
}

/**
 * Ask the live fallback about `word`. Never rejects: every failure comes back as
 * an `error` outcome carrying the reason, so the caller can report it.
 */
export async function checkWordLive(word: string): Promise<LiveCheck> {
  const normalized = word.trim().toLowerCase();
  if (!online()) return blank(normalized, "offline", null, 0);

  // A spent quota or a bad key is settled for the session; don't spend a
  // round-trip discovering it again on every subsequent word.
  const disabled = disabledReason();
  if (disabled) return blank(normalized, "disabled", disabled, 0);

  // One browser may not spend an unbounded share of the game's daily allowance.
  if (lookupsToday() >= LIVE_DAILY_LOOKUP_CAP) {
    return blank(normalized, "disabled", "user-cap-reached", 0);
  }
  countLookup();

  const started = Date.now();
  const elapsed = () => Date.now() - started;

  let response: Response;
  try {
    response = await fetch(`/api/validate?word=${encodeURIComponent(normalized)}`, {
      signal: AbortSignal.timeout(LIVE_ABORT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return blank(
      normalized,
      "error",
      timedOut ? "client-timeout" : "client-network-error",
      elapsed(),
      error instanceof Error ? error.message : String(error)
    );
  }

  // A redirect away from our own origin means something intercepted the request
  // before it reached the function -- in practice Vercel's Deployment Protection
  // bouncing it to an SSO page. Naming it beats reporting the CORS failure or
  // HTML-parse error it eventually causes, which say nothing about the cause.
  if (response.redirected || new URL(response.url, location.href).origin !== location.origin) {
    return blank(
      normalized,
      "error",
      "auth-redirect",
      elapsed(),
      `redirected to ${response.url}`,
      response.status
    );
  }

  // A body that isn't JSON is the same class of problem seen from the other
  // side: an HTML login or error page served where the endpoint should be.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return blank(
      normalized,
      "error",
      "not-json",
      elapsed(),
      `content-type: ${contentType || "none"}`,
      response.status
    );
  }

  // The endpoint reports its own failures as a JSON body even on a non-2xx
  // status, so the body is parsed either way and only an unparsable one is a
  // client-side failure.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return blank(normalized, "error", "client-bad-response", elapsed(), `HTTP ${response.status}`, response.status);
  }

  const parsed = (body ?? {}) as Partial<LiveCheck> & { outcome?: string };
  const outcome = parsed.outcome;
  if (outcome !== "playable" && outcome !== "rejected" && outcome !== "unknown" && outcome !== "error") {
    return blank(normalized, "error", "client-bad-response", elapsed(), `unrecognized outcome`, response.status);
  }

  const reason = typeof parsed.reason === "string" ? parsed.reason : null;
  // Remember a failure that cannot resolve itself, so this is the last request
  // this session. The failure is still reported by the caller -- once.
  if (outcome === "error" && reason && PERMANENT_FAILURES.has(reason)) {
    disableForSession(reason);
  }

  const detail = typeof parsed.detail === "string" ? parsed.detail : null;
  const status = typeof parsed.status === "number" ? parsed.status : null;

  return {
    word: normalized,
    outcome,
    reason,
    detail,
    status,
    zipf: typeof parsed.zipf === "number" && Number.isFinite(parsed.zipf) ? parsed.zipf : null,
    pos: Array.isArray(parsed.pos) ? parsed.pos.filter((p): p is string => typeof p === "string") : [],
    firstUse: typeof parsed.firstUse === "string" ? parsed.firstUse : null,
    source: typeof parsed.source === "string" ? parsed.source : null,
    // Only a total failure puts its reason at the top level; otherwise the
    // endpoint's own `failure` object is the only source.
    failure:
      outcome === "error"
        ? parsedFailure(parsed, reason, detail, status)
        : parsedFailure(parsed, null, null, null),
    elapsedMs: elapsed(),
  };
}

/** Sentinel meaning "the live check hasn't answered inside the handoff window". */
export const STILL_PENDING = Symbol("still-pending");

/**
 * Wait for `promise`, but give up waiting after `ms` and return `STILL_PENDING`.
 * The promise itself is untouched and keeps running -- this only bounds how long
 * the caller blocks on it.
 */
export function withHandoff<T>(
  promise: Promise<T>,
  ms = LIVE_HANDOFF_MS
): Promise<T | typeof STILL_PENDING> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(STILL_PENDING), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(STILL_PENDING);
      }
    );
  });
}
