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
  const { playerId, ...day } = {
    playerId: PLAYER,
    date: SUNDAY,
    word: "inkling",
    zipf: 2.9,
    total: 24.6,
    top: 9.4,
    words: 5,
    ...overrides,
  } as Record<string, unknown>;
  return { playerId, scores: [day] };
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
      // No name: the board derives it from the day's own rarest word.
      p_scores: [{ date: SUNDAY, word: "inkling", zipf: 2.9, total: 24.6, top: 9.4, words: 5 }],
    });
  });

  it("takes a whole history in one request", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const scores = Array.from({ length: 300 }, (_, i) => ({
      date: `2026-08-${String((i % 25) + 1).padStart(2, "0")}`,
      word: "inkling",
      zipf: 2.9,
      total: 12.5,
      top: 6.1,
      words: 3,
    }));
    const response = await handler(post({ playerId: PLAYER, scores }));

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
        scores: [
          { date: SUNDAY, word: "inkling", zipf: 2.9, total: 12, top: 6, words: 3 },
          { date: "2020-01-01", word: "inkling", zipf: 2.9, total: 12, top: 6, words: 3 },
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
    const response = await handler(post({ playerId: PLAYER, scores }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a batch longer than a browser could plausibly hold", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const scores = Array.from({ length: 801 }, () => ({
      date: SUNDAY,
      word: "inkling",
      zipf: 2.9,
      total: 1,
      top: 1,
      words: 1,
    }));
    const response = await handler(post({ playerId: PLAYER, scores }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "too-many-scores" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the day's word unaltered, however long it is", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(post(score({ word: "gastroenterologist" })));

    expect((rpcCall(fetchMock)?.args.p_scores as Record<string, unknown>[])[0].word).toBe(
      "gastroenterologist"
    );
  });

  it.each([
    ["a word with a space in it", "word smith"],
    ["a word with capitals", "Inkling"],
    ["a word with punctuation", "ink-ling"],
    ["a word with a digit", "ink1ing"],
    ["a word with an invisible character", "ink\u200bling"],
    ["a word with a bidi override", "\u202einkling"],
    ["a single letter", "a"],
    ["a word longer than the game accepts", "a".repeat(31)],
    ["an empty word", ""],
  ])("refuses %s", async (_label, word) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ word })));

    // These values are shown to other players, so anything that isn't a word is
    // rejected rather than trimmed into shape -- truncating would invent one.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-word" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a frequency far off the Zipf scale", 99],
    ["a frequency far below it", -99],
    ["a frequency that isn't a number", "rare"],
    ["a missing frequency", undefined],
  ])("refuses %s", async (_label, zipf) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ zipf })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-zipf" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a player id that isn't a uuid", { playerId: "mo" }, "bad-player-id"],
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
      { rank: 1, player_id: PLAYER, name: "asphyxiate", name_zipf: "2.09", window_word: "inkling", window_zipf: "2.9", total_score: "24.6", puzzles: 1 },
    ],
    allTime: [
      { rank: 1, player_id: PLAYER, name: "asphyxiate", name_zipf: "2.09", window_word: "asphyxiate", window_zipf: "2.09", total_score: "180.2", puzzles: 9 },
      { rank: 2, player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "quixotic", name_zipf: "2.33", window_word: "quixotic", window_zipf: "2.33", total_score: "90.0", puzzles: 5 },
    ],
    words: [
      { word: "asphyxiate", zipf: "2.09", finders: 3, found_on: "2026-08-25" },
      { word: "inkling", zipf: "2.9", finders: 1, found_on: "2026-08-24" },
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
      // The name is the player's rarest word ever; window_word is the rarest
      // inside this board's window, which on the weekly board is this week's
      // find. Scores are absent on purpose -- the client prices words itself.
      weekly: [
        {
          rank: 1,
          playerId: PLAYER,
          name: "asphyxiate",
          nameZipf: 2.09,
          windowWord: "inkling",
          windowZipf: 2.9,
          score: 24.6,
          puzzles: 1,
        },
      ],
      allTime: [
        {
          rank: 1,
          playerId: PLAYER,
          name: "asphyxiate",
          nameZipf: 2.09,
          windowWord: "asphyxiate",
          windowZipf: 2.09,
          score: 180.2,
          puzzles: 9,
        },
        {
          rank: 2,
          playerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "quixotic",
          nameZipf: 2.33,
          windowWord: "quixotic",
          windowZipf: 2.33,
          score: 90,
          puzzles: 5,
        },
      ],
      words: [
        { word: "asphyxiate", zipf: 2.09, finders: 3, foundOn: "2026-08-25" },
        { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-24" },
      ],
    });

    // One call for the gate and both boards, so the count can never disagree
    // with the rows beside it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_boards"
    );
    expect(rpcCall(fetchMock)?.args).toMatchObject({
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
    // Below the threshold the count is the whole answer, and there are no board
    // rows in the response for anyone to read out of a network tab.
    expect(await response.json()).toEqual({
      weekStart: SUNDAY,
      ready: false,
      players: 3,
      minPlayers: 10,
      weekly: [],
      allTime: [],
      words: [],
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

describe("api/leaderboard name changes", () => {
  function put(body: unknown, init: RequestInit = {}): Request {
    return new Request("https://wordink.app/api/leaderboard", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    });
  }

  it("asks the database to authorise the word against the player's own days", async () => {
    withEnv();
    const fetchMock = stubFetch([true]);
    const response = await handler(put({ playerId: PLAYER, name: "inkling" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, name: "inkling" });
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/choose_leaderboard_name"
    );
    expect(rpcCall(fetchMock)?.args).toEqual({ p_player_id: PLAYER, p_name: "inkling" });
  });

  it("refuses a word the player has never played", async () => {
    withEnv();
    stubFetch([false]);
    const response = await handler(put({ playerId: PLAYER, name: "asphyxiate" }));

    // 409 rather than 400: the request is well formed, it just names a word this
    // player did not earn -- which is the one thing this endpoint authorises.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "not-your-word" });
  });

  it.each([
    ["a player id that isn't a uuid", { playerId: "mo", name: "inkling" }, "bad-player-id"],
    ["a name that isn't a word", { playerId: PLAYER, name: "Ink Ling" }, "bad-word"],
    ["a name with an invisible character", { playerId: PLAYER, name: "ink\u200bling" }, "bad-word"],
    ["a missing name", { playerId: PLAYER }, "bad-word"],
  ])("refuses %s", async (_label, body, reason) => {
    withEnv();
    const fetchMock = stubFetch([true]);
    const response = await handler(put(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin rename", async () => {
    withEnv();
    const fetchMock = stubFetch([true]);
    const response = await handler(
      put(
        { playerId: PLAYER, name: "inkling" },
        { headers: { "content-type": "application/json", origin: "https://evil.test" } }
      )
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the deployment has no credentials", async () => {
    withEnv({});
    const response = await handler(put({ playerId: PLAYER, name: "inkling" }));

    expect(response.status).toBe(503);
  });
});

describe("api/leaderboard method handling", () => {
  it("turns away anything but GET, POST and PUT", async () => {
    withEnv();
    const response = await handler(
      new Request("https://wordink.app/api/leaderboard", { method: "DELETE" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, PUT");
  });
});

describe("api/leaderboard recent finds", () => {
  /** Today in UTC, the way the handler computes it. */
  function utcToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function daysBefore(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  }

  it("never publishes words from the caller's own today", async () => {
    withEnv();
    const fetchMock = stubFetch([{ ready: true, players: 12, minPlayers: 10, weekly: [], allTime: [], words: [] }]);
    const today = utcToday();
    await handler(get(`?since=${SUNDAY}&today=${today}`));

    // The same drop goes to everybody, so a word found today is an answer to
    // today's puzzle. The feed is strictly before the cutoff.
    expect(rpcCall(fetchMock)?.args.p_words_before).toBe(today);
    expect(rpcCall(fetchMock)?.args.p_words_since).toBe(daysBefore(today, 7));
  });

  it("believes a client that is behind UTC, so its own today stays hidden", async () => {
    withEnv();
    const fetchMock = stubFetch([{ ready: true, players: 12, minPlayers: 10, weekly: [], allTime: [], words: [] }]);
    // Late evening in the Americas: UTC has rolled over, the player has not.
    const behind = daysBefore(utcToday(), 1);
    await handler(get(`?since=${SUNDAY}&today=${behind}`));

    expect(rpcCall(fetchMock)?.args.p_words_before).toBe(behind);
  });

  it("caps a client claiming a date in the future", async () => {
    withEnv();
    const fetchMock = stubFetch([{ ready: true, players: 12, minPlayers: 10, weekly: [], allTime: [], words: [] }]);
    // Lying about the calendar to pull today's answers out early.
    await handler(get(`?since=${SUNDAY}&today=2099-01-01`));

    expect(rpcCall(fetchMock)?.args.p_words_before).toBe(utcToday());
  });

  it.each([
    ["a missing date", ""],
    ["a date that isn't one", "&today=whenever"],
    ["a malformed date", "&today=2026-13-45"],
  ])("falls back to UTC's today for %s", async (_label, param) => {
    withEnv();
    const fetchMock = stubFetch([{ ready: true, players: 12, minPlayers: 10, weekly: [], allTime: [], words: [] }]);
    await handler(get(`?since=${SUNDAY}${param}`));

    // The fallback is never wider than the truth.
    expect(rpcCall(fetchMock)?.args.p_words_before).toBe(utcToday());
  });

  it("returns the feed even while the boards are still gated", async () => {
    withEnv();
    stubFetch([
      {
        ready: false,
        players: 3,
        minPlayers: 10,
        weekly: [],
        allTime: [],
        words: [{ word: "inkling", zipf: "2.9", finders: 2, found_on: "2026-08-24" }],
      },
    ]);
    const response = await handler(get(`?since=${SUNDAY}&today=${utcToday()}`));
    const body = (await response.json()) as Record<string, unknown>;

    // A three-name board is embarrassing; three good words are not. The feed is
    // the best thing to show while the boards fill up.
    expect(body.ready).toBe(false);
    expect(body.words).toEqual([
      { word: "inkling", zipf: 2.9, finders: 2, foundOn: "2026-08-24" },
    ]);
  });
});
