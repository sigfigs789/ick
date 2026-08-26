import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillHistory,
  fetchBoards,
  fetchFoundWords,
  previewRequested,
  submitScore,
  syncHistory,
} from "./leaderboard";
import { handleFor } from "./handle";
import { joinBoard } from "./player";
import { todayDateString } from "./date";
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
  // The preview switch is remembered for the tab (see previewRequested), so it
  // has to be forgotten between tests like everything else stored.
  sessionStorage.clear();
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
function stored(date: string, firstWordAt = `${date}T20:00:00.000Z`): DailyProgress {
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
      JSON.stringify(stored("2026-08-10", "2026-08-24T20:00:00.000Z"))
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
    return new Response(JSON.stringify({ ready: true, weekly: [], allTime: [], ...body }), {
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

  it("asks the server to open the boards early when the URL says preview", async () => {
    window.history.replaceState(null, "", "/leaderboard?preview=1");
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    // The gate is the server's, so previewing is something this request asks
    // for rather than something the page does with the answer.
    expect(requestedUrl(fetchMock)).toContain("preview=1");
  });

  it("asks for no preview on an ordinary open", async () => {
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    expect(requestedUrl(fetchMock)).not.toContain("preview=");
  });

  it("keeps previewing after a navigation that drops the query string", async () => {
    window.history.replaceState(null, "", "/?preview=1");
    expect(previewRequested()).toBe(true);
    // What `navigate` leaves in the address bar: a bare path. The preview has to
    // survive it, or tapping through from the game would end it.
    window.history.replaceState(null, "", "/leaderboard");
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    expect(requestedUrl(fetchMock)).toContain("preview=1");
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
    expect(boards.allTimeSelf?.rank).toBe(214);
  });

  it("has no row below the cut when the player is on the board", async () => {
    stubFetch(boardsResponse({ weekly: [{ rank: 1, playerId: "me", windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 }] }));

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weeklySelf).toBeNull();
    expect(boards.allTimeSelf).toBeNull();
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
          ready: true,
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
    expect(boards.ready).toBe(true);
    // The ranks come from the database, which did the sorting; nothing is
    // re-sorted here, so what the player sees is always what it ranked. Names
    // are derived from the player id rather than sent.
    expect(boards.weekly.map((e) => [e.rank, e.name])).toEqual([
      [1, handleFor("a")],
      [2, handleFor("b")],
    ]);
    expect(boards.allTime).toHaveLength(1);
  });

  it("drops a malformed row instead of failing the whole board", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: true,
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
    expect(boards.allTime).toEqual([]);
    expect(boards.weekly[0]).toMatchObject({ windowWord: "asphyxiate", puzzles: 0 });
  });

  it("holds the boards back unless the server says they are published", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          opensOn: "2026-08-30",
          // Rows with no `ready` flag beside them: the client shows nothing.
          weekly: [{ rank: 1, playerId: "a", windowWord: "asphyxiate", windowZipf: 2.09, score: 40 }],
          allTime: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.ready).toBe(false);
    expect(boards.opensOn).toBe("2026-08-30");
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
