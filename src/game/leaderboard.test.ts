import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillHistory, boardName, fetchBoards, submitScore } from "./leaderboard";
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
      name: "inkling",
      // A one-day batch, the same shape a history import uses.
      scores: [{ date: today, total: expect.any(Number), top: expect.any(Number), words: 2 }],
    });
    const day = (body.scores as Record<string, number>[])[0];
    // The two numbers the game already shows the player, not a third scheme.
    expect(day.top).toBeLessThanOrEqual(day.total);
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

describe("the name the board calls you", () => {
  /** A day's worth of words, played on its own date so it counts. */
  function day(date: string, words: AcceptedWord[]): DailyProgress {
    return {
      date,
      drop: "ink",
      acceptedWords: words,
      rejectedAttempts: [],
      completed: true,
      firstWordAt: `${date}T20:00:00.000Z`,
      completedAt: `${date}T20:04:00.000Z`,
    };
  }

  it("is the rarest word the player has ever found", () => {
    // asphyxiate (8.30) beats inkling (7.11) beats cat (4.34) today.
    expect(
      boardName([
        day("2026-08-19", [{ word: "cat", rarity: "Common", zipf: 4.78 }]),
        day("2026-08-20", [
          { word: "inkling", rarity: "Rare", zipf: 2.9 },
          { word: "asphyxiate", rarity: "Extremely Rare", zipf: 2.09 },
        ]),
      ])
    ).toBe("asphyxiate");
  });

  it("judges words on today's criteria, not the score they were saved with", () => {
    // A record saved under an older scoring system, or before the word's
    // frequency was corrected: `cat` is stored as though it were vanishingly
    // rare, and `inkling` as though it were everyday.
    const name = boardName([
      day("2026-08-19", [{ word: "cat", rarity: "Legend", zipf: 0.1 }]),
      day("2026-08-20", [{ word: "inkling", rarity: "Very Common", zipf: 7.5 }]),
    ]);

    // The stored numbers would have crowned `cat`. Today's dictionary says
    // otherwise, and today's dictionary is what every player is judged by.
    expect(name).toBe("inkling");
  });

  it("falls back to the stored frequency for a word today's dictionary lacks", () => {
    // A live Merriam-Webster approval: not in the shipped dictionary, so its
    // own recorded rarity is the only thing there is to go on.
    expect(
      boardName([
        day("2026-08-20", [
          { word: "inkling", rarity: "Rare", zipf: 2.9 },
          { word: "enshittification", rarity: "Legend", zipf: 0.5 },
        ]),
      ])
    ).toBe("enshittification");
  });

  it("keeps the earlier word when two are equally rare", () => {
    const words = [
      { word: "inkling", rarity: "Rare" as const, zipf: 2.9 },
      { word: "inkling", rarity: "Rare" as const, zipf: 2.9 },
    ];
    // A name that churned between ties would rewrite the player's whole history
    // on every submission for no reason.
    expect(boardName([day("2026-08-20", words)])).toBe("inkling");
  });

  it("lowercases the name, whatever the record holds", () => {
    expect(boardName([day("2026-08-20", [{ word: "Inkling", rarity: "Rare", zipf: 2.9 }])])).toBe(
      "inkling"
    );
  });

  it("has no name for a browser with nothing eligible", () => {
    expect(boardName([])).toBeNull();
    expect(boardName([day("2026-08-20", [])])).toBeNull();
  });

  it("ignores words from days that don't count", () => {
    localStorage.setItem(
      "ick:progress:2026-08-20",
      JSON.stringify(day("2026-08-20", [{ word: "inkling", rarity: "Rare", zipf: 2.9 }]))
    );
    // A rarer word, but pulled out of the archive weeks later -- so it cannot
    // become the player's name any more than it can become their score.
    localStorage.setItem(
      "ick:progress:2026-07-04",
      JSON.stringify({
        ...day("2026-07-04", [{ word: "asphyxiate", rarity: "Extremely Rare", zipf: 2.09 }]),
        firstWordAt: "2026-08-24T20:00:00.000Z",
        completedAt: "2026-08-24T20:04:00.000Z",
      })
    );

    expect(boardName()).toBe("inkling");
  });
});

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
  it("ranks each board in the order the server sent it", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          weekStart: "2026-08-23",
          ready: true,
          players: 12,
          minPlayers: 10,
          weekly: [
            { rank: 1, playerId: "a", name: "Ada", score: 40, best: 9.9, puzzles: 5 },
            { rank: 2, playerId: "b", name: "Mo", score: 20, best: 9.4, puzzles: 3 },
          ],
          allTime: [{ rank: 1, playerId: "b", name: "Mo", score: 300, best: 10, puzzles: 40 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weekStart).toBe("2026-08-23");
    expect(boards.ready).toBe(true);
    expect(boards.players).toBe(12);
    // The ranks come from the database, which did the sorting; nothing is
    // re-sorted here, so what the player sees is always what it ranked.
    expect(boards.weekly.map((e) => [e.rank, e.name])).toEqual([
      [1, "Ada"],
      [2, "Mo"],
    ]);
    expect(boards.allTime).toHaveLength(1);
  });

  it("drops a malformed row instead of failing the whole board", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: true,
          weekly: [
            { rank: 1, playerId: "a", name: "Ada", score: 40 },
            { name: "no id", score: 10 },
            { playerId: "c", name: "Cy", score: "lots" },
            { rank: 4, playerId: "d", name: "Di", score: 5 },
          ],
          allTime: "not a board",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    // Each surviving row keeps the rank the database gave it, so a dropped row
    // shows as a gap rather than silently promoting everyone below it.
    expect(boards.weekly.map((e) => [e.rank, e.name])).toEqual([
      [1, "Ada"],
      [4, "Di"],
    ]);
    expect(boards.allTime).toEqual([]);
    // Missing optional numbers fall back rather than rendering as undefined.
    expect(boards.weekly[0]).toMatchObject({ best: 0, puzzles: 0 });
  });

  it("holds the boards back unless the server says they are published", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          players: 4,
          minPlayers: 10,
          // Rows with no `ready` flag beside them: the client shows nothing.
          weekly: [{ rank: 1, playerId: "a", name: "Ada", score: 40 }],
          allTime: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.ready).toBe(false);
    expect(boards.players).toBe(4);
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
