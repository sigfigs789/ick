// The client side of the fold ledger: what has been judged, and how to judge
// one more. See api/fold-reviews.ts for what answers these.
//
// Nothing here touches gameplay. The ledger is read and written by one unlinked
// page, a failure on either side is a page that says so, and a rejection stored
// here changes no score until somebody exports it and ships the deploy (see
// scripts/export-fold-rejections.mjs).


/** How long a read waits before giving up, matching the review lists'. */
const FETCH_TIMEOUT_MS = 6000;

/** The two answers a fold can get, or null for one nobody has judged. */
export type FoldVerdict = "approved" | "rejected" | null;

/**
 * What a rejection recommends instead: the base the fold should have reached, or
 * null for "this word should not fold at all".
 *
 * The distinction is the reason the page asks. Exported, the first becomes an
 * entry pinning the word to that base and the second one leaving it on its own
 * frequency -- opposite corrections, and a ledger that could only record the
 * second turned every "it folds one hop too far" into "it does not fold".
 */
export type SuggestedBase = string | null;

/** One judged fold, as the ledger returns it. */
export interface FoldReview {
  word: string;
  base: string;
  /** The frequencies the reviewer was shown; null where no corpus attests one. */
  ownZipf: number | null;
  baseZipf: number | null;
  verdict: Exclude<FoldVerdict, null>;
  /** On a rejection, the base recommended in its place. Null means no fold. */
  suggestedBase: SuggestedBase;
  /** The puzzle the word was up for when it was judged. */
  date: string | null;
  at: string;
}

/**
 * The key as a query parameter, taken from the page's own URL.
 *
 * Passed along whether or not the deployment asks for one -- the endpoint is
 * what knows, and an unkeyed deployment simply ignores it (see
 * api/fold-reviews.ts). Read from the address bar rather than stored, so nothing
 * leaves a review key sitting in localStorage.
 */
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
  const response = await fetch(`/api/fold-reviews${keyParam(true)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`fold-reviews ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return parseReviews(body.reviews);
}

/** A verdict and, where it is a rejection, what it recommends instead. */
export interface StoredVerdict {
  verdict: FoldVerdict;
  suggestedBase: SuggestedBase;
}

/**
 * Record one verdict and its recommendation, or take it back, and answer with
 * what is stored.
 *
 * The stored value rather than the asked-for one, so the page can correct itself
 * instead of leaving a tick over a fold the database never heard about. Rejects
 * on failure, so the caller can put the old answer back.
 */
export async function setFoldReview(
  fold: { word: string; base: string; ownZipf: number; baseZipf: number; date: string },
  verdict: FoldVerdict,
  suggestedBase: SuggestedBase = null
): Promise<StoredVerdict> {
  const response = await fetch(`/api/fold-reviews${keyParam(true)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...fold, verdict, suggestedBase }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`fold-review ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return { verdict: asVerdict(body.verdict), suggestedBase: asBase(body.suggestedBase) };
}

/** Anything that is not a word is no recommendation. */
function asBase(value: unknown): SuggestedBase {
  return typeof value === "string" && value !== "" ? value : null;
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
      suggestedBase: asBase(row.suggestedBase),
      date: typeof row.date === "string" ? row.date : null,
      at: typeof row.at === "string" ? row.at : "",
    });
  }
  return reviews;
}
