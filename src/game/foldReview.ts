// The client side of the fold ledger: what has been judged, and how to judge
// one more. See api/fold-reviews.ts for what answers these.
//
// Nothing here touches gameplay. The ledger is read and written by one unlinked
// page, a failure on either side is a page that says so, and a rejection stored
// here changes no score until somebody exports it and ships the deploy (see
// scripts/export-fold-rejections.mjs).

import { DEV_TOOLS } from "../dev/devTools";
import { usingSampleData } from "../dev/sampleData";
import { hasReviewKey } from "./review";

/** How long a read waits before giving up, matching the review lists'. */
const FETCH_TIMEOUT_MS = 6000;

/** The two answers a fold can get, or null for one nobody has judged. */
export type FoldVerdict = "approved" | "rejected" | null;

/** One judged fold, as the ledger returns it. */
export interface FoldReview {
  word: string;
  base: string;
  /** The frequencies the reviewer was shown; null where no corpus attests one. */
  ownZipf: number | null;
  baseZipf: number | null;
  verdict: Exclude<FoldVerdict, null>;
  /** The puzzle the word was up for when it was judged. */
  date: string | null;
  at: string;
}

export { hasReviewKey };

/** The key as a query parameter, taken from the page's own URL. */
function keyParam(leading: boolean): string {
  const key = new URLSearchParams(window.location.search).get("key");
  if (!key) return "";
  return `${leading ? "?" : "&"}key=${encodeURIComponent(key)}`;
}

/**
 * Every verdict reached so far.
 *
 * The whole ledger rather than a page of it, because the page subtracts it from
 * the batch it is about to show: a partial read would hand a reviewer words they
 * have already answered for, which is the one thing keeping the ledger is meant
 * to prevent.
 */
export async function fetchFoldReviews(): Promise<FoldReview[]> {
  // `vite dev` serves no edge functions, so there is no ledger to ask unless one
  // is running. The folds themselves need no server -- they are worked out from
  // the bundled dictionary and the corpus in public/ -- so the fixture is an
  // empty ledger rather than a made-up one: every fold unjudged, which is what a
  // ledger looks like before anybody has used the page. Same switch as the
  // leaderboard's (see dev/sampleData.ts), and dropped from a production build
  // with it.
  if (DEV_TOOLS && usingSampleData()) return [];
  const response = await fetch(`/api/fold-reviews${keyParam(true)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`fold-reviews ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseReviews(body.reviews);
}

/**
 * Record one verdict, or take it back, and answer with what is stored.
 *
 * The stored value rather than the asked-for one, so the page can correct itself
 * instead of leaving a tick over a fold the database never heard about. Rejects
 * on failure, so the caller can put the old answer back.
 */
export async function setFoldReview(
  fold: { word: string; base: string; ownZipf: number; baseZipf: number; date: string },
  verdict: FoldVerdict
): Promise<FoldVerdict> {
  // Nowhere to write to under the fixture, and a control that always failed
  // would make the fixture worse than nothing: it answers with what was asked
  // for, and the verdict lives as long as the page does.
  if (DEV_TOOLS && usingSampleData()) return verdict;
  const response = await fetch(`/api/fold-reviews${keyParam(true)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...fold, verdict }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`fold-review ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return asVerdict(body.verdict);
}

/** Anything that is not one of the two answers is an unjudged fold. */
function asVerdict(value: unknown): FoldVerdict {
  return value === "approved" || value === "rejected" ? value : null;
}

/**
 * Rows are read rather than cast: the boundary where a JSON body becomes a typed
 * list. A row missing the word or the verdict is the one thing the ledger is
 * about, so it is dropped rather than rendered as a blank line.
 */
function parseReviews(raw: unknown): FoldReview[] {
  if (!Array.isArray(raw)) return [];
  const reviews: FoldReview[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const verdict = asVerdict(row.verdict);
    if (typeof row.word !== "string" || row.word === "" || verdict === null) continue;
    reviews.push({
      word: row.word,
      base: typeof row.base === "string" ? row.base : "",
      ownZipf: typeof row.ownZipf === "number" ? row.ownZipf : null,
      baseZipf: typeof row.baseZipf === "number" ? row.baseZipf : null,
      verdict,
      date: typeof row.date === "string" ? row.date : null,
      at: typeof row.at === "string" ? row.at : "",
    });
  }
  return reviews;
}
