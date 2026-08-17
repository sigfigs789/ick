// Client for /api/validate -- the live Merriam-Webster fallback consulted when a
// submission clears every offline check but simply isn't in the curated list.
//
// Two rules shape this module:
//   1. It only runs for players with a connection (`navigator.onLine`).
//   2. It never makes the player wait more than `LIVE_HANDOFF_MS`. Past that the
//      rejection is shown and the request is *not* cancelled -- it keeps going,
//      and whatever it finds is still reported (and still counted, see
//      useDailyPuzzle).

import type { RejectionReason } from "./types";

/** How long a player waits for a live verdict before the rejection is shown. */
export const LIVE_HANDOFF_MS = 1000;

/** Hard ceiling on a single lookup, so a wedged request can't leak forever. */
const LIVE_ABORT_MS = 15000;

/** Words worth spending quota on: the game's own input rule. */
const ELIGIBLE_RE = /^[a-z]{2,30}$/;

export type LiveOutcome =
  /** MW attests an ordinary, current, inoffensive sense -- the word counts. */
  | "playable"
  /** MW knows it, but the game shouldn't take it; `reason` says which. */
  | "rejected"
  /** MW has no matching entry -- the original rejection stands. */
  | "unknown"
  /** The lookup failed; `reason`/`detail` say why. Says nothing about the word. */
  | "error"
  /** No connection, so no lookup was attempted. Not a failure -- reported nowhere. */
  | "offline";

export interface LiveCheck {
  word: string;
  outcome: LiveOutcome;
  reason: string | null;
  detail: string | null;
  /** Upstream HTTP status, when the failure came from a response. */
  status: number | null;
  /** Measured Zipf when a frequency source attests one, else null. */
  zipf: number | null;
  /** MW functional labels (parts of speech). */
  pos: string[];
  /** MW's first-known-use date, e.g. "1961" or "12th century". */
  firstUse: string | null;
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
]);

/**
 * The player-facing rejection reason for a live verdict, so a word MW could
 * explain gets the specific message instead of the generic "not in the curated
 * list". Anything the game has no wording for (notably "offensive") falls back
 * to the generic reason rather than inventing new copy.
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

function blank(word: string, outcome: LiveOutcome, reason: string | null, elapsedMs: number, detail: string | null = null, status: number | null = null): LiveCheck {
  return { word, outcome, reason, detail, status, zipf: null, pos: [], firstUse: null, elapsedMs };
}

/**
 * Ask the live fallback about `word`. Never rejects: every failure comes back as
 * an `error` outcome carrying the reason, so the caller can report it.
 */
export async function checkWordLive(word: string): Promise<LiveCheck> {
  const normalized = word.trim().toLowerCase();
  if (!online()) return blank(normalized, "offline", null, 0);

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

  return {
    word: normalized,
    outcome,
    reason: typeof parsed.reason === "string" ? parsed.reason : null,
    detail: typeof parsed.detail === "string" ? parsed.detail : null,
    status: typeof parsed.status === "number" ? parsed.status : null,
    zipf: typeof parsed.zipf === "number" && Number.isFinite(parsed.zipf) ? parsed.zipf : null,
    pos: Array.isArray(parsed.pos) ? parsed.pos.filter((p): p is string => typeof p === "string") : [],
    firstUse: typeof parsed.firstUse === "string" ? parsed.firstUse : null,
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
