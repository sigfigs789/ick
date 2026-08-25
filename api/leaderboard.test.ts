import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./leaderboard";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const PLAYER = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";
// A Monday, and the only date these tests use as a window start.
const MONDAY = "2026-08-24";

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

/** A valid submission, with any field overridable per test. */
function score(overrides: Record<string, unknown> = {}) {
  return {
    playerId: PLAYER,
    name: "Mo",
    date: MONDAY,
    total: 24.6,
    top: 9.4,
    words: 5,
    ...overrides,
  };
}

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://wordink.app/api/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function get(query: string): Request {
  return new Request(`https://wordink.app/api/leaderboard${query}`);
}

/** Stub the PostgREST call the handler makes, one reply per invocation. */
function stubFetch(replies: unknown[] = [[], []]) {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    if (reply instanceof Error) throw reply;
    if (typeof reply === "number") return new Response("boom", { status: reply });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The arguments the handler sent to the named Postgres function. */
function rpcCall(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = (fetchMock.mock.calls[index] ?? []) as [string?, RequestInit?];
  if (!url) return null;
  return { url, args: JSON.parse(String(init?.body ?? "null")) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/leaderboard submissions", () => {
  it("records a score through the upsert function", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score()));

    expect(response.status).toBe(202);
    const call = rpcCall(fetchMock);
    expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/submit_leaderboard_score");
    expect(call?.args).toEqual({
      p_player_id: PLAYER,
      p_puzzle_date: MONDAY,
      p_display_name: "Mo",
      p_total_score: 24.6,
      p_top_score: 9.4,
      p_words: 5,
    });
  });

  it("normalises the display name it stores", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(post(score({ name: "  word   smith  " })));

    expect(rpcCall(fetchMock)?.args.p_display_name).toBe("word smith");
  });

  it("truncates a name past the length the board shows", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(post(score({ name: "a".repeat(50) })));

    expect(rpcCall(fetchMock)?.args.p_display_name).toBe("a".repeat(18));
  });

  it.each([
    ["a player id that isn't a uuid", { playerId: "mo" }, "bad-player-id"],
    ["a name with nothing in it", { name: "  " }, "bad-name"],
    ["a puzzle date before the game existed", { date: "2020-01-01" }, "bad-date"],
    ["a puzzle date that isn't a date", { date: "yesterday" }, "bad-date"],
    ["a total above the highest possible puzzle", { total: 61, words: 6 }, "bad-total"],
    ["a single word scoring above 10", { top: 11, total: 11 }, "bad-top"],
    ["a fractional word count", { words: 2.5 }, "bad-words"],
    ["no words at all", { words: 0, total: 0, top: 0 }, "bad-words"],
    ["a top score above the total", { total: 3, top: 9.4 }, "inconsistent-scores"],
    ["a total no number of words could reach", { total: 45, top: 9.9, words: 4 }, "inconsistent-scores"],
  ])("refuses %s", async (_label, overrides, reason) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score(overrides)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason });
    // Nothing reached the database: a refused score is not a stored score.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(
      post(score(), { headers: { "content-type": "application/json", origin: "https://evil.test" } })
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the deployment has no credentials", async () => {
    withEnv({});
    const response = await handler(post(score()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unconfigured" });
  });
});

describe("api/leaderboard reads", () => {
  it("returns both boards, weekly windowed and all-time open", async () => {
    withEnv();
    const fetchMock = stubFetch([
      [{ player_id: PLAYER, display_name: "Mo", total_score: "24.6", best_score: "9.4", puzzles: 1 }],
      [
        { player_id: PLAYER, display_name: "Mo", total_score: "180.2", best_score: "9.9", puzzles: 9 },
        { player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", display_name: "Ada", total_score: "90.0", best_score: "8.1", puzzles: 5 },
      ],
    ]);
    const response = await handler(get(`?since=${MONDAY}&limit=10`));

    expect(response.status).toBe(200);
    // Cached briefly rather than not at all: a burst of opens costs one query.
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await response.json()).toEqual({
      weekStart: MONDAY,
      weekly: [{ playerId: PLAYER, name: "Mo", score: 24.6, best: 9.4, puzzles: 1 }],
      allTime: [
        { playerId: PLAYER, name: "Mo", score: 180.2, best: 9.9, puzzles: 9 },
        { playerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Ada", score: 90, best: 8.1, puzzles: 5 },
      ],
    });

    expect(rpcCall(fetchMock, 0)?.args).toEqual({ p_since: MONDAY, p_limit: 10 });
    expect(rpcCall(fetchMock, 1)?.args).toEqual({ p_since: null, p_limit: 10 });
  });

  it("caps the row count a caller can ask for", async () => {
    withEnv();
    const fetchMock = stubFetch();
    await handler(get(`?since=${MONDAY}&limit=100000`));

    expect(rpcCall(fetchMock, 0)?.args.p_limit).toBe(200);
  });

  it("accepts the Monday that brackets the game's first puzzle", async () => {
    withEnv();
    stubFetch();
    // The epoch fell on a Wednesday, so the week containing it starts before it.
    const response = await handler(get("?since=2026-06-29"));

    expect(response.status).toBe(200);
  });

  it("refuses a window start it can't make sense of", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(get("?since=last-monday"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-since" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unavailable board rather than an empty one", async () => {
    withEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([500]);
    const response = await handler(get(`?since=${MONDAY}`));

    // A 502 and no rows, so the client can say "couldn't load" -- an empty 200
    // would read to the player as "nobody has played".
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("api/leaderboard method handling", () => {
  it("turns away anything but GET and POST", async () => {
    withEnv();
    const response = await handler(
      new Request("https://wordink.app/api/leaderboard", { method: "DELETE" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });
});
