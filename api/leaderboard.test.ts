import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./leaderboard";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const PLAYER = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";
// A Sunday, and the only date these tests use as a window start.
const SUNDAY = "2026-08-23";
// The month that Sunday falls in -- the monthly board's window, sent by the
// client alongside the week for the same reason (see src/game/month.ts).
const MONTH = "2026-08-01";

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
    // The word list the finds feed is built from. Held to exactly the rules the
    // day's rarest word is, and for a stronger reason: every one of these is
    // shown to other players verbatim.
    ["a word list that isn't a list", { found: "inkling" }, "bad-found"],
    ["a find that isn't an object", { found: ["inkling"] }, "bad-found"],
    ["more finds than a puzzle has ever allowed", {
      found: Array.from({ length: 7 }, (_, i) => ({ word: `word${"x".repeat(i)}`, zipf: 3 })),
    }, "too-many-found"],
    // A right-to-left override, which is the shape of the attack this pattern
    // exists to make unexpressible on a page anybody can post to.
    ["a find that isn't a word", { found: [{ word: "‮inkling", zipf: 3 }] }, "bad-found-word"],
    ["a find with no frequency", { found: [{ word: "inkling" }] }, "bad-found-zipf"],
    ["a find with an impossible frequency", { found: [{ word: "inkling", zipf: 99 }] }, "bad-found-zipf"],
    // This one decides whether a submission may *lower* a day, so a truthy
    // value that isn't a boolean is not close enough.
    ["a retry flag that isn't a boolean", { retried: "yes" }, "bad-retried"],
    ["a retry flag sent as a number", { retried: 1 }, "bad-retried"],
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
    weekly: [
      { rank: 1, player_id: PLAYER, window_word: "inkling", window_zipf: "2.9", total_score: "24.6", puzzles: 1 },
    ],
    allTime: [
      { rank: 1, player_id: PLAYER, window_word: "asphyxiate", window_zipf: "2.09", total_score: "180.2", puzzles: 9 },
      { rank: 2, player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", window_word: "quixotic", window_zipf: "2.33", total_score: "90.0", puzzles: 5 },
    ],
    words: [
      { word: "asphyxiate", zipf: "2.09", finders: 3, found_on: "2026-08-25" },
      { word: "inkling", zipf: "2.9", finders: 1, found_on: "2026-08-24" },
    ],
  };

  it("returns the long boards, with the ranks the database assigned", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&limit=10`));

    expect(response.status).toBe(200);
    // Cached briefly rather than not at all: a burst of opens costs one query.
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await response.json()).toEqual({
      weekStart: SUNDAY,
      // No day was asked for, so no day was queried: an empty board rather than
      // a missing key, so the page has one shape to read either way.
      daily: [],
      dailySelf: null,
      // No name: the client derives a handle from the player id. window_word is
      // the rarest word inside this board's window -- this week's find on the
      // weekly board. Scores are absent on purpose; the client prices words.
      weekly: [
        { rank: 1, playerId: PLAYER, windowWord: "inkling", windowZipf: 2.9, score: 24.6, puzzles: 1 },
      ],
      // Nobody asked who they were, so there is no row from below the cut.
      weeklySelf: null,
      allTimeSelf: null,
      allTime: [
        { rank: 1, playerId: PLAYER, windowWord: "asphyxiate", windowZipf: 2.09, score: 180.2, puzzles: 9 },
        {
          rank: 2,
          playerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          windowWord: "quixotic",
          windowZipf: 2.33,
          score: 90,
          puzzles: 5,
        },
      ],
      // Nobody won any of the closed windows in this fixture, and the endpoint
      // says so with a null rather than an absent key: the page has one shape
      // to read, whether or not there is a champion to put under a board. The
      // day's is null for a second reason -- no day was asked for, so there is
      // no day before it either.
      lastDay: null,
      lastWeek: null,
      lastMonth: null,
    });

    // One call for the two long boards, so they can never disagree with each
    // other -- and only one, because this request named no day. The feed is not
    // among them either: it is its own request, so that it can be cached for
    // every player rather than this one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_boards"
    );
    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_since: SUNDAY,
      p_limit: 10,
    });
  });

  it("counts one puzzle for the daily board, bounded at both ends by the day", async () => {
    withEnv();
    const fetchMock = stubFetch([
      OPEN,
      [{ rank: 1, player_id: PLAYER, window_word: "inkling", window_zipf: "2.9", total_score: "8.2", puzzles: 1 }],
    ]);
    const response = await handler(
      get(`?since=${SUNDAY}&month=${MONTH}&day=2026-08-25&limit=10`)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.daily).toEqual([
      { rank: 1, playerId: PLAYER, windowWord: "inkling", windowZipf: 2.9, score: 8.2, puzzles: 1 },
    ]);
    // The inner function the other two boards are built from, with the same
    // date at both ends: a day board is a week board over one day.
    expect(rpcCall(fetchMock, 1)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_board"
    );
    expect(rpcCall(fetchMock, 1)?.args).toEqual({
      p_since: "2026-08-25",
      p_until: "2026-08-25",
      p_limit: 10,
      p_player: null,
    });
  });

  it("drops a day that names no real puzzle rather than refusing the boards", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&day=1999-01-01`));

    // The two long boards are the older answer, and a caller that cannot have a
    // day board is better served with them than with a 400.
    expect(response.status).toBe(200);
    expect((await response.json()).daily).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for the boards unconditionally, with no opening date to wait for", async () => {
    withEnv();
    const fetchMock = stubFetch([{ weekly: [], allTime: [], words: [] }]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}&today=2026-08-25`));

    // The function still carries the gate parameter -- dropping it would mean
    // recreating the function mid-deploy -- so the endpoint holds it open.
    expect(rpcCall(fetchMock)?.args.p_open).toBe(true);
  });

  it("caps the row count a caller can ask for", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}&limit=100000`));

    expect(rpcCall(fetchMock)?.args.p_limit).toBe(200);
  });

  it("bounds the second board to the month the caller sent, at both ends", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}`));

    // The month and nothing either side of it: a July puzzle brought in by a
    // backfill is outside the window, and so is a score from the first hours of
    // September on a clock that is already there. The far end is this file's own
    // arithmetic -- the caller sends one date, so the two cannot disagree.
    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_season_since: "2026-08-01",
      p_season_until: "2026-08-31",
    });
  });

  it("bounds the weekly board to its own seven days", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}`));

    // The Saturday that closes the week the caller sent. It matters because the
    // page can step this board back through weeks that have finished, and an
    // unbounded window would answer "the week of the 23rd" with every score
    // since the 23rd. For the live week it changes nothing -- its Saturday is
    // today or later, and no puzzle exists past today.
    expect(rpcCall(fetchMock)?.args.p_week_until).toBe("2026-08-29");
  });

  it("ends a short month on its own last day", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=2026-06-28&month=2026-06-01`));

    expect(rpcCall(fetchMock)?.args.p_season_until).toBe("2026-06-30");
  });

  it("refuses a month that isn't the first of a real one", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    // Guessing would bound the board to a window nobody asked for, which is the
    // one failure this page cannot show.
    const response = await handler(get(`?since=${SUNDAY}&month=2026-08-15`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "bad-month" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a boards request with no month at all", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get(`?since=${SUNDAY}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "bad-month" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the champion of each closed window under the live boards", async () => {
    withEnv();
    const fetchMock = stubFetch([
      {
        ...OPEN,
        lastWeek: {
          rank: 1,
          player_id: PLAYER,
          window_word: "quixotic",
          window_zipf: "2.33",
          total_score: "61.2",
          puzzles: 7,
        },
        lastMonth: {
          rank: 1,
          player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          window_word: "inkling",
          window_zipf: "2.9",
          total_score: "214.8",
          puzzles: 28,
        },
      },
    ]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&today=2026-08-25`));
    const body = (await response.json()) as Record<string, unknown>;

    // Ordinary board rows, priced and named by the same client code every other
    // row goes through -- a champion is a board of one, not a new kind of thing.
    expect(body.lastWeek).toEqual({
      rank: 1,
      playerId: PLAYER,
      windowWord: "quixotic",
      windowZipf: 2.33,
      score: 61.2,
      puzzles: 7,
    });
    expect(body.lastMonth).toMatchObject({ rank: 1, score: 214.8, puzzles: 28 });

    // The champion's window is the monthly board's own window, one step back:
    // taken from `month`, not from `since` (the Sunday bracketing the 1st
    // belongs to the month before) and no longer from `today` either, now that
    // `month` is the one parameter that says which month the page is about.
    // August's board reports on the whole of July.
    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_month_since: "2026-07-01",
      p_month_until: "2026-07-31",
    });
  });

  it("bounds the champion to the month before the board's own, whatever `today` says", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    // `today` used to bound this window, which let the board and the plaque
    // under it name two different months -- a September board over "July's
    // champion" at a boundary, or whenever `today` was missing and UTC's own
    // day fell in another month. One parameter now decides both, so the pair
    // cannot disagree: a date from a different month is simply not consulted.
    await handler(get(`?since=${SUNDAY}&month=${MONTH}&today=2020-01-04`));

    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_month_since: "2026-07-01",
      p_month_until: "2026-07-31",
    });
  });

  it("ends the champion's month on its own last day, not on a fixed 31st", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    // A July board reports on June, which has thirty days. The arithmetic knows
    // no month lengths -- it steps back one day from the board's own first --
    // so a short month needs no case of its own.
    await handler(get(`?since=2026-06-28&month=2026-07-01`));

    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_month_since: "2026-06-01",
      p_month_until: "2026-06-30",
    });
  });

  it("shows fifteen rows when the caller doesn't say", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}`));

    expect(rpcCall(fetchMock)?.args.p_limit).toBe(15);
  });

  it("hands a player below the cut their own row, at its real rank", async () => {
    withEnv();
    const below = {
      rank: 61,
      player_id: PLAYER,
      window_word: "inkling",
      window_zipf: "2.9",
      total_score: "12.0",
      puzzles: 2,
    };
    const fetchMock = stubFetch([
      {
        // Two rows in a board of one: the second is the asking player, from
        // wherever they actually stand.
        weekly: [{ ...below, rank: 1, player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, below],
        allTime: [],
        words: [],
      },
    ]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&limit=1&player=${PLAYER}`));
    const body = (await response.json()) as Record<string, unknown>;

    expect(rpcCall(fetchMock)?.args.p_player).toBe(PLAYER);
    // Split on the rank rather than on the array's length, so the board keeps
    // exactly what it was asked for and the extra row is the player's own.
    expect(body.weekly).toHaveLength(1);
    expect(body.weeklySelf).toMatchObject({ rank: 61, playerId: PLAYER });
    // A board shorter than the cut has nobody underneath it: its last row is its
    // last row, not somebody hiding below.
    expect(body.allTimeSelf).toBeNull();
  });

  it("shows the board anyway when the player id is not one", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&player=not-a-uuid`));

    // Not knowing where somebody stands is a reason to show them the board, not
    // a reason to show them an error.
    expect(response.status).toBe(200);
    expect(rpcCall(fetchMock)?.args.p_player).toBeNull();
  });

  it("accepts the Sunday that brackets the game's first puzzle", async () => {
    withEnv();
    stubFetch([OPEN]);
    // The epoch fell on a Wednesday, so the week containing it starts before it.
    const response = await handler(get("?since=2026-06-28&month=2026-06-01"));

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
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}`));

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

describe("api/leaderboard recent finds", () => {
  /** Today in UTC, the way the handler computes it. */
  function utcToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function daysBefore(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  }

  it("asks for one puzzle's finds and nothing else", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const today = utcToday();
    await handler(get(`?words=1&today=${today}`));

    // Exactly the one day: from it, strictly before the next. This publishes
    // answers to the live puzzle, which is a deliberate call -- see `wordsDay`.
    expect(rpcCall(fetchMock)?.args.p_words_before).toBeUndefined();
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_words"
    );
    expect(rpcCall(fetchMock)?.args.p_before).toBe(daysBefore(today, -1));
    expect(rpcCall(fetchMock)?.args.p_since).toBe(today);
  });

  it("asks for the puzzle the player is on, not the one UTC is on", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    // Every American timezone reads a day behind UTC's for the last hours of
    // the UTC day -- an American evening, which is the busiest the game gets.
    // The feed used to take the later of the two dates, which asked for a
    // puzzle nobody in the Americas had reached yet and came back empty.
    const behind = daysBefore(utcToday(), 1);
    await handler(get(`?words=1&today=${behind}`));

    expect(rpcCall(fetchMock)?.args.p_since).toBe(behind);
    expect(rpcCall(fetchMock)?.args.p_before).toBe(utcToday());
  });

  it("asks for up to five hundred, which is a backstop and not a page", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(get(`?words=1&today=${utcToday()}`));

    expect(rpcCall(fetchMock)?.args.p_limit).toBe(500);
  });

  it("needs no week, no limit and no player, so every caller shares one answer", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    // No `since`, which the boards refuse outright -- this request is a
    // different question and carries none of their parameters.
    const response = await handler(get("?words=1"));

    expect(response.status).toBe(200);
    expect(Object.keys(rpcCall(fetchMock)?.args ?? {}).sort()).toEqual([
      "p_before",
      "p_limit",
      "p_since",
    ]);
  });

  it("includes today for a client whose calendar is ahead of UTC", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    // Already tomorrow in Auckland while UTC is still on today.
    const ahead = daysBefore(utcToday(), -1);
    await handler(get(`?words=1&today=${ahead}`));

    // Their own day counts as today, so the window reaches past it.
    expect(rpcCall(fetchMock)?.args.p_since).toBe(ahead);
    expect(rpcCall(fetchMock)?.args.p_before).toBe(daysBefore(ahead, -1));
  });

  it.each([
    ["a missing date", ""],
    ["a date that isn't one", "&today=whenever"],
    ["a malformed date", "&today=2026-13-45"],
    // Past the furthest ahead any local calendar can be, so no puzzle exists
    // for it. A caller cannot use this to read a drop the game has not reached.
    ["a date beyond any puzzle", "&today=2099-01-01"],
    ["a date before the first puzzle", "&today=2020-01-01"],
  ])("falls back to UTC's today for %s", async (_label, param) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(get(`?words=1${param}`));

    expect(rpcCall(fetchMock)?.args.p_since).toBe(utcToday());
    expect(rpcCall(fetchMock)?.args.p_before).toBe(daysBefore(utcToday(), -1));
  });

  it("returns the feed on its own, with no board query behind it", async () => {
    withEnv();
    stubFetch([[{ word: "inkling", zipf: "2.9", finders: 2, found_on: "2026-08-24" }]]);
    const response = await handler(get("?words=1&today=2026-08-25"));
    const body = (await response.json()) as Record<string, unknown>;

    // Its own request and its own function: the feed is identical for every
    // player, which is what lets it be cached for all of them at once.
    expect(body.words).toEqual([
      { word: "inkling", zipf: 2.9, finders: 2, foundOn: "2026-08-24" },
    ]);
  });

  it("is cached briefly, and for everybody at once", async () => {
    withEnv();
    stubFetch([[]]);
    const response = await handler(get("?words=1&today=2026-08-25"));

    // Short, because this cache and the page's poll add up rather than overlap:
    // a word waits out one and then the other before anybody sees it.
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    // And private caches get no lifetime at all. Without this the browser falls
    // back to heuristic freshness on a `public` 200 and can answer the page's
    // own poll from disk -- a feed that never changes until you reload.
    expect(response.headers.get("cache-control")).toContain("max-age=0");
    // And the stale window in proportion to it -- a long tail here is how old
    // an answer the first reader after expiry gets, which would undo the above.
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate=60");
  });

  it("answers a hand-asked refresh from its own cache key", async () => {
    withEnv();
    stubFetch([[]]);
    // The client sends `t` when a reader taps refresh (see game/leaderboard).
    // It is not read here -- it exists to be part of the URL, which is the
    // cache key -- so the response must be exactly the one without it.
    const response = await handler(get("?words=1&today=2026-08-25&t=123456"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ words: [] });
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
  });

  it("says unavailable rather than throwing when the read fails", async () => {
    withEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    const response = await handler(get("?words=1&today=2026-08-25"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("api/leaderboard retried days", () => {
  it("passes the retry flag through to the write", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ retried: true })));

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toEqual([
      { date: SUNDAY, word: "inkling", zipf: 2.9, total: 24.6, top: 9.4, words: 5, retried: true },
    ]);
  });

  it("leaves the flag off an ordinary day rather than sending the default", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(post(score({ retried: false })));

    // Absent means false to the write, so saying it would put a field on every
    // submission ever made to state the ordinary case.
    const [sent] = rpcCall(fetchMock)?.args.p_scores as Record<string, unknown>[];
    expect(sent).not.toHaveProperty("retried");
  });

  it("takes a day that got smaller, which is the whole point of the flag", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    // A four-word day retried down to three: fewer words and a lower total than
    // the same day would have sent a moment earlier.
    const response = await handler(
      post(score({ retried: true, total: 12.1, top: 6.1, words: 3 }))
    );

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toMatchObject([
      { retried: true, total: 12.1, words: 3 },
    ]);
  });
});
