// The chat rooms: a Vercel Edge Function that reads and posts the room the chat
// bubble shows (src/components/ChatBubble.tsx). There is one room per puzzle,
// named by its date; see the 20261014000000 migration.
//
// Every request names its puzzle with `date` (YYYY-MM-DD, `?date=` on a GET,
// `date` in a POST's body). Builds from before the rooms split send none, and
// get today's puzzle on the Mountain Time calendar (see `defaultDate`).
//
// GET /api/chat?date=D&after=ID
//   -> 200 { messages: [{ id, handle, body, at }] }
//   Everything in puzzle D's room after message `after`, oldest first. `after`
//   absent or 0 is a fresh open and gets the newest page. The bubble polls this while it is open,
//   so it is CDN-cached for a couple of seconds: every open bubble asks for
//   nearly the same `after`, and one query can answer all of them.
//
// GET /api/chat?date=D&latest=1
//   -> 200 { latest: ID }
//   Just the id of the newest message in puzzle D's room (0 for an empty room), so a closed
//   bubble can tell its player something new was posted without reading the
//   room. Every closed bubble asks the same URL, so the CDN answers nearly all
//   of them; the longer cache only delays the unread dot by a few seconds.
//
// POST /api/chat   { playerId, body, date }
//   -> 201 { message }, 400 malformed, 422 { reason: "profane" | ... },
//      429 rate-limited, 503 no credentials
//   The handle is computed here from the id, never taken from the client, and
//   the id is never sent back out -- so the only way to post as somebody is to
//   know their id, which only their browser holds.
//
// POST /api/chat   { playerId, banked: { date, mode, word, tier, score } }
//   -> 201 { message } when the word earned a notice, 202 { message: null }
//      when it did not, 400 malformed, 503 no credentials
//   The game reports every word of 7.0 or more it banks on the live puzzle (see
//   src/game/chatNotices.ts), and the room posts a notice of its own when the
//   word is the puzzle's new top score -- scoring 7.0 or more and beating every
//   other player's word, or matching another player's top and usurping it -- or
//   scores 9.5 or more. The scoring lives in the browser, so the score arrives
//   as the game displayed it; whether it is a record is decided by the database
//   (see the 20261013000000 and 20261014040000 migrations). Messages carry
//   `kind`: absent for a player's message, "top" or "tier" for a notice, and a
//   notice carries the `tier` its word showed when it is known.
//
// Polling rather than Supabase Realtime, deliberately: Realtime needs a Supabase
// key in the browser and a row-level policy to go with it, and this app keeps
// every key server-side (see api/_supabase.ts). A room refreshed every few
// seconds reads as live for a chat of this size.
//
// There are no accounts, so this is not a defence against somebody determined
// to be a nuisance: a new browser is a new id. The profanity check and the rate
// limit take care of the ordinary cases; `hidden = true` on the row takes care
// of the rest (see the 20260929010000 migration).

import {
  chatProblem,
  normaliseMessage,
  tierNoticeBody,
  topNoticeBody,
  usurpNoticeBody,
  type BankedWord,
} from "../src/game/chat";
import { handleFor } from "../src/game/handle";
import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

const MAX_BODY_BYTES = 4 * 1024;
const PAGE = 50;
/** A board id: the browser's UUID, or a Reddit username inside a post. */
const PLAYER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const AFTER_RE = /^\d{1,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Lowercase letters only, as the leaderboard holds a word to. */
const WORD_RE = /^[a-z]{2,30}$/;
/** A displayed score: 0 to 10, one or two decimals at most. */
const SCORE_RE = /^(?:10(?:\.0{1,2})?|\d(?:\.\d{1,2})?)$/;
const TIERS: ReadonlySet<string> = new Set([
  "Quotidian", "Very Common", "Common", "Uncommon", "Rare", "Extremely Rare",
  "Elusive", "Mythic", "Legend",
]);
const DAY_MS = 86400000;
/** No puzzle comes before the first drop (src/data/drops.json). */
const FIRST_PUZZLE = "2026-07-01";

interface MessageRow {
  id: number | string;
  handle: string;
  body: string;
  created_at: string;
  /** "message" for a player's message, "top" or "tier" for a notice. */
  kind?: string | null;
  /** A notice's tier as the game showed it; null for a message or an old notice. */
  tier?: string | null;
}

interface PostRow extends Partial<MessageRow> {
  status: string;
}

function reply(status: number, body?: unknown, cache = "no-store"): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cache,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

function toMessage(row: MessageRow) {
  const message = { id: Number(row.id), handle: row.handle, body: row.body, at: row.created_at };
  if (row.kind !== "top" && row.kind !== "tier") return message;
  return row.tier && TIERS.has(row.tier)
    ? { ...message, kind: row.kind, tier: row.tier }
    : { ...message, kind: row.kind };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request);
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST", "cache-control": "no-store" },
  });
}

/**
 * Today's puzzle for a request that names none: the date on a Mountain Time
 * wall clock, the calendar most of the players who are still on an old build
 * live near. Only a fallback -- a current client always says which puzzle.
 */
function defaultDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whether `date` names a puzzle with a room: from the first drop up to the
 * latest calendar anywhere has reached, which is a day ahead of UTC at most.
 */
function puzzleDate(date: string): boolean {
  if (!DATE_RE.test(date) || date < FIRST_PUZZLE) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return false;
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return at - today <= DAY_MS;
}

