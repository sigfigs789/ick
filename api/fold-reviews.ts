// The fold review ledger: a Vercel Edge Function behind the page at /fold.
//
// GET /api/fold-reviews?key=…&limit=2000
//   -> { reviews: [{ word, base, ownZipf, baseZipf, verdict, date, at }] }
//   400 bad-limit, 401 unauthorised (where REVIEW_TOKEN is set), 405 wrong
//   method, 503 no credentials, 502 upstream unavailable.
//
// POST /api/fold-reviews?key=…
//   { word, base, ownZipf, baseZipf, date, verdict }  verdict: "approved" |
//   "rejected" | null
//   -> 200 { verdict }, 400 malformed, 401 unauthorised, 403 cross-origin,
//      413 too-large, 503 no credentials, 502 upstream unavailable.
//   The response says what is stored rather than echoing what was asked, so the
//   control on the page can draw the database's answer instead of its own
//   optimism -- the same contract api/review.ts's mark has.
//
// Its own endpoint rather than a third list on api/review.ts, because a verdict
// here is not that endpoint's `{ list, ref, mark }`: a fold is a pair of words
// and a pair of frequencies, all four of which are stored, and none of which a
// mark on a queue row has anywhere to put. The two share the token and the
// same-origin guard and nothing else.
//
// Gated exactly like the feedback list, in both directions: keyed where
// REVIEW_TOKEN is set, open where none is. Nothing links to this page, and a
// deployment that configures a token is asking for it to stay that way.
//
// It failed closed on an unset token to begin with, on the grounds that a
// rejection here eventually becomes an entry in fold-exemptions.json and changes
// what a word scores. What that argument missed is the shape of the path: the
// export is a person running a script and reading a diff, so nothing written
// here reaches a player without going past somebody first, and "unset means
// nobody" is a rule whose only reliable effect is locking the maintainer out of
// their own page until they go and configure a secret. The real cost of an open
// ledger is to the labelled set rather than to the scoring -- labels are worth
// something because of whose judgement they are -- and that is a reason to set
// REVIEW_TOKEN, not a reason for this file to refuse to work without one.
//
// Never CDN-cached. A response that varies by a secret must not be handed to the
// next caller.

import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

/** Long enough for the whole ledger; the page subtracts it from every batch. */
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 10000;

/** The two verdicts a fold can wear, and nothing else. */
const VERDICTS = ["approved", "rejected"] as const;
type Verdict = (typeof VERDICTS)[number];

/** The game's own input rule, which is also the table's check constraint. */
const WORD_RE = /^[a-z]{2,40}$/;
/** A puzzle date as the game writes one. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A verdict is six small fields; nothing here needs a large body.
const MAX_BODY_BYTES = 2 * 1024;

/** One row as `list_fold_reviews` returns it. */
interface ReviewRow {
  word: string;
  base: string;
  own_zipf: number | string | null;
  base_zipf: number | string | null;
  verdict: string;
  puzzle_date: string | null;
  reviewed_at: string;
}

/**
 * The Edge runtime exposes configured secrets on `process.env`. Declared here
 * for the same reason api/_supabase.ts declares it: this runtime has no Node
 * globals, and pulling @types/node in to read one string would pretend it does.
 */
declare const process: { env: Record<string, string | undefined> };

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

/**
 * Postgres numerics arrive as strings over PostgREST, so every number is read
 * rather than trusted. Null stays null: an unattested word has no frequency, and
 * inventing one here would be inventing the very thing the reviewer was judging.
 */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether this deployment asks for a key at all. */
function keyed(): boolean {
  return (process.env.REVIEW_TOKEN ?? "") !== "";
}

/**
 * Whether this request carries the deployment's review token.
 *
 * The same check api/review.ts makes, including the constant-time compare: a
 * timing side channel on a curator's page is not the threat anybody here is
 * facing, but the compare is four lines and removes the question. Asked only
 * where a token is configured -- see `keyed` above and the two callers.
 */
