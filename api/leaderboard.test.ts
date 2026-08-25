import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./leaderboard";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const PLAYER = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";
// A Sunday, and the only date these tests use as a window start.
const SUNDAY = "2026-08-23";

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

/** A valid one-day submission, with any score field overridable per test. */
function score(overrides: Record<string, unknown> = {}) {
  const { playerId, name, ...day } = {
    playerId: PLAYER,
    name: "Mo",
    date: SUNDAY,
    total: 24.6,
    top: 9.4,
    words: 5,
    ...overrides,
  } as Record<string, unknown>;
  return { playerId, name, scores: [day] };
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
    expect(await response.json()).toEqual({ ok: true, days: 1 });
    const call = rpcCall(fetchMock);
    expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/submit_leaderboard_scores");
    expect(call?.args).toEqual({
      p_player_id: PLAYER,
      p_display_name: "Mo",
      p_scores: [{ date: SUNDAY, total: 24.6, top: 9.4, words: 5 }],
    });
  });

  it("takes a whole history in one request", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const scores = Array.from({ length: 300 }, (_, i) => ({
      date: `2026-08-${String((i % 25) + 1).padStart(2, "0")}`,
      total: 12.5,
      top: 6.1,
      words: 3,
    }));
    const response = await handler(post({ playerId: PLAYER, name: "Mo", scores }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, days: 300 });
    // One round trip for the batch: a year of daily puzzles must not be a year
    // of writes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((rpcCall(fetchMock)?.args.p_scores as unknown[]).length).toBe(300);
  });

  it("fails the whole batch on one bad day rather than writing part of it", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(
      post({
        playerId: PLAYER,
        name: "Mo",
        scores: [
          { date: SUNDAY, total: 12, top: 6, words: 3 },
          { date: "2020-01-01", total: 12, top: 6, words: 3 },
        ],
      })
    );

    // A partial write would leave the client believing it submitted a history it
    // didn't.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-date" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty batch", [], "no-scores"],
    ["a batch that isn't a list", "all of them", "bad-scores"],
    ["a day that isn't an object", [1], "malformed-score"],
  ])("refuses %s", async (_label, scores, reason) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post({ playerId: PLAYER, name: "Mo", scores }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a batch longer than a browser could plausibly hold", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const scores = Array.from({ length: 801 }, () => ({
      date: SUNDAY,
      total: 1,
      top: 1,
      words: 1,
    }));
    const response = await handler(post({ playerId: PLAYER, name: "Mo", scores }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "too-many-scores" });
    expect(fetchMock).not.toHaveBeenCalled();
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
  const OPEN = {
    ready: true,
    players: 14,
    minPlayers: 10,
    weekly: [
      { rank: 1, player_id: PLAYER, display_name: "Mo", total_score: "24.6", best_score: "9.4", puzzles: 1 },
    ],
    allTime: [
      { rank: 1, player_id: PLAYER, display_name: "Mo", total_score: "180.2", best_score: "9.9", puzzles: 9 },
      { rank: 2, player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", display_name: "Ada", total_score: "90.0", best_score: "8.1", puzzles: 5 },
    ],
  };

  it("returns both boards, with the ranks the database assigned", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get(`?since=${SUNDAY}&limit=10`));

    expect(response.status).toBe(200);
    // Cached briefly rather than not at all: a burst of opens costs one query.
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await response.json()).toEqual({
      weekStart: SUNDAY,
      ready: true,
      players: 14,
      minPlayers: 10,
      weekly: [{ rank: 1, playerId: PLAYER, name: "Mo", score: 24.6, best: 9.4, puzzles: 1 }],
      allTime: [
        { rank: 1, playerId: PLAYER, name: "Mo", score: 180.2, best: 9.9, puzzles: 9 },
        { rank: 2, playerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Ada", score: 90, best: 8.1, puzzles: 5 },
      ],
    });

    // One call for the gate and both boards, so the count can never disagree
    // with the rows beside it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_boards"
    );
    expect(rpcCall(fetchMock)?.args).toEqual({
      p_since: SUNDAY,
      p_limit: 10,
      p_min_players: 10,
    });
  });

  it("passes the ten-player threshold down to the query", async () => {
    withEnv();
    const fetchMock = stubFetch([{ ready: false, players: 3, minPlayers: 10, weekly: [], allTime: [] }]);
    const response = await handler(get(`?since=${SUNDAY}`));

    expect(rpcCall(fetchMock)?.args.p_min_players).toBe(10);
    // Below the threshold the count is the whole answer, and there are no rows
    // in the response for anyone to read out of a network tab.
    expect(await response.json()).toEqual({
      weekStart: SUNDAY,
      ready: false,
      players: 3,
      minPlayers: 10,
      weekly: [],
      allTime: [],
    });
  });

  it("caps the row count a caller can ask for", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&limit=100000`));

    expect(rpcCall(fetchMock)?.args.p_limit).toBe(200);
  });

  it("accepts the Sunday that brackets the game's first puzzle", async () => {
    withEnv();
    stubFetch([OPEN]);
    // The epoch fell on a Wednesday, so the week containing it starts before it.
    const response = await handler(get("?since=2026-06-28"));

    expect(response.status).toBe(200);
  });

  it("refuses a window start it can't make sense of", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get("?since=last-sunday"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-since" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unavailable board rather than an empty one", async () => {
    withEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([500]);
    const response = await handler(get(`?since=${SUNDAY}`));

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
