import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillHistory,
  feedFloor,
  fetchBoards,
  fetchFoundWords,
  submitScore,
  syncHistory,
} from "./leaderboard";
import { handleFor } from "./handle";
import { joinBoard } from "./player";
import { todayDateString } from "./date";
import { FIRST_PUZZLE } from "./drop";
import type { AcceptedWord, DailyProgress } from "./types";

const WORDS: AcceptedWord[] = [
  { word: "inkling", rarity: "Rare", zipf: 2.6 },
  { word: "wrinkle", rarity: "Uncommon", zipf: 3.6 },
];

function stubFetch(response?: Response) {
  const fetchMock = vi.fn(
    async () => response ?? new Response(null, { status: 202 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The body of the submission the client posted. */
function posted(fetchMock: ReturnType<typeof stubFetch>) {
  const [, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?];
  return JSON.parse(String(init?.body ?? "null")) as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitting a score", () => {
  it("posts the day's running total, named by the player's best word", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    const today = todayDateString();

    expect(submitScore({ date: today, isToday: true, words: WORDS })).toBe(true);
    const body = posted(fetchMock);
    expect(body).toEqual({
      playerId,
      // A one-day batch, the same shape a history import uses. No name: the
      // board derives that from the day's own rarest word.
      scores: [
        {
          date: today,
          word: "inkling",
          zipf: 2.9,
          total: expect.any(Number),
          top: expect.any(Number),
          words: 2,
          // The whole day's list rides along, which is what the finds feed is
          // built from -- every word, not just the one that names the row.
          found: [
            { word: "inkling", zipf: expect.any(Number) },
            { word: "wrinkle", zipf: expect.any(Number) },
          ],
        },
      ],
    });
    const day = (body.scores as Record<string, number>[])[0];
    // The two numbers the game already shows the player, not a third scheme.
    expect(day.top).toBeLessThanOrEqual(day.total);
  });

  it("sends every word found, in the order they were found", () => {
    joinBoard();
    const fetchMock = stubFetch();
    const words: AcceptedWord[] = [
      { word: "Wrinkle", rarity: "Uncommon", zipf: 3.6 },
      { word: "inkling", rarity: "Rare", zipf: 2.6 },
    ];

    submitScore({ date: todayDateString(), isToday: true, words });
    const [day] = posted(fetchMock).scores as { found: { word: string }[] }[];

    // Lowercased on the way out, like the day's rarest word: the endpoint takes
    // nothing else, and the feed shows these to other players verbatim.
    expect(day.found.map((found) => found.word)).toEqual(["wrinkle", "inkling"]);
  });

  it("prices each find at today's rates, not what it was worth when found", () => {
    joinBoard();
    const fetchMock = stubFetch();
    // A stale frequency, as a record saved under an older dictionary would hold.
    const words: AcceptedWord[] = [{ word: "inkling", rarity: "Rare", zipf: 9.9 }];

    submitScore({ date: todayDateString(), isToday: true, words });
    const [day] = posted(fetchMock).scores as { found: { zipf: number }[] }[];

    expect(day.found[0].zipf).toBe(2.9);
  });

  it("sends nothing when nobody has joined on this browser", () => {
    const fetchMock = stubFetch();
    expect(submitScore({ date: todayDateString(), isToday: true, words: WORDS })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps archive play off the board", () => {
    joinBoard();
    const fetchMock = stubFetch();
    // Same reason it stays off the streak: the answers are lookupable.
    expect(submitScore({ date: "2026-07-04", isToday: false, words: WORDS })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing before the first word is accepted", () => {
    joinBoard();
    const fetchMock = stubFetch();
    expect(submitScore({ date: todayDateString(), isToday: true, words: [] })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a failed submission rather than surfacing it", () => {
    joinBoard();
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    // A score that didn't make it is not something to interrupt a game over, so
    // this neither throws nor rejects.
    expect(() =>
      submitScore({ date: todayDateString(), isToday: true, words: WORDS })
    ).not.toThrow();
  });
});

/** A stored day, first played at the given time (default: on its own date). */
function stored(date: string, firstWordAt = `${date}T20:00:00`): DailyProgress {
  return {
    date,
    drop: "ink",
    acceptedWords: WORDS,
    rejectedAttempts: [],
    completed: true,
    won: true,
    firstWordAt,
    completedAt: firstWordAt,
  };
}

describe("importing a joining player's history", () => {
  it("sends every remembered day in one request", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    const history = [stored("2026-08-20"), stored("2026-08-21"), stored("2026-08-22")];

    expect(backfillHistory(playerId!, history)).toBe(3);
    // One request for the whole history: a year of daily puzzles must not be a
    // year of POSTs.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = posted(fetchMock);
    expect(body.playerId).toBe(playerId);
    expect((body.scores as { date: string }[]).map((s) => s.date)).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
  });

  it("sends each day's frozen score with a current frequency for its word", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    // asphyxiate was worth 8.40 the day it was played (2026-08-14's system) and
    // is worth 8.30 today.
    const history = [
      { ...stored("2026-08-14"), acceptedWords: [{ word: "asphyxiate", rarity: "Extremely Rare" as const, zipf: 2.09 }] },
    ];
    backfillHistory(playerId!, history);

    const day = (posted(fetchMock).scores as Record<string, unknown>[])[0];
    // The day keeps the score it was played for...
    expect(day.top).toBe(8.4);
    // ...while its word travels with a current frequency, so the board can rank
    // words found years apart against each other and price them the same.
    expect(day.word).toBe("asphyxiate");
    expect(day.zipf).toBe(2.09);
  });

  it("sends the rarest word of each day, not the first", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    const history = [
      {
        ...stored("2026-08-20"),
        acceptedWords: [
          { word: "wrinkle", rarity: "Uncommon" as const, zipf: 3.31 },
          { word: "asphyxiate", rarity: "Extremely Rare" as const, zipf: 2.09 },
          { word: "inkling", rarity: "Rare" as const, zipf: 2.9 },
        ],
      },
    ];
    backfillHistory(playerId!, history);

    expect((posted(fetchMock).scores as Record<string, unknown>[])[0].word).toBe("asphyxiate");
  });

  it("scores each past day on the system that was in effect that day", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    backfillHistory(playerId!, [stored("2026-08-20")]);

    const day = (posted(fetchMock).scores as Record<string, number>[])[0];
    expect(day.words).toBe(2);
    expect(day.top).toBeLessThanOrEqual(day.total);
  });

  it("sends nothing when there is no history to bring", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();

    expect(backfillHistory(playerId!, [])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a remembered day with no words in it", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    const empty = { ...stored("2026-08-20"), acceptedWords: [] };

    expect(backfillHistory(playerId!, [empty])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads this browser's own history when none is passed", () => {
    const playerId = joinBoard();
    localStorage.setItem("ick:progress:2026-08-20", JSON.stringify(stored("2026-08-20")));
    // Played out of the archive days later, so it is not evidence of playing on
    // the day and stays off the board.
    localStorage.setItem(
      "ick:progress:2026-08-10",
      JSON.stringify(stored("2026-08-10", "2026-08-24T20:00:00"))
    );
    const fetchMock = stubFetch();

    expect(backfillHistory(playerId!)).toBe(1);
    expect((posted(fetchMock).scores as { date: string }[]).map((s) => s.date)).toEqual([
      "2026-08-20",
    ]);
  });
});

describe("reading the boards", () => {
  /** The URL of the board request the client made. */
  function requestedUrl(fetchMock: ReturnType<typeof stubFetch>): string {
    const [url] = (fetchMock.mock.calls[0] ?? []) as [string?];
    return String(url ?? "");
  }

  /** A board response with whatever the test cares about laid over it. */
  function boardsResponse(body: Record<string, unknown>) {
    return new Response(JSON.stringify({ weekly: [], allTime: [], ...body }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("asks for fifteen rows, and says who is asking", async () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    const url = requestedUrl(fetchMock);
    // Fifteen rows and the player asking: the two halves of a short board that
    // still knows where everybody stands.
    expect(url).toContain("limit=15");
    expect(url).toContain(`player=${playerId}`);
  });

  it("sends both windows, each measured on the player's own calendar", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    const url = requestedUrl(fetchMock);
    // The week that brackets the 27th, and the month it falls in. Both are
    // computed from the puzzle date on every fetch, which is the whole of how
    // either board resets: the window moves, and no job has to run.
    expect(url).toContain("since=2026-08-23");
    expect(url).toContain("month=2026-08-01");
  });

  it("sends the puzzle the day board counts, and reads it back", async () => {
    const fetchMock = stubFetch(
      boardsResponse({
        daily: [
          {
            rank: 1,
            playerId: "11111111-1111-4111-8111-111111111111",
            windowWord: "inkling",
            windowZipf: 2.6,
            score: 9.4,
            puzzles: 1,
          },
        ],
      }),
    );

    const boards = await fetchBoards("2026-08-27");
    // A single date rather than a pair: the shortest window the game has is one
    // puzzle, and a puzzle date is the player's own local calendar date.
    expect(requestedUrl(fetchMock)).toContain("day=2026-08-27");
    expect(boards.daily).toHaveLength(1);
    expect(boards.daily[0].name).toBe(
      handleFor("11111111-1111-4111-8111-111111111111"),
    );
    expect(boards.dailySelf).toBeNull();
  });

  it("asks for the last puzzle that is over everywhere, and reads its champion", async () => {
    const fetchMock = stubFetch(
      boardsResponse({
        dayChampion: {
          rank: 1,
          playerId: "22222222-2222-4222-8222-222222222222",
          windowWord: "abaci",
          windowZipf: 2.65,
          score: 9.1,
          puzzles: 1,
        },
      }),
    );

    const boards = await fetchBoards("2026-08-27");
    // Two days back, not one: a puzzle keeps taking scores until the last
    // timezone's copy of that day ends, so yesterday's winner can still change
    // all through today and the day before it cannot.
    expect(requestedUrl(fetchMock)).toContain("champion=2026-08-25");
    expect(boards.dayChampion?.name).toBe(
      handleFor("22222222-2222-4222-8222-222222222222"),
    );
    expect(boards.dayChampion?.score).toBe(9.1);
  });

  it("asks for the day a reader has stepped the board back to", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27", { day: "2026-08-25" });
    // Used as sent, like the other two windows: a day a reader stepped back to
    // is a closed puzzle, and nothing about the date being played should drag
    // it forward again.
    expect(requestedUrl(fetchMock)).toContain("day=2026-08-25");
  });

  it("asks for the windows a reader has stepped back to", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27", { week: "2026-08-16", month: "2026-07-01" });
    const url = requestedUrl(fetchMock);
    // A window given here is used as sent: the boards a reader stepped back to
    // are closed windows, and nothing about the date being played should drag
    // them forward again.
    expect(url).toContain("since=2026-08-16");
    expect(url).toContain("month=2026-07-01");
  });

  it("steps one window without moving the other", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27", { month: "2026-07-01" });
    // The two boards are different questions over different windows, and the
    // page lets them be asked separately -- so an unnamed window is still the
    // live one.
    expect(requestedUrl(fetchMock)).toContain("since=2026-08-23");
  });

  it("moves the monthly window on the first, with nothing else changing", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-09-01");
    // The same code on the next day of play asks for September -- so August's
    // scores fall out of the board by themselves.
    expect(requestedUrl(fetchMock)).toContain("month=2026-09-01");
  });

  it("asks anonymously when nobody has joined on this browser", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    // No id to send and nothing to ask about: the boards come back without a row
    // below the cut, and the page is otherwise the same.
    expect(requestedUrl(fetchMock)).not.toContain("player=");
  });

  it("keeps the player's own row from below the cut, at its real rank", async () => {
    stubFetch(
      boardsResponse({
        weeklySelf: { rank: 61, playerId: "me", windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 },
        allTimeSelf: { rank: 214, playerId: "me", windowWord: "quixotic", windowZipf: 2.33, score: 88, puzzles: 19 },
      })
    );

    const boards = await fetchBoards("2026-08-27");
    // 61st of everybody, not 16th of what fits -- the number is the only reason
    // this row was sent.
    expect(boards.weeklySelf).toMatchObject({ rank: 61, name: handleFor("me") });
    expect(boards.monthlySelf?.rank).toBe(214);
  });

  it("has no row below the cut when the player is on the board", async () => {
    stubFetch(boardsResponse({ weekly: [{ rank: 1, playerId: "me", windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 }] }));

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weeklySelf).toBeNull();
    expect(boards.monthlySelf).toBeNull();
  });

  it("keeps the champion of each closed window", async () => {
    stubFetch(
      boardsResponse({
        lastWeek: { rank: 1, playerId: "won-the-week", windowWord: "inkling", windowZipf: 2.9, score: 61.2, puzzles: 7 },
        lastMonth: { rank: 1, playerId: "won-the-month", windowWord: "quixotic", windowZipf: 2.33, score: 214.8, puzzles: 28 },
      })
    );

    const boards = await fetchBoards("2026-08-27");
    // Named the same way every other row is, from the id alone -- a champion is
    // a board row, so nothing here knows a second way to name a player.
    expect(boards.lastWeek).toMatchObject({ name: handleFor("won-the-week"), score: 61.2 });
    expect(boards.lastMonth).toMatchObject({ name: handleFor("won-the-month"), score: 214.8 });
  });

  it("has no champion when nobody scored in the window", async () => {
    stubFetch(boardsResponse({ lastWeek: null }));

    // A first week, or a month before the game existed. Null rather than a
    // half-built row, so the page can simply not draw the line.
    const boards = await fetchBoards("2026-08-27");
    expect(boards.lastWeek).toBeNull();
    expect(boards.lastMonth).toBeNull();
  });

  it("drops a row from below the cut that arrived without a rank", async () => {
    stubFetch(
      boardsResponse({
        weeklySelf: { playerId: "me", windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 },
      })
    );

    // A rank invented from array position would be a lie here -- this row is
    // nowhere in the array it would be counting. Better to show no row.
    expect((await fetchBoards("2026-08-27")).weeklySelf).toBeNull();
  });

  it("ranks each board in the order the server sent it", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          weekStart: "2026-08-23",
          weekly: [
            { rank: 1, playerId: "a", windowWord: "quixotic", windowZipf: 2.33, score: 40, puzzles: 5 },
            { rank: 2, playerId: "b", windowWord: "inkling", windowZipf: 2.9, score: 20, puzzles: 3 },
          ],
          allTime: [
            { rank: 1, playerId: "b", windowWord: "inkling", windowZipf: 2.9, score: 300, puzzles: 40 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weekStart).toBe("2026-08-23");
    // The ranks come from the database, which did the sorting; nothing is
    // re-sorted here, so what the player sees is always what it ranked. Names
    // are derived from the player id rather than sent.
    expect(boards.weekly.map((e) => [e.rank, e.name])).toEqual([
      [1, handleFor("a")],
      [2, handleFor("b")],
    ]);
    expect(boards.monthly).toHaveLength(1);
  });

  it("drops a malformed row instead of failing the whole board", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          weekly: [
            { rank: 1, playerId: "a", windowWord: "asphyxiate", windowZipf: 2.09, score: 40 },
            { windowWord: "noid", score: 10 },
            { playerId: "c", windowWord: "cypher", score: "lots" },
            { rank: 4, playerId: "d", windowWord: "inkling", windowZipf: 2.9, score: 5 },
          ],
          allTime: "not a board",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    // Each surviving row keeps the rank the database gave it, so a dropped row
    // shows as a gap rather than silently promoting everyone below it.
    expect(boards.weekly.map((e) => [e.rank, e.windowWord])).toEqual([
      [1, "asphyxiate"],
      [4, "inkling"],
    ]);
    expect(boards.monthly).toEqual([]);
    expect(boards.weekly[0]).toMatchObject({ windowWord: "asphyxiate", puzzles: 0 });
  });

  it("falls back to the requested week when the server echoes nothing", async () => {
    stubFetch(
      new Response(JSON.stringify({ weekly: [], allTime: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    // 2026-08-27 is a Thursday; its week began on Sunday the 23rd.
    expect((await fetchBoards("2026-08-27")).weekStart).toBe("2026-08-23");
  });

  it("rejects on a failed read, so the caller can say so", async () => {
    stubFetch(new Response("nope", { status: 502 }));
    await expect(fetchBoards("2026-08-27")).rejects.toThrow("leaderboard 502");
  });
});

describe("the finds feed, fetched on its own", () => {
  it("keeps the order the server sent, which is newest first", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          // A rarer word from an older day comes second, because the feed is a
          // feed -- ordered by when a word turned up, not by how good it is.
          words: [
            { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-26" },
            { word: "stonyheartedly", zipf: -1.57, finders: 1, foundOn: "2026-08-25" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    expect((await fetchFoundWords("2026-08-27")).map((w) => w.word)).toEqual([
      "inkling",
      "stonyheartedly",
    ]);
  });

  it("prices and labels each word with today's dictionary", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          words: [
            // Stored as though everyday, which it is not -- the feed is judged on
            // today's dictionary, like everything else the board shows.
            { word: "asphyxiate", zipf: 7.9, finders: 3 },
            { word: "inkling", zipf: 2.9, finders: 1 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const words = await fetchFoundWords("2026-08-27");
    expect(words).toEqual([
      { word: "asphyxiate", zipf: 2.09, rarity: "Extremely Rare", finders: 3, foundOn: "", today: false },
      { word: "inkling", zipf: 2.9, rarity: "Rare", finders: 1, foundOn: "", today: false },
    ]);
  });

  it("marks a find from today", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          words: [{ word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-08-27" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const words = await fetchFoundWords("2026-08-27");
    // Marked, because a live feed nobody can tell is live reads as history.
    expect(words).toEqual([
      {
        word: "asphyxiate",
        zipf: 2.09,
        rarity: "Extremely Rare",
        finders: 1,
        foundOn: "2026-08-27",
        today: true,
      },
    ]);
  });

  it("keeps an ordinary word, because it was still somebody's best", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          words: [
            { word: "cat", zipf: 4.78, finders: 9, foundOn: "2026-08-27" },
            { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-27" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    // `cat` is Common, and it is still the best word its finder managed that
    // day. Cutting it would make the feed a list of good players rather than a
    // list of what happened.
    expect((await fetchFoundWords("2026-08-27")).map((w) => w.word)).toEqual([
      "cat",
      "inkling",
    ]);
  });

  it("sends the date and nothing else, so every player shares one cached answer", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ words: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await fetchFoundWords("2026-08-27");

    const [requested] = (fetchMock.mock.calls[0] ?? []) as [string?];
    const url = new URL(String(requested), "https://wordink.app");
    expect(url.searchParams.get("today")).toBe("2026-08-27");
    // No player id: the moment one is on this URL the response stops being
    // shareable, which is the whole reason the feed left the boards' request.
    expect(url.searchParams.get("player")).toBeNull();
    expect([...url.searchParams.keys()].sort()).toEqual(["today", "words"]);
  });

  it("rejects on a failed read, so a refresh can leave the last list up", async () => {
    stubFetch(new Response("nope", { status: 502 }));
    await expect(fetchFoundWords("2026-08-27")).rejects.toThrow("leaderboard words 502");
  });

  it("has an empty feed when the server sends none", async () => {
    stubFetch(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    expect((await fetchFoundWords("2026-08-27"))).toEqual([]);
  });
});

describe("syncing an already-joined player on open", () => {
  it("re-sends the days this browser remembers", () => {
    const playerId = joinBoard();
    // Stored rather than passed: opening the app knows nothing about a history,
    // it reads one.
    localStorage.setItem("ick:progress:2026-08-20", JSON.stringify(stored("2026-08-20")));
    localStorage.setItem("ick:progress:2026-08-21", JSON.stringify(stored("2026-08-21")));
    const fetchMock = stubFetch();

    expect(syncHistory("2026-08-21")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = posted(fetchMock);
    expect(body.playerId).toBe(playerId);
    expect((body.scores as { date: string }[]).map((s) => s.date)).toEqual([
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("sends nothing when nobody has joined on this browser", () => {
    localStorage.setItem("ick:progress:2026-08-20", JSON.stringify(stored("2026-08-20")));
    const fetchMock = stubFetch();

    // Opening the app is not joining the board.
    expect(syncHistory("2026-08-21")).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the current puzzle's words and no older day's", () => {
    joinBoard();
    localStorage.setItem("ick:progress:2026-08-20", JSON.stringify(stored("2026-08-20")));
    localStorage.setItem("ick:progress:2026-08-21", JSON.stringify(stored("2026-08-21")));
    const fetchMock = stubFetch();

    syncHistory("2026-08-21");
    const scores = posted(fetchMock).scores as Record<string, unknown>[];
    // The feed shows one drop, so words for any other day would be rows nobody
    // can see -- and a browser with a year of history would not fit the body.
    expect(scores[0].found).toBeUndefined();
    // Priced at today's rates, like everywhere else on the page.
    expect(scores[1].found).toEqual([
      { word: "inkling", zipf: 2.9 },
      { word: "wrinkle", zipf: 3.31 },
    ]);
  });
});

describe("asking for the list by hand", () => {
  /**
   * The URL the client fetched. Typed structurally: the stubs here take no
   * declared arguments, so their recorded calls are empty tuples as far as the
   * compiler is concerned, whatever was actually passed.
   */
  function url(fetchMock: { mock: { calls: unknown[][] } }, call = 0): string {
    return String(fetchMock.mock.calls[call]?.[0] ?? "");
  }

  it("leaves a poll on the shared copy", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ words: [] }), { status: 200 }));

    await fetchFoundWords("2026-08-25");

    // No buster: two players on the same day send byte-identical URLs, which is
    // what lets one cached answer serve all of them.
    expect(url(fetchMock)).toBe("/api/leaderboard?words=1&today=2026-08-25");
  });

  it("keeps the feed out of this browser's own cache", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ words: [] }), { status: 200 }));

    await fetchFoundWords("2026-08-25");

    // The shared copy is the point; a private one is how a poll goes blind.
    const [, init] = (fetchMock.mock.calls[0] ?? []) as [unknown?, RequestInit?];
    expect(init?.cache).toBe("no-store");
  });

  it("busts the cache for a reader who asked", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ words: [] }), { status: 200 }));

    await fetchFoundWords("2026-08-25", { fresh: true });

    // The URL is the cache key, so a different one is the only way a client can
    // get past a shared copy -- a reload cannot, and neither can a no-cache header.
    expect(url(fetchMock)).toMatch(/^\/api\/leaderboard\?words=1&today=2026-08-25&t=\d+$/);
  });

  it("busts the boards too, since a refresh refreshes the page", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ weekly: [], allTime: [] }), { status: 200 }));

    await fetchBoards("2026-08-25", { fresh: true });

    expect(url(fetchMock)).toMatch(/&t=\d+$/);
  });

  it("shares one key across a flurry of taps", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
      // Its own stub: a Response body can only be read once, and this is the
      // one test here that fetches more than once.
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ words: [] }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      await fetchFoundWords("2026-08-25", { fresh: true });
      // Two seconds later: the same five-second bucket, so the same URL, so one
      // origin read rather than one per tap.
      vi.setSystemTime(new Date("2026-08-25T12:00:02.000Z"));
      await fetchFoundWords("2026-08-25", { fresh: true });
      expect(url(fetchMock, 1)).toBe(url(fetchMock, 0));

      // Past the bucket, a tap a reader could tell apart gets its own key.
      vi.setSystemTime(new Date("2026-08-25T12:00:07.000Z"));
      await fetchFoundWords("2026-08-25", { fresh: true });
      expect(url(fetchMock, 2)).not.toBe(url(fetchMock, 0));
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * How far back the finds feed goes.
 */
