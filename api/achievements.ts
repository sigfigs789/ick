// How many players hold each achievement, for the line under every badge on the
// Stats page ("24% of players").
//
// GET /api/achievements
//   -> 200 { players, earned: { [id]: count } }, 503 no credentials or a failed read
//
// The badges reach the server with every score the game posts (see
// api/leaderboard.ts); `achievement_rates` counts them against every player who
// has ever guessed. Cached at the edge for a few minutes: the share moves by a
// player at a time, and nobody is waiting on it mid-puzzle. The page falls
// back to its bundled snapshot when this fails (see src/game/achievements.ts).

import { rpc, supabaseConfigured } from "./_supabase";

export const config = { runtime: "edge" };

const CACHE_SECONDS = 300;

interface Rates {
  players: number;
  earned: Record<string, number>;
}

function reply(status: number, body: unknown, cache = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cache
        ? `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`
        : "no-store",
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
  }
  if (!supabaseConfigured()) return reply(503, { ok: false, reason: "unconfigured" });
  try {
    const rates = await rpc<Rates>("achievement_rates", {});
    return reply(200, { players: Number(rates.players) || 0, earned: rates.earned ?? {} }, true);
  } catch (error) {
    console.error("[achievements] read failed:", error instanceof Error ? error.message : error);
    return reply(503, { ok: false, reason: "read-failed" });
  }
}
