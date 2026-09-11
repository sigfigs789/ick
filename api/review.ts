// The review lists: a Vercel Edge Function that reads the word queue and the
// feedback players have left, for the two pages at /suggested-words and
// /feedback.
//
// GET /api/review?list=suggested-words&limit=200
//   -> { words: [{ word, origin, zipf, pos, firstUse, mwSource, lookups,
//                  suggestions, firstAt, lastAt, mark, liveApproved }] }
// GET /api/review?list=feedback&limit=200
//   -> { feedback: [{ id, text, at, mark }] }
//   400 bad-list / bad-limit, 401 unauthorised, 405 wrong method,
//   503 no credentials, 502 upstream unavailable.
//
// POST /api/review
//   { list, ref, mark }   mark: "accepted" | "rejected" | null
//   -> 200 { mark }, 400 malformed, 401 unauthorised, 503 no credentials,
//      502 upstream unavailable.
//   The mark a row is wearing: `ref` is the word on the queue or the note's id,
//   and a null mark clears it. The response says what is stored rather than
//   echoing what was asked, so the control on the page can draw the database's
//   answer instead of its own optimism.
//
//   Where a mark is kept differs by list, and deliberately. A word's mark *is*
//   `word_sightings.status`, the column the dictionary graduation pass already
//   reads, so triaging from the page and triaging from a script are the same
//   act. A note's mark is a row in `feedback_marks`, because the events table it
//   would otherwise live in is an append-only mirror of what the client sent.
//
// The order is the functions' own (see the migrations) rather than anything this
// file does to them: the queue oldest first, because it is a queue, and the
// feedback newest first, because the page is reached from the box that writes
// to it.
//
// Both lists were already in the database and reachable only from a psql prompt
// holding the service-role key (see the 2026-09-11 migration for the two
// functions this calls). This endpoint is the browser's way in, and it is a read
// and nothing else: no write path, and nothing here triages a word or answers a
// note.
//
// Who may read it: anybody. Both pages are linked from the game -- the
// how-to-play sheet points whoever just left a note at the feedback list, and
// the word rules sheet points whoever just suggested a word at the queue -- so
// these are public lists by decision rather than unlinked ones by default. What
// a player wrote into the feedback box is readable by every other player, which
// is the trade that link makes.
//
// Who may mark: only a request carrying REVIEW_TOKEN as `key`, which the pages
// take from their own URL and pass along. Unset, nobody can mark anything from
// anywhere -- the write fails closed, because "unset means anybody" and "the
// page is linked from the game" together mean a stranger triaging words into
// the dictionary. A curator sets the token and opens the page with ?key=.
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
  first_at: string | null;
  last_at: string | null;
  /** new | accepted | rejected | deferred; only the middle two are marks. */
  status: string | null;
  /** playable | unknown | suggested: the live MW verdict, when there was one. */
  outcome: string | null;
}

/** One row as `list_feedback` returns it. */
interface FeedbackRow {
  id: number;
  feedback: string | null;
  created_at: string;
  mark: string | null;
}

/** The two marks a row can wear, and nothing else. */
const MARKS = ["accepted", "rejected"] as const;
type Mark = (typeof MARKS)[number];

/**
 * A stored value read as a mark.
 *
 * `word_sightings.status` has four values and only two of them are marks: 'new'
 * is an untouched row and 'deferred' is a state this page has no control for.
 * Both come back as null -- unmarked -- rather than as a state the toggle would
 * have to invent a third glyph for. A 'deferred' word set by some other pass
 * therefore reads as unmarked here, and marking it from the page overwrites it,
 * which is the honest behaviour for a control that only knows two answers.
 */
function asMark(value: string | null): Mark | null {
  return value === "accepted" || value === "rejected" ? value : null;
}