describe("how far back the feed looks", () => {
  it("steps back to the first day any find was recorded", () => {
    // The whole archive, not the week. The feed is its own page now -- the
    // game's record of what has been found -- and a record that forgot every
    // Sunday night was the odd thing. Not read off `today` at all: the floor is
    // a fact about this deployment's history.
    expect(feedFloor()).toBe("2026-08-26");
  });

  it("never offers a day from before any find was recorded", () => {
    // The finds table is younger than the game, so the floor sits at the first
    // day there is anything to show rather than at the first puzzle. "Nobody
    // found anything on this puzzle" would be a sentence about the schema on one
    // of those days, and the same lie every time.
    expect(feedFloor() > FIRST_PUZZLE).toBe(true);
  });
});

describe("a day that spent its retry", () => {
  it("marks the submission so the board is allowed to lower the day", () => {
    joinBoard();
    const fetchMock = stubFetch();
    const today = todayDateString();

    // Three words where a moment ago there were four: the board's write is
    // monotonic per day, so without this flag the retried word goes on being
    // ranked no matter what the client sends.
    submitScore({ date: today, isToday: true, words: WORDS.slice(0, 1), retried: true });

    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.retried).toBe(true);
  });

  it("says nothing on an ordinary day rather than sending the default", () => {
    joinBoard();
    const fetchMock = stubFetch();

    submitScore({ date: todayDateString(), isToday: true, words: WORDS });

    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    // Absent means false to the write; saying it would put a field on every
    // submission ever made to state the ordinary case.
    expect(day).not.toHaveProperty("retried");
  });

  it("keeps carrying the flag when a later open re-sends the day", () => {
    joinBoard();
    localStorage.setItem(
      "ick:progress:2026-08-21",
      JSON.stringify({ ...stored("2026-08-21"), retryUsed: true })
    );
    const fetchMock = stubFetch();

    syncHistory("2026-08-21");

    // A repair that left this off would be read as a pre-retry straggler and
    // dropped -- so the sync would quietly stop repairing exactly the days most
    // likely to need it.
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.retried).toBe(true);
  });

  it("leaves the flag off a synced day that never used its retry", () => {
    joinBoard();
    localStorage.setItem("ick:progress:2026-08-21", JSON.stringify(stored("2026-08-21")));
    const fetchMock = stubFetch();

    syncHistory("2026-08-21");

    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day).not.toHaveProperty("retried");
  });
});
