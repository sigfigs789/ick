// The review lists: a Vercel Edge Function that reads the word queue and the
// feedback players have left, for the two pages at /suggested-words and
// /feedback.
//
// GET /api/review?list=suggested-words&limit=200
//   -> { words: [{ word, origin, zipf, pos, firstUse, mwSource, lookups,
//                  suggestions, firstAt, lastAt, mark, liveApproved }] }
// GET /api/review?list=feedback&limit=200
//   -> { feedback: [{ id, text, at, mark }] }
// GET /api/review?list=freeform&limit=200
//   -> { tally: { love, boo }, byDate: [{ date, love, boo }],
//        notes: [{ id, text, at, date, vote }] }
// GET /api/review?list=analytics&from=YYYY-MM-DD&to=YYYY-MM-DD&today=YYYY-MM-DD
//   (every date optional: no `from` is all time, no `to` the latest day)
//   -> { report: { today, firstDay, from, to, groups, modes, chat, chatSince,
//                  idleHint, idleHintSince, botsFiltered, daily } }
//   400 bad-list / bad-limit / bad-date, 401 unauthorised, 405 wrong method,
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
// Who may read it differs by list, because the two pages are not the same kind
// of page any more.
//
//   suggested-words  anybody. The word rules sheet points whoever just suggested
//                    a word at the queue it joined, so a keyless reader is the
//                    ordinary case. A queue of words is everybody's.
//   analytics        anybody. Every number in it is an aggregate -- nobody can
//                    be read out of it -- and the maintainer wants to open it
//                    without a key. Still linked from nowhere.
//   freeform         keyed, on the same terms as the feedback below it: the
//                    notes are the same kind of thing, and the tally beside
//                    them is a trial's running result, which is not a number to
//                    hand a player mid-trial.
//   feedback         keyed, when REVIEW_TOKEN is set. Nothing in the app links
//                    to it: a note is something one player wrote to us, and the
//                    pile of them is not a page to hand the next player. Unset,
//                    it answers anybody who types the URL -- unlinked is not
//                    protected, and the token is what protection there is.
//
// Who may mark: only a request carrying REVIEW_TOKEN as `key`, which the pages
// take from their own URL and pass along. Unset, nobody can mark anything from
// anywhere -- the write fails closed, because "unset means anybody" and "the
// queue is linked from the game" together mean a stranger triaging words into
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
/**
 * The analytics report takes about two seconds to build -- the game's own cap --
 * and nobody playing waits on it, so it gets longer before it is given up on.
 */
const ANALYTICS_TIMEOUT_MS = 8000;

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

/** One row as `list_freeform_votes` returns it. */
interface FreeformVoteRow {
  voter: string;
  vote: string;
  puzzle_date: string | null;
  created_at: string;
}

/** One row as `list_freeform_feedback` returns it. */
interface FreeformNoteRow {
  id: number;
  feedback: string | null;
  puzzle_date: string | null;
  vote: string | null;
  created_at: string;
}