/** The room a request asks for, or null when what it named is not one. */
function roomFor(raw: unknown): string | null {
  if (raw === undefined || raw === null) return defaultDate();
  return typeof raw === "string" && puzzleDate(raw) ? raw : null;
}

async function handleGet(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const date = roomFor(params.get("date"));
  if (!date) return reply(400, { ok: false, reason: "bad-date" });
  if (params.has("latest")) return handleLatest(date);
  const raw = params.get("after") ?? "0";
  if (!AFTER_RE.test(raw)) return reply(400, { ok: false, reason: "bad-after" });
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<MessageRow[] | null>("chat_recent", {
      p_date: date,
      p_after: Number(raw),
      p_limit: PAGE,
    });
    return reply(
      200,
      { messages: (rows ?? []).map(toMessage) },
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
    );
  } catch (error: unknown) {
    console.error("[chat] read failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handleLatest(date: string): Promise<Response> {
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });
  try {
    // A fresh open of one message is the newest visible one.
    const rows = await rpc<MessageRow[] | null>("chat_recent", {
      p_date: date,
      p_after: 0,
      p_limit: 1,
    });
    const newest = rows?.[rows.length - 1];
    return reply(
      200,
      { latest: newest ? Number(newest.id) : 0 },
      "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
    );
  } catch (error: unknown) {
    console.error("[chat] latest failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

async function handlePost(request: Request): Promise<Response> {
  // Same-origin only when the caller declares an origin; see api/events.ts.
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
    return reply(400, { ok: false, reason: "malformed" });
  }

  const { playerId, body, banked, date: rawDate } = parsed as {
    playerId?: unknown;
    body?: unknown;
    banked?: unknown;
    date?: unknown;
  };
  if (typeof playerId !== "string" || !PLAYER_RE.test(playerId)) {
    return reply(400, { ok: false, reason: "bad-player" });
  }
  if (banked !== undefined) return handleBanked(playerId, banked);
  if (typeof body !== "string") return reply(400, { ok: false, reason: "bad-body" });
  const date = roomFor(rawDate);
  if (!date) return reply(400, { ok: false, reason: "bad-date" });

  const message = normaliseMessage(body);
  const problem = chatProblem(message);
  if (problem) return reply(422, { ok: false, reason: problem });

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<PostRow[] | null>("chat_post", {
      p_player: playerId,
      p_handle: handleFor(playerId),
      p_body: message,
      p_date: date,
    });
    const row = rows?.[0];
    if (row?.status === "rate-limited") return reply(429, { ok: false, reason: "rate-limited" });
    if (row?.status !== "ok" || row.id == null) throw new Error("chat_post answered nothing");
    return reply(201, { ok: true, message: toMessage(row as MessageRow) });
  } catch (error: unknown) {
    console.error("[chat] post failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}

/**
 * Whether `date` is a puzzle somebody could be playing live right now. Local
 * calendars run from a day behind UTC to a day ahead of it, and nothing outside
 * that is a live puzzle -- an archive day earns no notice.
 */
function livePuzzleDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return false;
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.abs(at - today) <= DAY_MS;
}

/** A banked word as the game reports it, or the reason it is not one. */
function readBanked(raw: unknown): BankedWord | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "bad-banked";
  const { date, mode, word, tier, score } = raw as Record<string, unknown>;
  if (typeof date !== "string" || !livePuzzleDate(date)) return "bad-date";
  if (mode !== "standard" && mode !== "freeform") return "bad-mode";
  if (typeof word !== "string" || !WORD_RE.test(word)) return "bad-word";
  if (typeof tier !== "string" || !TIERS.has(tier)) return "bad-tier";
  if (typeof score !== "string" || !SCORE_RE.test(score)) return "bad-score";
  return { date, mode, word, tier, score };
}

async function handleBanked(playerId: string, raw: unknown): Promise<Response> {
  const banked = readBanked(raw);
  if (typeof banked === "string") return reply(400, { ok: false, reason: banked });
  const handle = handleFor(playerId);
  const top = topNoticeBody(handle, banked);
  const usurp = usurpNoticeBody(handle, banked);
  const tier = tierNoticeBody(handle, banked);
  // Under 7.0 a word can be neither a top score nor a 9.5+, so there is nothing
  // to ask the database.
  if (!top) return reply(202, { ok: true, message: null });
  // A word the room would refuse from a player is not announced by the room
  // either -- the puzzle has its own blocklist, but this is the room's rule.
  if ([top, usurp, tier].some((line) => line && chatProblem(normaliseMessage(line)))) {
    return reply(202, { ok: true, message: null });
  }

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<PostRow[] | null>("chat_bank", {
      p_player: playerId,
      p_handle: handle,
      p_date: banked.date,
      p_mode: banked.mode,
      p_word: banked.word,
      p_score: Number(banked.score),
      p_tier: banked.tier,
      p_top_body: top,
      p_usurp_body: usurp,
      p_tier_body: tier,
    });
    const row = rows?.[0];
    if ((row?.status === "top" || row?.status === "tier") && row.id != null) {
      return reply(201, { ok: true, message: toMessage(row as MessageRow) });
    }
    return reply(202, { ok: true, message: null });
  } catch (error: unknown) {
    console.error("[chat] bank failed:", error instanceof Error ? error.message : error);
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
