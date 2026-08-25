import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillHistory,
  chooseName,
  fetchBoards,
  leaderboardHasContent,
  nameCandidates,
  refreshLeaderboardPresence,
  submitScore,
} from "./leaderboard";
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
        },
      ],
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

describe("the words a player can be known by", () => {
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

  it("offers each day's rarest word, best first", () => {
    expect(
      nameCandidates([
        day("2026-08-19", [{ word: "cat", rarity: "Common", zipf: 4.78 }]),
        day("2026-08-20", [
          { word: "inkling", rarity: "Rare", zipf: 2.9 },
          { word: "asphyxiate", rarity: "Extremely Rare", zipf: 2.09 },
        ]),
      ])
    ).toEqual([
      // asphyxiate won its day, so inkling is not on offer -- one word per day,
      // which is exactly what the server stores and will authorise.
      { word: "asphyxiate", score: 8.3 },
      { word: "cat", score: 4.34 },
    ]);
  });

  it("prices candidates on today's criteria, not the day they were played", () => {
    // A record saved under an older system, or before the word's frequency was
    // corrected: `cat` stored as though vanishingly rare, `inkling` as everyday.
    expect(
      nameCandidates([
        day("2026-08-19", [{ word: "cat", rarity: "Legend", zipf: 0.1 }]),
        day("2026-08-20", [{ word: "inkling", rarity: "Very Common", zipf: 7.5 }]),
      ])
    ).toEqual([
      { word: "inkling", score: 7.11 },
      { word: "cat", score: 4.34 },
    ]);
  });

  it("lists a repeated word once, at its best showing", () => {
    const candidates = nameCandidates([
      day("2026-08-19", [{ word: "inkling", rarity: "Rare", zipf: 2.9 }]),
      day("2026-08-20", [{ word: "inkling", rarity: "Rare", zipf: 2.9 }]),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].word).toBe("inkling");
  });

  it("offers at most ten, and they are the best ten", () => {
    const words = ["asphyxiate", "quixotic", "gastroenterologist", "inkling", "wrinkle", "cat"];
    const history = Array.from({ length: 14 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, "0")}`, [
        { word: words[i % words.length], rarity: "Rare", zipf: 2 + i * 0.2 },
      ])
    );
    const candidates = nameCandidates(history);

    expect(candidates.length).toBeLessThanOrEqual(10);
    // Sorted best first, so a truncation keeps the finds worth being known for.
    const scores = candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("falls back to the stored frequency for a word today's dictionary lacks", () => {
    // A live Merriam-Webster approval: not in the shipped dictionary, so its own
    // recorded rarity is the only thing there is to go on.
    expect(
      nameCandidates([
        day("2026-08-20", [{ word: "enshittification", rarity: "Legend", zipf: 0.5 }]),
      ])[0].word
    ).toBe("enshittification");
  });

  it("lowercases candidates, whatever the record holds", () => {
    expect(
      nameCandidates([day("2026-08-20", [{ word: "Inkling", rarity: "Rare", zipf: 2.9 }])])[0].word
    ).toBe("inkling");
  });

  it("has nothing to offer a browser with nothing eligible", () => {
    expect(nameCandidates([])).toEqual([]);
    expect(nameCandidates([day("2026-08-20", [])])).toEqual([]);
  });

  it("ignores words from days that don't count", () => {
    localStorage.setItem(
      "ick:progress:2026-08-20",
      JSON.stringify(day("2026-08-20", [{ word: "inkling", rarity: "Rare", zipf: 2.9 }]))
    );
    // A rarer word, but pulled out of the archive weeks later -- so it cannot
    // name the player any more than it can score for them.
    localStorage.setItem(
      "ick:progress:2026-07-04",
      JSON.stringify({
        ...day("2026-07-04", [{ word: "asphyxiate", rarity: "Extremely Rare", zipf: 2.09 }]),
        firstWordAt: "2026-08-24T20:00:00.000Z",
        completedAt: "2026-08-24T20:04:00.000Z",
      })
    );

    expect(nameCandidates().map((c) => c.word)).toEqual(["inkling"]);
  });
});

describe("choosing a name", () => {
  it("asks the server to use the word, and reports that it worked", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(chooseName("player-1", "inkling")).resolves.toBe(true);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?];
    expect(url).toBe("/api/leaderboard");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ playerId: "player-1", name: "inkling" });
  });

  it("reports a refusal rather than pretending the name changed", async () => {
    stubFetch(new Response(JSON.stringify({ ok: false, reason: "not-your-word" }), { status: 409 }));
    await expect(chooseName("player-1", "asphyxiate")).resolves.toBe(false);
  });

  it("reports a failed request rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    // The player is watching this one, so it resolves false and the page says so
    // -- but it still must not throw into the render.
    await expect(chooseName("player-1", "inkling")).resolves.toBe(false);
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
  it("ranks each board in the order the server sent it", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          weekStart: "2026-08-23",
          ready: true,
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
            { rank: 1, playerId: "a", name: "asphyxiate", nameZipf: 2.09, score: 40 },
            { name: "noid", score: 10 },
            { playerId: "c", name: "cypher", score: "lots" },
            { rank: 4, playerId: "d", name: "inkling", nameZipf: 2.9, score: 5 },
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
      [1, "asphyxiate"],
      [4, "inkling"],
    ]);
    expect(boards.allTime).toEqual([]);
    // A row with no window word falls back to the name rather than rendering
    // blank, and a missing count reads as zero.
    expect(boards.weekly[0]).toMatchObject({ windowWord: "asphyxiate", puzzles: 0 });
  });

  it("holds the boards back unless the server says they are published", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          opensOn: "2026-08-30",
          // Rows with no `ready` flag beside them: the client shows nothing.
          weekly: [{ rank: 1, playerId: "a", name: "asphyxiate", nameZipf: 2.09, score: 40 }],
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

describe("the recent finds feed", () => {
  it("prices and labels each word with today's dictionary", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: true,
          weekly: [],
          allTime: [],
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

    const { words } = await fetchBoards("2026-08-27");
    expect(words).toEqual([
      { word: "asphyxiate", zipf: 2.09, rarity: "Extremely Rare", finders: 3 },
      { word: "inkling", zipf: 2.9, rarity: "Rare", finders: 1 },
    ]);
  });

  it("keeps a word today's dictionary doesn't carry, on the frequency it was found at", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: true,
          weekly: [],
          allTime: [],
          // A live Merriam-Webster approval: nowhere in the shipped dictionary,
          // so the frequency it was found at is all there is to go on.
          words: [{ word: "brainrot", zipf: 0.5, finders: 2 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { words } = await fetchBoards("2026-08-27");
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({ word: "brainrot", zipf: 0.5 });
  });

  it("drops a word it cannot price rather than showing a blank badge", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: true,
          weekly: [],
          allTime: [],
          words: [
            { word: "inkling", zipf: 2.9, finders: 1 },
            { finders: 1 },
            { word: "notarealwordanywhere", finders: 1 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    expect((await fetchBoards("2026-08-27")).words.map((w) => w.word)).toEqual(["inkling"]);
  });

  it("sends the player's own date, so the server can keep today's finds back", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ ready: true, weekly: [], allTime: [], words: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await fetchBoards("2026-08-27");

    const [requested] = (fetchMock.mock.calls[0] ?? []) as [string?];
    const url = new URL(String(requested), "https://wordink.app");
    expect(url.searchParams.get("today")).toBe("2026-08-27");
  });

  it("has an empty feed when the server sends none", async () => {
    stubFetch(
      new Response(JSON.stringify({ ready: true, weekly: [], allTime: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    expect((await fetchBoards("2026-08-27")).words).toEqual([]);
  });
});

describe("whether the leaderboard is worth a trip", () => {
  it("always is once the boards have opened, without asking anyone", async () => {
    const fetchMock = stubFetch();
    expect(leaderboardHasContent("2026-08-30")).toBe(true);
    expect(leaderboardHasContent("2026-12-25")).toBe(true);

    // A pure date check, so the header costs nothing from opening day onward.
    refreshLeaderboardPresence("2026-08-30");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not, on a browser that has never looked", () => {
    // Better a trophy that appears a moment late than one leading somewhere
    // empty.
    expect(leaderboardHasContent("2026-08-25")).toBe(false);
  });

  it("remembers finds between visits", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          ready: false,
          weekly: [],
          allTime: [],
          words: [{ word: "inkling", zipf: 2.9, finders: 2 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    refreshLeaderboardPresence("2026-08-25");
    await vi.waitFor(() => expect(leaderboardHasContent("2026-08-25")).toBe(true));
  });

  it("records an empty leaderboard as nothing to show", async () => {
    stubFetch(
      new Response(JSON.stringify({ ready: false, weekly: [], allTime: [], words: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    refreshLeaderboardPresence("2026-08-25");
    await vi.waitFor(() => expect(localStorage.getItem("ick:leaderboard-has-content")).toBe("0"));
    expect(leaderboardHasContent("2026-08-25")).toBe(false);
  });

  it("leaves the last known answer alone when the check fails", async () => {
    localStorage.setItem("ick:leaderboard-has-content", "1");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    refreshLeaderboardPresence("2026-08-25");
    // A flaky moment must not make the trophy vanish for someone using it.
    await new Promise((r) => setTimeout(r, 10));
    expect(leaderboardHasContent("2026-08-25")).toBe(true);
  });
});
