// The review lists: a Vercel Edge Function that reads the word queue and the
// feedback players have left, for the two pages at /suggested-words and
// /feedback.
//
// GET /api/review?list=suggested-words&limit=200
//   -> { words: [{ word, origin, zipf, pos, firstUse, mwSource, lookups,
//                  suggestions, lastAt }] }
// GET /api/review?list=feedback&limit=200
//   -> { feedback: [{ id, text, at }] }
//   400 bad-list / bad-limit, 401 unauthorised, 405 wrong method,
//   503 no credentials, 502 upstream unavailable.
//
// Both lists were already in the database and reachable only from a psql prompt
// holding the service-role key (see the 2026-09-11 migration for the two
// functions this calls). This endpoint is the browser's way in, and it is a read
// and nothing else: no write path, and nothing here triages a word or answers a
// note.
//
// Who may read it. The pages have no link anywhere in the app, which is a way
// of not advertising them and not a way of protecting them -- a path nobody
// links to is still a path anybody can type. That matters more for the feedback
// list than the queue: the words are the game's own dictionary work, while a
// note is something a player typed to *us*, and publishing those at a guessable
// URL is not a thing to do by accident. So: set REVIEW_TOKEN on the deployment
// and every request has to carry it as `key`, which the pages take from their
// own URL and pass along. Leave it unset and the lists answer anybody who asks,
// which is the right default only for a deployment where that is understood.
//
// Never CDN-cached, in either mode. A response that varies by a secret must not
// be handed to the next caller, and a triage list read once in a while is not
// the sort of traffic a cache is for.

import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

/** Long enough for a triage pass; a bound rather than a page. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/** One row as `list_suggested_words` returns it. */
interface SuggestedRow {
  word: string;
  origin: string;
  zipf: number | string | null;
  pos: string[] | null;
  first_use: string | null;
  mw_source: string | null;
  lookups: number | null;
  suggestions: number | null;
  last_at: string | null;
}

/** One row as `list_feedback` returns it. */
interface FeedbackRow {
  id: number;
  feedback: string | null;
  created_at: string;
}

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
 * rather than trusted. `null` stays null: for `zipf` it is the game's own
 * unattested floor and means something the pages say out loud.
 */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether this request may read the lists.
 *
 * Compared in full rather than short-circuiting on the first differing
 * character. A timing side channel on a review page is not the threat anybody
 * here is facing, but a constant-time compare is four lines and removes the
 * question.
 */
function authorised(request: Request): boolean {
  const expected = process.env.REVIEW_TOKEN ?? "";
  if (!expected) return true;
  const given = new URL(request.url).searchParams.get("key") ?? "";
  if (given.length !== expected.length) return false;
  let same = 0;
  for (let i = 0; i < expected.length; i += 1) {
    same |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return same === 0;
}

/**
 * The Edge runtime exposes configured secrets on `process.env`. Declared here
 * for the same reason api/_supabase.ts declares it: this runtime has no Node
 * globals, and pulling @types/node in to read one string would pretend it does.
 */
declare const process: { env: Record<string, string | undefined> };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" },
    });
  }
  if (!authorised(request)) return reply(401, { ok: false, reason: "unauthorised" });

  const params = new URL(request.url).searchParams;
  const list = params.get("list");
  if (list !== "suggested-words" && list !== "feedback") {
    return reply(400, { ok: false, reason: "bad-list" });
  }

  // A limit that isn't a number is a caller and this endpoint disagreeing, which
  // is worth saying; an absent one is simply the default.
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return reply(400, { ok: false, reason: "bad-limit" });
    }
  }

  // Said plainly rather than answered with an empty list: an empty queue and a
  // deployment with no credentials look identical on the page otherwise, and one
  // of them is a setup problem.
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    if (list === "feedback") {
      const rows = await rpc<FeedbackRow[] | null>("list_feedback", { p_limit: limit });
      return reply(200, {
        feedback: (rows ?? []).map((row) => ({
          id: row.id,
          text: row.feedback ?? "",
          at: row.created_at,
        })),
      });
    }
    const rows = await rpc<SuggestedRow[] | null>("list_suggested_words", { p_limit: limit });
    return reply(200, {
      words: (rows ?? []).map((row) => ({
        word: row.word,
        origin: row.origin,
        zipf: num(row.zipf),
        pos: row.pos ?? [],
        firstUse: row.first_use,
        mwSource: row.mw_source,
        lookups: num(row.lookups) ?? 0,
        suggestions: num(row.suggestions) ?? 0,
        lastAt: row.last_at,
      })),
    });
  } catch (error: unknown) {
    // The reason stays in the function logs: a reader gets "couldn't load" and a
    // retry, which is all they can act on.
    console.error("[review] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
