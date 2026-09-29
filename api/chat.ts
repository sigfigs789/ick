// The chat room: a Vercel Edge Function that reads and posts the one shared room
// the chat bubble shows (src/components/ChatBubble.tsx).
//
// GET /api/chat?after=ID
//   -> 200 { messages: [{ id, handle, body, at }] }
//   Everything after message `after`, oldest first. `after` absent or 0 is a
//   fresh open and gets the newest page. The bubble polls this while it is open,
//   so it is CDN-cached for a couple of seconds: every open bubble asks for
//   nearly the same `after`, and one query can answer all of them.
//
// POST /api/chat   { playerId, body }
//   -> 201 { message }, 400 malformed, 422 { reason: "profane" | ... },
//      429 rate-limited, 503 no credentials
//   The handle is computed here from the id, never taken from the client, and
//   the id is never sent back out -- so the only way to post as somebody is to
//   know their id, which only their browser holds.
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

import { chatProblem, normaliseMessage } from "../src/game/chat";
import { handleFor } from "../src/game/handle";
import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

const MAX_BODY_BYTES = 4 * 1024;
const PAGE = 50;
/** A board id: the browser's UUID, or a Reddit username inside a post. */
const PLAYER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const AFTER_RE = /^\d{1,15}$/;

interface MessageRow {
  id: number | string;
  handle: string;
  body: string;
  created_at: string;
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
  return { id: Number(row.id), handle: row.handle, body: row.body, at: row.created_at };
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
  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  if (!AFTER_RE.test(raw)) return reply(400, { ok: false, reason: "bad-after" });
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<MessageRow[] | null>("chat_recent", {
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

  const { playerId, body } = parsed as { playerId?: unknown; body?: unknown };
  if (typeof playerId !== "string" || !PLAYER_RE.test(playerId)) {
    return reply(400, { ok: false, reason: "bad-player" });
  }
  if (typeof body !== "string") return reply(400, { ok: false, reason: "bad-body" });

  const message = normaliseMessage(body);
  const problem = chatProblem(message);
  if (problem) return reply(422, { ok: false, reason: problem });

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  try {
    const rows = await rpc<PostRow[] | null>("chat_post", {
      p_player: playerId,
      p_handle: handleFor(playerId),
      p_body: message,
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
