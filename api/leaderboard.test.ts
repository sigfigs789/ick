/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import handler, { MAX_LIMIT, MIN_RANKED_VERSION } from "./leaderboard";
import { APP_VERSION } from "../src/version";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const PLAYER = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";
const OTHER_TOTAL = "9e8d7c6b-5a49-4382-9716-0a1b2c3d4e5f";
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
  const { playerId, version, ...day } = {
    playerId: PLAYER,
    version: APP_VERSION,
    date: SUNDAY,
    word: "inkling",
    zipf: 2.9,
    total: 24.6,
    top: 9.4,
    words: 5,
    ...overrides,
  } as Record<string, unknown>;
  return { playerId, version, scores: [day] };
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
  it("keeps a *.vercel.app host's scores off the board", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(
      new Request("https://ick-git-branch-sigfigs789.vercel.app/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(score()),
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, days: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
      // No name: the board derives it from the day's own rarest word. The mode
      // is filled in on the way through -- absent means Standard, which is what
      // every submission sent before there were two boards meant.
      p_scores: [
        {
          date: SUNDAY,
          word: "inkling",
          zipf: 2.9,
          total: 24.6,
          top: 9.4,
          words: 5,
          mode: "standard",
        },
      ],
    });
  });

  it("records the game's own streak beside the scores", async () => {
    withEnv();
    const fetchMock = stubFetch([[], []]);
    const streak = { current: 40, best: 52, saved: 2, lastPlayed: SUNDAY };
    const response = await handler(post({ ...score(), streak }));

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock, 1)).toEqual({
      url: "https://project.supabase.co/rest/v1/rpc/submit_leaderboard_streak",
      args: {
        p_player_id: PLAYER,
        p_current: 40,
        p_best: 52,
        p_saved: 2,
        p_last_played: SUNDAY,
        p_rest_day: null,
      },
    });
  });

  it("records the Saturday off only when it ends the last played day's week", async () => {
    withEnv();
    // SUNDAY's week ends on 2026-08-29.
    for (const [restDay, expected] of [
      ["2026-08-29", "2026-08-29"],
      ["2026-09-05", null], // a later Saturday, which no play has earned
      ["2026-08-22", null], // before the last played day
      ["soon", null],
    ]) {
      const fetchMock = stubFetch([[], []]);
      const streak = { current: 40, best: 52, saved: 2, lastPlayed: SUNDAY, restDay };
      await handler(post({ ...score(), streak }));
      expect(rpcCall(fetchMock, 1)?.args).toMatchObject({ p_rest_day: expected });
    }
  });

  it("drops a streak that does not add up and keeps the scores", async () => {
    withEnv();
    for (const streak of [
      { current: 5, best: 4, saved: 0, lastPlayed: SUNDAY }, // best below current
      { current: 5, best: 5, saved: 5, lastPlayed: SUNDAY }, // more saved than the cap and one made up
      { current: 500, best: 500, saved: 0, lastPlayed: SUNDAY }, // longer than there have been puzzles
      { current: 5, best: 5, saved: 0, lastPlayed: "2026-13-01" },
    ]) {
      const fetchMock = stubFetch([[], []]);
      const response = await handler(post({ ...score(), streak }));
      expect(response.status).toBe(202);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(rpcCall(fetchMock)?.url).toContain("submit_leaderboard_scores");
    }
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
    const response = await handler(post({ playerId: PLAYER, version: APP_VERSION, scores }));

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
        version: APP_VERSION,
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
    const response = await handler(post({ playerId: PLAYER, version: APP_VERSION, scores }));

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
    const response = await handler(post({ playerId: PLAYER, version: APP_VERSION, scores }));

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
    // Decides whether the day reaches the board at all.
    ["an unranked flag that isn't a boolean", { unranked: "yes" }, "bad-unranked"],
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
      // window_date is the puzzle the window word came from, so the client can
      // price it by that day's rules; the allTime rows below predate the column.
      { rank: 1, player_id: PLAYER, window_word: "inkling", window_zipf: "2.9", total_score: "24.6", puzzles: 1, window_date: "2026-08-25" },
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
      // Which of the two boards these rows are, echoed back rather than left to
      // the caller to remember -- the request named none, so this is the answer
      // to a question it did not ask.
      mode: "standard",
      // No day was asked for, so no day was queried: an empty board rather than
      // a missing key, so the page has one shape to read either way.
      daily: [],
      dailySelf: null,
      // No name: the client derives a handle from the player id. window_word is
      // the rarest word inside this board's window -- this week's find on the
      // weekly board. Scores are absent on purpose; the client prices words.
      weekly: [
        { rank: 1, playerId: PLAYER, windowWord: "inkling", windowZipf: 2.9, windowDate: "2026-08-25", score: 24.6, puzzles: 1 },
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
      p_mode: "standard",
    });
  });

  it("adds the streak board when asked, counted up to the reader's today", async () => {
    withEnv();
    const fetchMock = stubFetch([
      OPEN,
      [
        {
          rank: 1,
          player_id: PLAYER,
          current_streak: 15,
          best_streak: 20,
          frozen: true,
          covered: true,
          at_risk: false,
        },
        {
          rank: 2,
          player_id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          current_streak: 9,
          best_streak: 9,
          covered: true,
          at_risk: true,
        },
        // A database from before at_risk: covered was what it called at risk.
        {
          rank: 3,
          player_id: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          current_streak: 4,
          best_streak: 4,
          covered: true,
        },
        // Out of freezes with a missed day to make up: still ranked.
        {
          rank: 4,
          place: 4,
          player_id: "eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          current_streak: 3,
          best_streak: 3,
          frozen: false,
          covered: false,
          at_risk: false,
          endangered: true,
        },
        // A lost run: placed by its length, ranked nowhere.
        {
          rank: null,
          place: 5,
          player_id: "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          current_streak: 3,
          best_streak: 6,
          frozen: false,
          covered: false,
          at_risk: false,
          lost: true,
        },
        { rank: 140, player_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", current_streak: 1, best_streak: 3 },
      ],
    ]);
    const response = await handler(
      get(`?since=${SUNDAY}&month=${MONTH}&today=2026-08-25&streak=1&limit=10&mode=freeform`)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.streak).toEqual([
      { rank: 1, playerId: PLAYER, current: 15, best: 20, frozen: true, covered: true },
      {
        rank: 2,
        playerId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        current: 9,
        best: 9,
        covered: true,
        atRisk: true,
      },
      {
        rank: 3,
        playerId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        current: 4,
        best: 4,
        covered: true,
        atRisk: true,
      },
      {
        rank: 4,
        playerId: "eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        current: 3,
        best: 3,
        endangered: true,
      },
      { rank: null, playerId: "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee", current: 3, best: 6, lost: true },
    ]);
    expect(body.streakSelf).toMatchObject({ rank: 140, current: 1, best: 3 });
    // No mode: a day played either way keeps a streak alive.
    expect(rpcCall(fetchMock, 1)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_streaks"
    );
    expect(rpcCall(fetchMock, 1)?.args).toEqual({
      p_today: "2026-08-25",
      p_limit: 10,
      p_player: null,
    });
  });

  it("loses only the streak board when its read fails", async () => {
    withEnv();
    stubFetch([OPEN, 404]);
    const response = await handler(get(`?since=${SUNDAY}&month=${MONTH}&streak=1`));

    // A deploy that lands before the migration costs the board that is not
    // there yet, and nothing else.
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.streak).toEqual([]);
    expect(body.allTime).toHaveLength(2);
  });

  it("returns the puzzles-played board on its own, with the reader's row below the cut", async () => {
    withEnv();
    const fetchMock = stubFetch([
      [
        { rank: 1, player_id: OTHER_TOTAL, puzzles: 40, first_played: "2026-07-01", last_played: "2026-08-24" },
        { rank: 1000, player_id: PLAYER, puzzles: 1, first_played: "2026-08-25", last_played: "2026-08-25" },
      ],
    ]);
    const response = await handler(get(`?total=1&player=${PLAYER}`));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.total).toEqual([
      { rank: 1, playerId: OTHER_TOTAL, puzzles: 40, firstPlayed: "2026-07-01", lastPlayed: "2026-08-24" },
    ]);
    expect(body.totalSelf).toEqual({
      rank: 1000,
      playerId: PLAYER,
      puzzles: 1,
      firstPlayed: "2026-08-25",
      lastPlayed: "2026-08-25",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_total_played"
    );
    expect(rpcCall(fetchMock)?.args).toEqual({ p_limit: 999, p_player: PLAYER });
  });

  it("reports a failed puzzles-played read as unavailable", async () => {
    withEnv();
    stubFetch([404]);
    const response = await handler(get("?total=1"));
    expect(response.status).toBe(502);
  });

  it("returns the dead-streaks board on its own, counted up to the reader's today", async () => {
    withEnv();
    const fetchMock = stubFetch([
      [
        { rank: 1, player_id: PLAYER, lost_streak: 4, best_streak: 12, last_played: "2026-08-20", days_played: 30 },
      ],
    ]);
    const response = await handler(get("?dead=1&today=2026-08-25"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.deadStreaks).toEqual([
      { rank: 1, playerId: PLAYER, lost: 4, best: 12, lastPlayed: "2026-08-20", days: 30 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_dead_streaks"
    );
    expect(rpcCall(fetchMock)?.args).toEqual({ p_today: "2026-08-25", p_limit: 100 });
  });

  it("reports a failed dead-streaks read as unavailable", async () => {
    withEnv();
    stubFetch([404]);
    const response = await handler(get("?dead=1&today=2026-08-25"));
    expect(response.status).toBe(502);
  });

  it("runs no streak query for a caller that did not ask for one", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    await handler(get(`?since=${SUNDAY}&month=${MONTH}&today=2026-08-25`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    expect(rpcCall(fetchMock)?.args.p_limit).toBe(999);
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

  it("bounds the month window it sends from the board's own, whatever `today` says", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    // The pair `leaderboard_boards` takes for the month before the board's own
    // (see `previousMonth`). `today` used to bound it, which let one request
    // name two different months -- whenever UTC's own day fell in another one.
    // `month` decides it alone now, so a date from a different month is simply
    // not consulted.
    await handler(get(`?since=${SUNDAY}&month=${MONTH}&today=2020-01-04`));

    expect(rpcCall(fetchMock)?.args).toMatchObject({
      p_month_since: "2026-07-01",
      p_month_until: "2026-07-31",
    });
  });

  it("ends that month on its own last day, not on a fixed 31st", async () => {
    withEnv();
    const fetchMock = stubFetch([OPEN]);
    // A July board steps back to June, which has thirty days. The arithmetic knows
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

  it("sends a player past a full board back as their own row, not a board row", async () => {
    withEnv();
    const row = (rank: number, id: string) => ({
      rank,
      player_id: id,
      window_word: "zephyr",
      window_zipf: 1.5,
      total_score: 5,
      puzzles: 1,
    });
    // The whole board, as the page asks for it, and the asking player under it.
    const board = Array.from({ length: MAX_LIMIT }, (_, index) =>
      row(index + 1, `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`)
    );
    stubFetch([
      {
        weekly: [...board, row(MAX_LIMIT + 438, PLAYER)],
        allTime: [],
        words: [],
      },
    ]);
    const response = await handler(
      get(`?since=${SUNDAY}&month=${MONTH}&limit=${MAX_LIMIT}&player=${PLAYER}`)
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.weekly).toHaveLength(MAX_LIMIT);
    expect(body.weeklySelf).toMatchObject({ rank: MAX_LIMIT + 438, playerId: PLAYER });
  });

  it("caps rows where the database does, so nobody under the cut reads as on the board", async () => {
    // The newest migration that defines `leaderboard_board` is the one live.
    // If its clamp were lower than MAX_LIMIT, a player ranked between the two
    // would come back inside the board with no gap above them.
    const migrations = import.meta.glob<string>("../supabase/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const latest = Object.keys(migrations)
      .sort()
      .map((name) => migrations[name])
      .filter((sql) => /function public\.leaderboard_board\(/.test(sql))
      .at(-1);
    const clamp = latest?.match(/coalesce\(p_limit, 15\), 1\), (\d+)\)/)?.[1];

    expect(Number(clamp)).toBe(MAX_LIMIT);
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

  it.each([
    // Past the furthest ahead any local calendar can be, so no puzzle exists
    // for it. A caller cannot use this to read a drop the game has not reached
    // -- and must not be handed today's words under that day's heading instead.
    ["a date beyond any puzzle", "2099-01-01"],
    ["a date four days ahead", "FOUR_AHEAD"],
    ["a date before the first puzzle", "2020-01-01"],
  ])("answers an empty feed for %s, without asking the database", async (_label, day) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const date = day === "FOUR_AHEAD" ? daysBefore(utcToday(), -4) : day;
    const response = await handler(get(`?words=1&today=${date}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ words: [] });
    expect(rpcCall(fetchMock)).toBeNull();
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

describe("api/leaderboard word finders", () => {
  it("asks for one word's finders on one puzzle and passes their ids through", async () => {
    withEnv();
    const fetchMock = stubFetch([[{ player_id: "a" }, { player_id: "b" }]]);
    const response = await handler(get("?finders=inkling&today=2026-08-25"));

    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_word_finders"
    );
    expect(rpcCall(fetchMock)?.args).toMatchObject({ p_date: "2026-08-25", p_word: "inkling" });
    expect(await response.json()).toEqual({ finders: ["a", "b"] });
  });

  it("refuses anything that isn't a word", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(get("?finders=DROP%20TABLE&today=2026-08-25"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("api/leaderboard best-word wins", () => {
  it("asks for the tally before one puzzle and hands it back by player", async () => {
    withEnv();
    const fetchMock = stubFetch([
      [
        { player_id: "AAAA", wins: 3 },
        { player_id: "bbbb", wins: "1" },
      ],
    ]);
    const response = await handler(get("?bestWins=1&today=2026-08-25"));

    expect(rpcCall(fetchMock)?.url).toBe(
      "https://project.supabase.co/rest/v1/rpc/leaderboard_best_word_wins"
    );
    expect(rpcCall(fetchMock)?.args).toEqual({ p_before: "2026-08-25" });
    expect(await response.json()).toEqual({ wins: { aaaa: 3, bbbb: 1 } });
  });
});

describe("api/leaderboard unranked days", () => {
  it("passes the unranked flag through, so the write keeps the day off the board", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(
      post(score({ unranked: true, found: [{ word: "inkling", zipf: 2.9 }] }))
    );

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toEqual([
      {
        date: SUNDAY,
        word: "inkling",
        zipf: 2.9,
        total: 24.6,
        top: 9.4,
        words: 5,
        mode: "standard",
        unranked: true,
        found: [{ word: "inkling", zipf: 2.9 }],
      },
    ]);
  });
});

describe("api/leaderboard find modes", () => {
  it("says when no finder banked a word in Standard, and only then", async () => {
    withEnv();
    stubFetch([
      [
        { word: "aforetime", zipf: "1.2", finders: 1, found_on: "2026-09-20", standard: false },
        { word: "inkling", zipf: "2.9", finders: 2, found_on: "2026-09-20", standard: true },
        { word: "wrinkle", zipf: "3.6", finders: 1, found_on: "2026-09-20" },
      ],
    ]);
    const response = await handler(get("?words=1&today=2026-09-20"));
    const body = (await response.json()) as { words: Record<string, unknown>[] };
    expect(body.words.map((word) => word.standard)).toEqual([false, undefined, undefined]);
  });
});

describe("api/leaderboard client versions", () => {
  it("can never set a floor the current release is below", () => {
    // Above APP_VERSION, nobody -- not even the website -- would rank.
    expect(MIN_RANKED_VERSION).toBeLessThanOrEqual(APP_VERSION);
  });

  it("ranks a client at the floor as it always has", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    await handler(post(score({ version: MIN_RANKED_VERSION })));

    const [day] = rpcCall(fetchMock)?.args.p_scores as Record<string, unknown>[];
    expect(day).not.toHaveProperty("unranked");
  });

  it.each([
    ["one below the floor", { version: MIN_RANKED_VERSION - 1 }],
    // Every client from before the field, which includes the phone app's build 7.
    ["no version at all", { version: undefined }],
  ])("keeps a client with %s off the board, but its words on the feed", async (_label, overrides) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(
      post(score({ ...overrides, found: [{ word: "inkling", zipf: 2.9 }] }))
    );

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toEqual([
      {
        date: SUNDAY,
        word: "inkling",
        zipf: 2.9,
        total: 24.6,
        top: 9.4,
        words: 5,
        mode: "standard",
        unranked: true,
        found: [{ word: "inkling", zipf: 2.9 }],
      },
    ]);
  });

  it("unranks every day of an old client's history import, not just today", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const days = ["2026-08-23", "2026-08-24"].map((date) => ({
      date,
      word: "inkling",
      zipf: 2.9,
      total: 12,
      top: 6,
      words: 3,
    }));
    await handler(post({ playerId: PLAYER, scores: days }));

    const written = rpcCall(fetchMock)?.args.p_scores as Record<string, unknown>[];
    expect(written.map((day) => day.unranked)).toEqual([true, true]);
  });

  it.each([
    ["a string", "26"],
    ["a fraction", 26.5],
    ["zero", 0],
  ])("refuses a version that is %s", async (_label, version) => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ version })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-version" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("api/leaderboard retried days", () => {
  it("passes the retry flag through to the write", async () => {
    withEnv();
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ retried: true })));

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toEqual([
      {
        date: SUNDAY,
        word: "inkling",
        zipf: 2.9,
        total: 24.6,
        top: 9.4,
        words: 5,
        mode: "standard",
        retried: true,
      },
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

describe("api/leaderboard on a preview deploy", () => {
  const fourAhead = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);

  it("takes a score for a day ahead, so a tester can play a cutover", async () => {
    withEnv({ ...CONFIGURED, VERCEL_ENV: "preview" });
    const fetchMock = stubFetch([[]]);
    const response = await handler(post(score({ date: fourAhead })));

    expect(response.status).toBe(202);
    expect(rpcCall(fetchMock)?.args.p_scores).toMatchObject([{ date: fourAhead }]);
  });

  it("reads that day's finds rather than an empty feed", async () => {
    withEnv({ ...CONFIGURED, VERCEL_ENV: "preview" });
    const fetchMock = stubFetch([[]]);
    await handler(get(`?words=1&today=${fourAhead}`));

    expect(rpcCall(fetchMock)?.args.p_since).toBe(fourAhead);
  });

  it("still refuses the same day on production", async () => {
    withEnv({ ...CONFIGURED, VERCEL_ENV: "production" });
    stubFetch([[]]);
    const response = await handler(post(score({ date: fourAhead })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "bad-date" });
  });
});
