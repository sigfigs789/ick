// Live fold rejections: a Vercel Edge Function behind the page at /folded-live
// and behind every Standard puzzle a player opens.
//
// GET /api/folded-live?date=YYYY-MM-DD
//   -> { rejections: [{ word, base, at }] }
//   400 bad-date, 405 wrong method, 503 no credentials, 502 upstream unavailable.
//   Cached at the CDN for a few seconds: every player opening the same puzzle
//   sends the same URL, and a rejection reaching them a quarter-minute late is
//   no cost at all. The page sends a cache-buster so its own reads are fresh.
//
// POST /api/folded-live
//   { date, word, base, rejected }
//   -> 200 { rejected }, 400 malformed, 403 cross-origin, 413 too-large,
//      503 no credentials, 502 upstream unavailable.
//   The response says what is stored rather than echoing what was asked, the
//   same contract api/fold-reviews.ts has.
//
// Not keyed, on purpose: the page is meant to open without a password. The
// same-origin guard is the only fence, which is the bar every other write from
// this site clears.
//
// Separate from api/fold-reviews.ts because the two ledgers mean different
// things. A verdict there is reviewed, exported and shipped; a rejection here
// changes what one puzzle scores the moment it is written (see the
// 20261013100000 migration).

import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

/** The game's own input rule, which is also the table's check constraint. */
const WORD_RE = /^[a-z]{2,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 1024;
/** How long the CDN may share one answer for a puzzle. */
const CACHE_SECONDS = 15;

/** One row as `list_live_fold_rejections` returns it. */
interface RejectionRow {
  word: string;
  base: string;
  rejected_at: string;
}

function reply(status: number, body?: unknown, cacheSeconds = 0): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      // `max-age=0` so the browser always asks, `s-maxage` so asking is cheap --
      // see the same header in api/leaderboard.ts for why both are needed.
      "cache-control": cacheSeconds
        ? `public, max-age=0, s-maxage=${cacheSeconds}`
        : "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

function validDate(date: unknown): date is string {
  return (
    typeof date === "string" &&
    DATE_RE.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  );
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
  const date = new URL(request.url).searchParams.get("date");
  if (!validDate(date)) return reply(400, { ok: false, reason: "bad-date" });
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<RejectionRow[] | null>("list_live_fold_rejections", { p_date: date });
    return reply(
      200,
      {
        rejections: (rows ?? []).map((row) => ({
          word: row.word,
          base: row.base,
          at: row.rejected_at,
        })),
      },
      CACHE_SECONDS
    );
  } catch (error: unknown) {
    console.error("[folded-live] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handlePost(request: Request): Promise<Response> {
  // Same-origin only when the caller declares an origin, which every browser
  // does on a POST -- the same guard api/fold-reviews.ts uses.
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

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, reason: "too-large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, reason: "malformed-json" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return reply(400, { ok: false, reason: "malformed-rejection" });
  }

  const { date, word, base, rejected } = parsed as {
    date?: unknown;
    word?: unknown;
    base?: unknown;
    rejected?: unknown;
  };
  if (!validDate(date)) return reply(400, { ok: false, reason: "bad-date" });
  if (typeof word !== "string" || !WORD_RE.test(word)) {
    return reply(400, { ok: false, reason: "bad-word" });
  }
  if (typeof base !== "string" || !WORD_RE.test(base)) {
    return reply(400, { ok: false, reason: "bad-base" });
  }
  if (typeof rejected !== "boolean") return reply(400, { ok: false, reason: "bad-rejected" });

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const stored = await rpc<boolean | null>("set_live_fold_rejection", {
      p_date: date,
      p_word: word,
      p_base: base,
      p_rejected: rejected,
    });
    return reply(200, { rejected: stored === true });
  } catch (error: unknown) {
    console.error("[folded-live] write failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