/** The word a queue mark is about: the game's own input rule. */
const WORD_RE = /^[a-z]{2,30}$/;
// A mark is three fields; nothing here needs a large body.
const MAX_BODY_BYTES = 2 * 1024;

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
 * Whether this request carries the deployment's review token.
 *
 * Reading and marking ask this the same question and do different things with
 * the answer: a read without a token is allowed, since both pages are linked
 * from the game now, while a mark without one is refused. With REVIEW_TOKEN
 * unset there is no token to carry, so nothing can be marked from anywhere --
 * see handlePost.
 *
 * Compared in full rather than short-circuiting on the first differing
 * character. A timing side channel on a review page is not the threat anybody
 * here is facing, but a constant-time compare is four lines and removes the
 * question.
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

/**
 * The Edge runtime exposes configured secrets on `process.env`. Declared here
 * for the same reason api/_supabase.ts declares it: this runtime has no Node
 * globals, and pulling @types/node in to read one string would pretend it does.
 */
declare const process: { env: Record<string, string | undefined> };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request);
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST", "cache-control": "no-store" },
  });
}

/**
 * Set or clear the mark on one row.
 *
 * Keyed, always, which is a stricter gate than the read below and the reason the
 * two were split. Both lists are linked from the game now -- the how-to-play
 * sheet offers the feedback page to whoever just left a note, and the word rules
 * sheet offers the queue to whoever just suggested a word -- so every player is
 * a reader, and a word's mark is the dictionary graduation pass's own input.
 * Reading these lists openly is the decision that was taken; letting anybody who
 * read one triage it is not.
 *
 * So this fails closed rather than open: with no REVIEW_TOKEN configured there is
 * no key that works, and marking is off everywhere until one is set. The
 * alternative -- unset meaning "anybody" -- is exactly the state a public link
 * turns into a stranger accepting words into the dictionary.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!authorised(request)) return reply(401, { ok: false, reason: "unauthorised" });

  // Same-origin only when the caller declares an origin, which every browser
  // does on a POST -- the same guard api/events.ts uses, for the same reason.
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
    return reply(400, { ok: false, reason: "malformed-mark" });
  }

  const { list, ref, mark } = parsed as { list?: unknown; ref?: unknown; mark?: unknown };
  if (list !== "suggested-words" && list !== "feedback") {
    return reply(400, { ok: false, reason: "bad-list" });
  }
  // Null is a real value here -- it is how a mark is cleared -- so an absent
  // field and a null one are the same request.
  if (mark !== null && mark !== undefined && !MARKS.includes(mark as Mark)) {
    return reply(400, { ok: false, reason: "bad-mark" });
  }
  const wanted = (mark ?? null) as Mark | null;

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    if (list === "feedback") {
      // The note's own id, as the list handed it out.
      if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 1) {
        return reply(400, { ok: false, reason: "bad-ref" });
      }
      const stored = await rpc<string | null>("set_feedback_mark", {
        p_event_id: ref,
        p_mark: wanted,
      });
      return reply(200, { mark: asMark(stored) });
    }
    if (typeof ref !== "string" || !WORD_RE.test(ref)) {
      return reply(400, { ok: false, reason: "bad-ref" });
    }
    // Clearing a word's mark returns it to 'new', which is what an untriaged row
    // is everywhere else in this database -- there is no fourth state for "was
    // marked once".
    await rpc<number>("set_word_status", {
      p_words: [ref],
      p_status: wanted ?? "new",
    });
    return reply(200, { mark: wanted });
  } catch (error: unknown) {
    console.error("[review] mark failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handleGet(request: Request): Promise<Response> {
  // Open, unlike the mark above. Both pages are linked from the game, so a
  // reader arriving without a key is the ordinary case rather than an intruder.
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
          mark: asMark(row.mark),
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
        firstAt: row.first_at,
        lastAt: row.last_at,
        mark: asMark(row.status),
        // The live Merriam-Webster check approved this word mid-puzzle, so it
        // was played on MW's say-so and nobody else's. Sent as the question the
        // page asks rather than as the raw verdict: "unknown" and "suggested"
        // are both just "no", and neither is worth a second label on the row.
        liveApproved: row.outcome === "playable",
      })),
    });
  } catch (error: unknown) {
    // The reason stays in the function logs: a reader gets "couldn't load" and a
    // retry, which is all they can act on.
    console.error("[review] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
