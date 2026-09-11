// The client side of the two review lists: the word queue and the feedback
// players have left. See api/review.ts for what answers these.
//
// Both are read the same way, so they share one function and differ only in the
// shape that comes back. Nothing here touches gameplay: these lists are read by
// two pages that have no link in the app, and a failure on either is a page that
// says it could not load.

import { sampleReviewResponse, usingSampleData } from "../dev/sampleData";

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
  list: "suggested-words" | "feedback",
  pick: (body: Record<string, unknown>) => T,
): Promise<T> {
  // `vite dev` serves no edge functions, so these lists have no server to ask
  // unless one is running. Same switch as the leaderboard's (see
  // dev/sampleData.ts), and dropped from a production build with it.
  if (import.meta.env.DEV && usingSampleData()) {
    return pick(sampleReviewResponse(list) as Record<string, unknown>);
  }
  const response = await fetch(`/api/review?list=${list}${keyParam()}`, {
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

/** Every note players have left, in the order they were written. */
export function fetchFeedback(): Promise<FeedbackNote[]> {
  return read("feedback", (body) => parseFeedback(body.feedback));
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
    });
  }
  return words;
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
  // Sample data has no server to write to, and a toggle that always failed
  // would make the fixture worse than nothing: it answers with what was asked
  // for, and the mark lives as long as the page does.
  if (import.meta.env.DEV && usingSampleData()) return mark;
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