/** A love/boo count, which is what every part of the freeform read comes to. */
interface Tally {
  love: number;
  boo: number;
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
 * Set or clear the mark on one row. Gated by which list, like the read above,
 * and for the same reason: the two are no longer the same kind of page.
 *
 * A word's mark fails closed. `word_sightings.status` is the dictionary
 * graduation pass's own input, and the queue is linked from the word rules
 * sheet -- so "no REVIEW_TOKEN configured" must not mean "anybody may mark",
 * which on a linked page is a stranger accepting words into the dictionary. No
 * token, no marking, until one is set.
 *
 * A note's mark follows the read instead: keyed where a token is set, open
 * where none is. Nothing links to the feedback page, a note's mark lives in a
 * table of its own, and no part of the game reads it -- the worst a stranger
 * who guessed the URL could do is tick a note somebody already wrote. That does
 * not earn a gate that locks the maintainer out of their own triage page until
 * they go and configure a secret.
 */
async function handlePost(request: Request): Promise<Response> {
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

  // Which list decides how hard this is gated, so the check waits until the list
  // is known. A word's mark always needs the key; a note's needs one only where
  // a token is configured, exactly like reading the notes does.
  const alwaysKeyed = list !== "feedback" || (process.env.REVIEW_TOKEN ?? "") !== "";
  if (alwaysKeyed && !authorised(request)) {
    return reply(401, { ok: false, reason: "unauthorised" });
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
  const params = new URL(request.url).searchParams;
  const list = params.get("list");
  if (
    list !== "suggested-words" &&
    list !== "feedback" &&
    list !== "freeform" &&
    list !== "analytics"
  ) {
    return reply(400, { ok: false, reason: "bad-list" });
  }

  // The queue is linked from the game and answers anybody, and so does the
  // analytics report, which is aggregates only. The notes are not linked from
  // anywhere, and a deployment that sets REVIEW_TOKEN is asking for
  // them to stay that way. Unlike the mark, this does not fail closed on an
  // unset token: that would take the feedback page away from a deployment that
  // has always read it without one, which is a thing to opt into rather than to
  // wake up to.
  const open = list === "suggested-words" || list === "analytics";
  if (!open && (process.env.REVIEW_TOKEN ?? "") !== "" && !authorised(request)) {
    return reply(401, { ok: false, reason: "unauthorised" });
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
    if (list === "analytics") {
      // The window's ends and the viewer's own puzzle, sent as-is rather than
      // worked out here from a clock: "today" is the puzzle the reader is on.
      // Checked only for being real dates in order; the function takes the
      // first and latest day anybody turned up for an end that is missing.
      const dates: Record<"from" | "to" | "today", string | null> = {
        from: params.get("from"),
        to: params.get("to"),
        today: params.get("today"),
      };
      if (Object.values(dates).some((d) => d !== null && !isCalendarDate(d))) {
        return reply(400, { ok: false, reason: "bad-date" });
      }
      if (dates.from !== null && dates.to !== null && dates.from > dates.to) {
        return reply(400, { ok: false, reason: "bad-date" });
      }
      // Passed through as the database built it. The function is the one place
      // these numbers are defined (see the 2026-10-18 migration), and a second
      // copy of every field name here would be a second place for them to drift.
      const report = await rpc<Record<string, unknown> | null>("analytics_overview", {
        p_from: dates.from,
        p_to: dates.to,
        p_today: dates.today,
      }, ANALYTICS_TIMEOUT_MS);
      return reply(200, { report: report ?? {} });
    }
    if (list === "freeform") {
      // Two reads rather than one, because the votes and the notes are two
      // questions -- and together rather than in sequence, since neither
      // depends on the other and the page shows them as one answer.
      const [voteRows, noteRows] = await Promise.all([
        rpc<FreeformVoteRow[] | null>("list_freeform_votes", {}),
        rpc<FreeformNoteRow[] | null>("list_freeform_feedback", { p_limit: limit }),
      ]);
      const votes = voteRows ?? [];
      return reply(200, {
        // Counted here rather than in SQL because the two counts the page wants
        // are the same collapse read twice, and the row that carries them --
        // one voter, one verdict -- is the thing the database is authoritative
        // about. What does not leave this function is the voter id: the page
        // shows sides and notes, and has no use for who.
        tally: tally(votes),
        byDate: byDate(votes),
        notes: (noteRows ?? []).map((row) => ({
          id: row.id,
          text: row.feedback ?? "",
          at: row.created_at,
          date: row.puzzle_date,
          vote: row.vote === "love" || row.vote === "boo" ? row.vote : null,
        })),
      });
    }
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

/** How the two sides stand, over every voter given. */
function tally(votes: readonly FreeformVoteRow[]): Tally {
  return {
    love: votes.filter((row) => row.vote === "love").length,
    boo: votes.filter((row) => row.vote === "boo").length,
  };
}

/**
 * The same tally cut by the puzzle the verdict was cast on, oldest day first.
 *
 * The week is short and the difference between its ends is most of what there
 * is to learn from it: a vote on the first day is a first impression of a
 * notice, and one on the last is a week of actually playing under the rules.
 * A flat love-to-boo hides exactly that.
 *
 * A vote whose event carried no date is left out of this breakdown and still
 * counted in the tally above -- it is a real verdict from a real player, and
 * the only thing missing is which day to file it under.
 */
function byDate(votes: readonly FreeformVoteRow[]): Array<Tally & { date: string }> {
  const days = new Map<string, Tally>();
  for (const row of votes) {
    const date = row.puzzle_date;
    if (!date) continue;
    const day = days.get(date) ?? { love: 0, boo: 0 };
    if (row.vote === "love") day.love += 1;
    else if (row.vote === "boo") day.boo += 1;
    days.set(date, day);
  }
  return [...days.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** YYYY-MM-DD naming a day the calendar has (not 2026-02-30). */
function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
