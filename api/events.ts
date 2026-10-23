// Analytics event mirror: a Vercel Edge Function that writes the events the game
// already sends to Vercel Analytics into Supabase as well, so they can be queried
// with SQL and kept past the dashboard's retention window.
//
// This endpoint is write-only and the game never waits on it -- the client posts
// with `sendBeacon` and ignores the result (see src/analytics.ts). Nothing about
// gameplay depends on it, so every failure here is silent to the player.
//
// POST /api/events   { "name": "answer_accepted", "props": { ... } }
//   -> 202 accepted, 400 malformed, 405 wrong method, 503 no credentials
//
// 202 rather than 204: the write may be handed to the runtime's `waitUntil` and
// finish after this response, so the endpoint can honestly say it accepted the
// event, never that the row landed.
//
// The service-role key stays server-side; it is never shipped to the browser.
// That is the whole reason this endpoint exists rather than the client writing to
// Supabase directly.

import { record, supabaseConfigured, type EdgeContext } from "./_supabase";
import { isBotUserAgent } from "../src/game/botUa";
import { isVercelRequest } from "../src/game/vercelHost";

export const config = { runtime: "edge" };

/** Event and property names are the game's own identifiers: snake_case, ASCII. */
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
// A public endpoint, so the shape is bounded before anything reaches the database.
const MAX_BODY_BYTES = 8 * 1024;
const MAX_PROPS = 32;
const MAX_VALUE_CHARS = 4000;

type PropValue = string | number | boolean | null;

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
 * Validate the properties of one event. Strict rather than lenient: a value of an
 * unexpected type means the client and this endpoint have drifted apart, and
 * saying so is more useful than quietly dropping a field and leaving a row that
 * looks complete. Long strings are the exception -- free-text feedback has no
 * length limit in the game, so the cap here is a bound on a public endpoint
 * rather than a drift signal, and truncating past it is the intended behaviour.
 */
function cleanProps(raw: unknown): Record<string, PropValue> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "props must be an object";
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PROPS) return `props has more than ${MAX_PROPS} keys`;
  const props: Record<string, PropValue> = {};
  for (const [key, value] of entries) {
    if (!NAME_RE.test(key)) return `bad prop name: ${key.slice(0, 32)}`;
    if (typeof value === "string") props[key] = value.slice(0, MAX_VALUE_CHARS);
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) return `bad prop value: ${key}`;
      props[key] = value;
    } else if (typeof value === "boolean" || value === null) props[key] = value;
    else return `bad prop value: ${key}`;
  }
  return props;
}

export default async function handler(request: Request, context?: EdgeContext): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  }

  // Same-origin only when the caller declares an origin, which every browser does
  // on a POST. It costs nothing and takes the endpoint off the list of things any
  // page on the web can post to.
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
    return reply(400, { ok: false, reason: "malformed-event" });
  }

  const { name, props } = parsed as { name?: unknown; props?: unknown };
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return reply(400, { ok: false, reason: "bad-name" });
  }
  const cleaned = cleanProps(props);
  if (typeof cleaned === "string") return reply(400, { ok: false, reason: cleaned });

  // Said plainly rather than answered with a silent 204: a deployment with no
  // credentials is a setup problem, and an empty table is a miserable way to
  // discover it. The client ignores this either way.
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });

  // A preview or *.vercel.app alias is the people building the game, not
  // players (see src/game/vercelHost.ts). Accepted and dropped, so the client
  // has nothing to retry.
  if (isVercelRequest(request)) return reply(202);

  // The request's own user agent, read here rather than trusted from the body:
  // a visit's client signals can be absent (an old bundle) or faked, the header
  // costs nothing to check, and only the verdict is stored, never the string.
  if (name === "site_visit") cleaned.server_bot_ua = isBotUserAgent(request.headers.get("user-agent"));

  await record("analytics_events", { name, props: cleaned }, context);
  return reply(202);
}