function authorised(request: Request): boolean {
  const expected = process.env.REVIEW_TOKEN ?? "";
  if (!expected) return false;
  const given = new URL(request.url).searchParams.get("key") ?? "";
  if (given.length !== expected.length) return false;
  let same = 0;
  for (let i = 0; i < expected.length; i += 1) {
    same |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return same === 0;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request);
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST", "cache-control": "no-store" },
  });
}

async function handleGet(request: Request): Promise<Response> {
  if (keyed() && !authorised(request)) return reply(401, { ok: false, reason: "unauthorised" });

  // A limit that isn't a number is a caller and this endpoint disagreeing, which
  // is worth saying; an absent one is simply the default.
  const rawLimit = new URL(request.url).searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return reply(400, { ok: false, reason: "bad-limit" });
    }
  }

  // Said plainly rather than answered with an empty list: an empty ledger and a
  // deployment with no credentials look identical on the page otherwise, and one
  // of them is a setup problem.
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<ReviewRow[] | null>("list_fold_reviews", { p_limit: limit });
    return reply(200, {
      reviews: (rows ?? []).map((row) => ({
        word: row.word,
        base: row.base,
        ownZipf: num(row.own_zipf),
        baseZipf: num(row.base_zipf),
        verdict: row.verdict,
        date: row.puzzle_date,
        at: row.reviewed_at,
      })),
    });
  } catch (error: unknown) {
    // The reason stays in the function logs: a reader gets "couldn't load" and a
    // retry, which is all they can act on.
    console.error("[fold-reviews] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handlePost(request: Request): Promise<Response> {
  // Same-origin only when the caller declares an origin, which every browser
  // does on a POST -- the same guard api/events.ts and api/review.ts use.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply(403, { ok: false, reason: "bad-origin" });
    }
    if (originHost !== new URL(request.url).host) {
      return reply(403, { ok: false, reason: "cross-origin" });
    }
  }

  if (keyed() && !authorised(request)) return reply(401, { ok: false, reason: "unauthorised" });

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, reason: "too-large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, reason: "malformed-json" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return reply(400, { ok: false, reason: "malformed-review" });
  }

  const { word, base, ownZipf, baseZipf, date, verdict } = parsed as {
    word?: unknown;
    base?: unknown;
    ownZipf?: unknown;
    baseZipf?: unknown;
    date?: unknown;
    verdict?: unknown;
  };

  if (typeof word !== "string" || !WORD_RE.test(word)) {
    return reply(400, { ok: false, reason: "bad-word" });
  }
  if (typeof base !== "string" || !WORD_RE.test(base)) {
    return reply(400, { ok: false, reason: "bad-base" });
  }
  // Null is a real value here -- it is how a verdict is taken back -- so an
  // absent field and a null one are the same request.
  if (verdict !== null && verdict !== undefined && !VERDICTS.includes(verdict as Verdict)) {
    return reply(400, { ok: false, reason: "bad-verdict" });
  }
  if (date !== null && date !== undefined && (typeof date !== "string" || !DATE_RE.test(date))) {
    return reply(400, { ok: false, reason: "bad-date" });
  }
  const wanted = (verdict ?? null) as Verdict | null;

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const stored = await rpc<string | null>("set_fold_review", {
      p_word: word,
      p_base: base,
      // A frequency that isn't a finite number is stored as none rather than
      // refused: the unattested end of the dictionary genuinely has no number,
      // and a verdict is about the fold, not about the corpus reaching the word.
      p_own_zipf: typeof ownZipf === "number" && Number.isFinite(ownZipf) ? ownZipf : null,
      p_base_zipf: typeof baseZipf === "number" && Number.isFinite(baseZipf) ? baseZipf : null,
      p_puzzle_date: date ?? null,
      p_verdict: wanted,
    });
    return reply(200, {
      verdict: stored === "approved" || stored === "rejected" ? stored : null,
    });
  } catch (error: unknown) {
    console.error("[fold-reviews] write failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
