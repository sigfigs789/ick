// Streak reminder subscriptions: a Vercel Edge Function behind the reminder card.
//
// POST /api/reminders { endpoint, playerId?, timeZone, riskDate | null }
//   -> 200 { ok: true }, 400 malformed, 403 cross-origin, 413 too-large,
//      503 no credentials or no table, 502 upstream unavailable.
//   Saves or refreshes one browser's push subscription. `riskDate` is the local
//   date the player's streak ends if unplayed, or null when it is safe.
// DELETE /api/reminders { endpoint } -> 200 { ok: true }, same errors.
//
// Not keyed, like the other player writes: the same-origin guard is the fence.
// The push has no payload, so a stolen endpoint can only trigger a generic
// reminder.

import { rpc, rpcMissing, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json" },
  });
}

function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

function validDate(date: unknown): date is string {
  return (
    typeof date === "string" && DATE_RE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  );
}

function validTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return reply(405, { ok: false, reason: "method" });
  }
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

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, reason: "too-large" });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { ok: false, reason: "malformed" });
  }
  if (!validEndpoint(body.endpoint)) return reply(400, { ok: false, reason: "bad-endpoint" });

  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "not-configured" });
  try {
    if (request.method === "DELETE") {
      await rpc("delete_push_subscription", { p_endpoint: body.endpoint });
      return reply(200, { ok: true });
    }
    const { playerId, timeZone, riskDate } = body;
    if (!validTimeZone(timeZone)) return reply(400, { ok: false, reason: "bad-time-zone" });
    if (riskDate !== null && !validDate(riskDate)) {
      return reply(400, { ok: false, reason: "bad-date" });
    }
    if (playerId !== undefined && playerId !== null && !(typeof playerId === "string" && UUID_RE.test(playerId))) {
      return reply(400, { ok: false, reason: "bad-player" });
    }
    await rpc("upsert_push_subscription", {
      p_endpoint: body.endpoint,
      p_player: playerId ?? null,
      p_time_zone: timeZone,
      p_risk_date: riskDate,
    });
    return reply(200, { ok: true });
  } catch (error) {
    if (rpcMissing(error)) return reply(503, { ok: false, reason: "not-migrated" });
    return reply(502, { ok: false, reason: "unavailable" });
  }
}
