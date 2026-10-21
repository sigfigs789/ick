import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillFinds,
  backfillHistory,
  FINDS_SENT_KEY,
  feedFloor,
  fetchBoards,
  fetchFoundWords,
  repriceFoundWords,
  submitScore,
  syncHistory,
} from "./leaderboard";
import { rarityScore, rawTotalRarityScore } from "./dictionary";
import { handleFor } from "./handle";
import { joinBoard } from "./player";
import { todayDateString } from "./date";
import { MODE_CHOICE_START, resetModeCache, setMode } from "./mode";
import { FIRST_PUZZLE } from "./drop";
import type { AcceptedWord, DailyProgress } from "./types";
import { APP_VERSION } from "../version";
import { STREAK_KEY } from "./storage";

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
      // Which release priced these words, so the board can turn away an install
      // that stopped updating (see MIN_RANKED_VERSION in src/version.ts).
      version: APP_VERSION,
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
          // Which board the day lands on, on every submission rather than only
          // on a Freeform one: there are two boards, not a default one with a
          // flag, and a server inferring which from an absent field is a server
          // with a silent default in it.
          //
          // Matched rather than named, because this day is `todayDateString()`
          // and the answer therefore depends on when the suite runs -- inside
          // the trial week the calendar says Freeform, after it the switch does.
          // Which value lands for which date is asserted on fixed dates further
          // down ("both modes reach a board"); what belongs here is that the
          // field is on the wire at all, and is one of the two.
          mode: expect.stringMatching(/^(standard|freeform)$/),
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

  it("posts the total unrounded, and leaves the precision to the endpoint", () => {
    joinBoard();
    const fetchMock = stubFetch();
    // Pinned before TAIL_SPREAD_START (2026-10-10), which reprices the deep tail
    // and moves this sum off the half the test is about. The date is only a
    // pricing input here; nothing below depends on it being the real today.
    const today = "2026-10-09";
    // Three perfect deep-tail finds and one priced a nickel under: 39.95, which
    // this file used to round to tenths before posting -- landing on the half,
    // rounding up, and storing a 40 no player could add their finds up to.
    const words: AcceptedWord[] = [
      { word: "togethering", rarity: "Legend", zipf: -1.57 },
      { word: "togethership", rarity: "Legend", zipf: -1.57 },
      { word: "untogether", rarity: "Legend", zipf: 0.53 },
      { word: "untogetherness", rarity: "Legend", zipf: -1.57 },
    ];

    submitScore({ date: today, isToday: true, words });
    const [day] = posted(fetchMock).scores as { total: number }[];

    // The raw sum, tail and all. The endpoint rounds it to 39.95 as it reads it
    // (see api/leaderboard.ts) -- what a stored score's precision is belongs to
    // the server, and a client that rounds first has decided it for good.
    expect(day.total).toBe(rawTotalRarityScore(words, today));
    expect(Math.round(day.total * 100) / 100).toBe(39.95);
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

  it("prices each find from the dictionary, not from the record's stored number", () => {
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

  it("keeps archive play off the board, and puts its words on the feed", () => {
    joinBoard();
    const fetchMock = stubFetch();
    // Off the board for the reason it stays off the streak -- the answers are
    // lookupable -- but the words were still found on that drop.
    expect(submitScore({ date: "2026-07-04", isToday: false, words: WORDS })).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.date).toBe("2026-07-04");
    expect(day.unranked).toBe(true);
    expect(day.found).toEqual(
      WORDS.map((word) => ({ word: word.word.toLowerCase(), zipf: expect.any(Number) }))
    );
  });

  it("ranks a day started on its own date and finished from the archive later", () => {
    joinBoard();
    const fetchMock = stubFetch();
    // First word banked on the day itself, the rest in a session two days on.
    // The history import ranks this day in full, so the live path must too, or
    // the board holds only the words from the first session.
    expect(
      submitScore({
        date: "2026-07-04",
        isToday: false,
        words: WORDS,
        firstWordAt: new Date(2026, 6, 4, 20, 0).toISOString(),
      })
    ).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.date).toBe("2026-07-04");
    expect(day.unranked).toBeUndefined();
    expect(day.words).toBe(WORDS.length);
  });

  it("keeps a past day started after its own date off the board", () => {
    joinBoard();
    const fetchMock = stubFetch();
    expect(
      submitScore({
        date: "2026-07-04",
        isToday: false,
        words: WORDS,
        firstWordAt: new Date(2026, 6, 6, 12, 0).toISOString(),
      })
    ).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.unranked).toBe(true);
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

describe("sending the streak", () => {
  it("sends the game's own streak, as of its last played day, with the scores", () => {
    joinBoard();
    const today = todayDateString();
    localStorage.setItem(
      STREAK_KEY,
      JSON.stringify({
        currentStreak: 31,
        longestStreak: 40,
        lastCompletedDate: today,
        bankedFreezes: 2,
        totalCompleted: 31,
        crushedIt: 0,
        elite: 0,
        highScore: 0,
      })
    );
    const fetchMock = stubFetch();

    submitScore({ date: today, isToday: true, words: WORDS });
    expect(posted(fetchMock).streak).toEqual({ current: 31, best: 40, saved: 3, lastPlayed: today });
  });

  it("sends no streak when there is none", () => {
    joinBoard();
    const fetchMock = stubFetch();
    submitScore({ date: todayDateString(), isToday: true, words: WORDS });
    expect(posted(fetchMock)).not.toHaveProperty("streak");
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

  it("sends each day's score and its word on the same day's terms", () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch();
    // asphyxiate measured 1.80 under 2026-08-14's system and measures 2.09
    // today, which is the difference between what that day's game showed and
    // what today's dictionary would say.
    const history = [
      { ...stored("2026-08-14"), acceptedWords: [{ word: "asphyxiate", rarity: "Extremely Rare" as const, zipf: 2.09 }] },
    ];
    backfillHistory(playerId!, history);

    const day = (posted(fetchMock).scores as Record<string, unknown>[])[0];
    // The day keeps the score it was played for...
    expect(day.top).toBe(8.4);
    // ...and its word keeps the frequency that produced it. The two used to
    // travel on different systems -- a score frozen at the day beside a
    // frequency from today -- which is how a board row came to disagree with
    // the game it reported. 8.40 is what 1.80 scores on 2026-08-14.
    expect(day.word).toBe("asphyxiate");
    expect(day.zipf).toBe(1.8);
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

  it("asks for the whole board, and says who is asking", async () => {
    const playerId = joinBoard();
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27");
    const url = requestedUrl(fetchMock);
    // The whole board and the player asking: everybody on it, and the asker's
    // own row should they ever fall past the ceiling.
    expect(url).toContain("limit=999");
    expect(url).toContain(`player=${playerId}`);
  });

  it("asks for fewer rows when the caller only wants the top", async () => {
    joinBoard();
    const fetchMock = stubFetch(boardsResponse({}));

    await fetchBoards("2026-08-27", { limit: 1 });
    expect(requestedUrl(fetchMock)).toContain("limit=1&");
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

  it("shows a find at the price its own puzzle gave it", async () => {
    stubFetch(
      boardsResponse({
        daily: [
          {
            rank: 1,
            playerId: "11111111-1111-4111-8111-111111111111",
            windowWord: "kindless",
            // 1.08 is what freeform week measured. Today's dictionary folds the
            // word onto "kind" at 5.45, so a fresh lookup here would have shown
            // the player a smaller number than the game gave them for the find
            // it is naming them by.
            windowZipf: 1.08,
            score: 9.4,
            puzzles: 1,
          },
        ],
      }),
    );

    const boards = await fetchBoards("2026-09-15");
    expect(boards.daily[0].windowScore).toBe(rarityScore(1.08));
    expect(boards.daily[0].windowScore).not.toBe(rarityScore(5.45));
  });

  it("prices the find by the puzzle it was found on, so the board shows the game's number", async () => {
    // The row's Zipf alone is not the number the finder saw: from the 0.3 lift
    // on, the same Zipf scores higher. Priced undated, a word shown 9.5 Mythic
    // in the game and on the finds page read 9.3 here (and "morus", 9.2, read
    // 8.9).
    stubFetch(
      boardsResponse({
        daily: [
          {
            rank: 1,
            playerId: "11111111-1111-4111-8111-111111111111",
            windowWord: "drudging",
            windowZipf: 1.44,
            windowDate: "2026-10-09",
            score: 9.47,
            puzzles: 1,
          },
        ],
      }),
    );

    const boards = await fetchBoards("2026-10-09");
    expect(boards.daily[0].windowScore).toBe(9.47);
    expect(rarityScore(1.44)).toBe(9.32);
  });

  it("prices a row that arrived without a frequency from the dictionary", async () => {
    // The one case left for a fresh lookup: a row with no stored number at all.
    stubFetch(
      boardsResponse({
        daily: [
          {
            rank: 1,
            playerId: "11111111-1111-4111-8111-111111111111",
            windowWord: "inkling",
            windowZipf: null,
            score: 9.4,
            puzzles: 1,
          },
        ],
      }),
    );

    const boards = await fetchBoards("2026-09-15");
    expect(boards.daily[0].windowScore).toBe(rarityScore(2.9));
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

  it("asks for the streak board and reads it", async () => {
    const fetchMock = stubFetch(
      boardsResponse({
        streak: [
          {
            rank: 1,
            playerId: "me",
            current: 12,
            best: 30,
            frozen: true,
            covered: true,
            atRisk: true,
          },
          { rank: 2, playerId: "you", current: 0, best: 4 },
          { rank: null, playerId: "gone", current: 5, best: 9, lost: true },
        ],
        streakSelf: { playerId: "late", current: 2, best: 2 },
      })
    );

    const boards = await fetchBoards("2026-08-27");
    expect(requestedUrl(fetchMock)).toContain("streak=1");
    // A row on no streak is not a row on the streak board, and a self row
    // without a rank is dropped like any other board's.
    expect(boards.streak).toEqual([
      {
        rank: 1,
        playerId: "me",
        name: handleFor("me"),
        current: 12,
        best: 30,
        frozen: true,
        covered: true,
        atRisk: true,
        lost: false,
      },
      {
        rank: null,
        playerId: "gone",
        name: handleFor("gone"),
        current: 5,
        best: 9,
        frozen: false,
        covered: false,
        atRisk: false,
        lost: true,
      },
    ]);
    expect(boards.streakSelf).toBeNull();
  });

  it("leaves the streak board out when the server sent none", async () => {
    stubFetch(boardsResponse({}));
    const boards = await fetchBoards("2026-08-27");
    expect(boards.streak).toBeNull();
  });

  it("has no row below the cut when the player is on the board", async () => {
    stubFetch(boardsResponse({ weekly: [{ rank: 1, playerId: "me", windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 }] }));

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weeklySelf).toBeNull();
    expect(boards.monthlySelf).toBeNull();
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

  it("names a row by where it was played, on a board holding two games", async () => {
    // Only the Reddit build sends `source`, and only because its board merges
    // its own players with the ones imported from here. Two populations on one
    // list have to be told apart, and the prefixes are the ones each home
    // already uses.
    stubFetch(
      new Response(
        JSON.stringify({
          weekly: [
            {
              rank: 1,
              playerId: "some_redditor",
              source: "r",
              windowWord: "asphyxiate",
              windowZipf: 2.09,
              score: 40,
            },
            {
              rank: 2,
              playerId: "11111111-1111-4111-8111-111111111111",
              source: "w",
              windowWord: "inkling",
              windowZipf: 2.9,
              score: 20,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weekly.map((e) => e.name)).toEqual([
      // A Reddit row's id is the username already, so there is nothing to derive.
      "u/some_redditor",
      `w/${handleFor("11111111-1111-4111-8111-111111111111")}`,
    ]);
  });

  it("names a row with no source exactly as it always did", async () => {
    // This site's own endpoint sends no source, and must keep producing the
    // name it has always produced -- every handle on the live board depends on
    // it, and a row that renamed itself would rename a player.
    stubFetch(
      new Response(
        JSON.stringify({
          weekly: [
            { rank: 1, playerId: "a", windowWord: "asphyxiate", windowZipf: 2.09, score: 40 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weekly[0].name).toBe(handleFor("a"));
    expect(boards.weekly[0].name).not.toContain("/");
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
      { word: "asphyxiate", zipf: 2.09, rarity: "Extremely Rare", finders: 3, foundOn: "", today: false, stored: 7.9 },
      { word: "inkling", zipf: 2.9, rarity: "Rare", finders: 1, foundOn: "", today: false, stored: 2.9 },
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
        stored: 2.09,
      },
    ]);
  });

  /** One row of the feed, as the endpoint returns it. */
  function feed(word: string, zipf: number, foundOn: string) {
    return new Response(
      JSON.stringify({ words: [{ word, zipf, finders: 1, foundOn }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("prices a find by the puzzle it was found on, not by today's dictionary", async () => {
    // "kindless" is the mismatch in miniature. Freeform week scores it on its
    // own frequency at 1.08 and the game shows Mythic; every other system folds
    // it onto "kind" at 5.45 and calls it Very Common. Priced undated, the feed
    // contradicted the game about the same word on the same afternoon.
    stubFetch(feed("kindless", 5.45, "2026-09-15"));

    expect(await fetchFoundWords("2026-09-15")).toEqual([
      {
        word: "kindless",
        zipf: 1.08,
        rarity: "Mythic",
        finders: 1,
        foundOn: "2026-09-15",
        today: true,
        stored: 5.45,
      },
    ]);
  });

  it("reprices the feed by the reader's mode once the mode is theirs to choose", async () => {
    // The feed holds both modes' finds, and a word reads at what the reader
    // would have been scored for it: folded onto "kind" in Standard, on its own
    // frequency in Freeform. Nothing is fetched again to switch.
    resetModeCache();
    setMode("standard");
    stubFetch(feed("kindless", 1.08, MODE_CHOICE_START));
    const words = await fetchFoundWords(MODE_CHOICE_START);
    const standard = words[0].zipf;
    setMode("freeform");
    const [freeform] = repriceFoundWords(words);
    expect(freeform.zipf).toBe(1.08);
    expect(freeform.rarity).toBe("Mythic");
    expect(standard).toBeGreaterThan(freeform.zipf);
    setMode("standard");
    expect(repriceFoundWords([freeform])[0].zipf).toBe(standard);
  });

  it("leaves out a Freeform find that Standard would have refused", async () => {
    // "aforetime" is archaic: Freeform plays it and Standard turns it away, so
    // a Standard reader is not shown a word their own game refuses. A word no
    // local list knows ("zzqti") was approved live and stays in either mode --
    // unless every finder banked it in Freeform ("zzqtiz"), where Standard's
    // rules were never asked.
    resetModeCache();
    setMode("freeform");
    stubFetch(
      new Response(
        JSON.stringify({
          words: [
            { word: "aforetime", zipf: 1.2, finders: 1, foundOn: MODE_CHOICE_START },
            { word: "zzqti", zipf: 1.5, finders: 1, foundOn: MODE_CHOICE_START },
            // Only MW knows this one, and nobody banked it in Standard.
            { word: "zzqtiz", zipf: 1.5, finders: 1, foundOn: MODE_CHOICE_START, standard: false },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const words = await fetchFoundWords(MODE_CHOICE_START);
    expect(repriceFoundWords(words).map((found) => found.word)).toEqual([
      "aforetime",
      "zzqti",
      "zzqtiz",
    ]);
    setMode("standard");
    expect(repriceFoundWords(words).map((found) => found.word)).toEqual(["zzqti"]);
  });

  it("leaves a find from outside the week on the system that day ran", async () => {
    // The other half of the same rule: dating the feed is not a licence for the
    // week to reprice everything behind it.
    stubFetch(feed("kindless", 1.08, "2026-09-13"));

    expect(await fetchFoundWords("2026-09-15")).toMatchObject([
      { word: "kindless", zipf: 5.45, rarity: "Very Common", today: false },
    ]);
  });

  it("still leaves the trial week on the rules it was played under", async () => {
    // The reader's switch reaches a chosen day and only a chosen day. The trial
    // week was Freeform for everybody by the calendar, so a reader in Standard
    // does not reach back and reprice it -- those days really did score this way.
    resetModeCache();
    setMode("standard");
    try {
      stubFetch(feed("kindless", 5.45, "2026-09-15"));

      expect(await fetchFoundWords("2026-09-15")).toMatchObject([
        { word: "kindless", zipf: 1.08, rarity: "Mythic" },
      ]);
    } finally {
      resetModeCache();
    }
  });

  it("reads a missing date as no date, rather than as the dawn of the game", async () => {
    // Every cutover is a string comparison and "" sorts below all of them, so a
    // row that arrives without a date would price on the legacy scale the game
    // used in July -- 1.4 and "Extremely Rare" for this word, which is neither
    // what any player saw nor a number anything else on the page would show.
    stubFetch(feed("kindless", 5.45, ""));

    expect(await fetchFoundWords("2026-09-15")).toMatchObject([
      { word: "kindless", zipf: 5.45, rarity: "Very Common" },
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
    // Priced by the puzzle, like the `total` and `top` beside it -- the feed is
    // a record of what happened on that drop, so the number it carries is the
    // one the player was shown. "wrinkle" is 3.12 under the system in force on
    // the 21st and 3.31 under today's, and 3.12 is what that day's game said.
    expect(scores[1].found).toEqual([
      { word: "inkling", zipf: 2.9 },
      { word: "wrinkle", zipf: 3.12 },
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

describe("both modes reach a board", () => {
  const CHOSEN = MODE_CHOICE_START;
  const WORDS_HERE: AcceptedWord[] = [{ word: "inkling", rarity: "Rare", zipf: 2.9 }];

  beforeEach(() => {
    resetModeCache();
  });

  it("sends a day the player chose to spend in Freeform, labelled Freeform", () => {
    // Freeform used to go up `unranked`, for the feed alone. It has a board of
    // its own now, and the label is what puts the day on it rather than on
    // Standard's.
    joinBoard();
    const fetchMock = stubFetch();
    expect(
      submitScore({ date: CHOSEN, isToday: true, words: WORDS_HERE, mode: "freeform" }),
    ).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.mode).toBe("freeform");
    expect(day).not.toHaveProperty("unranked");
    expect(day.found).toEqual([{ word: "inkling", zipf: expect.any(Number) }]);
  });

  it("sends a Standard day on the same puzzle to the other board", () => {
    joinBoard();
    const fetchMock = stubFetch();
    expect(
      submitScore({ date: CHOSEN, isToday: true, words: WORDS_HERE, mode: "standard" }),
    ).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.mode).toBe("standard");
  });

  it("labels the day off the record rather than off the switch", () => {
    // A live lookup can settle after the player has flipped modes, and the day
    // belongs to the game it was submitted to.
    joinBoard();
    setMode("freeform");
    const fetchMock = stubFetch();
    submitScore({ date: CHOSEN, isToday: true, words: WORDS_HERE, mode: "standard" });
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.mode).toBe("standard");
  });

  it("sends the trial week as Freeform, which is how everybody played it", () => {
    // Freeform by the calendar rather than by choice. The endpoint writes every
    // pre-split day to both boards whatever this says, so the label is a record
    // of the rules rather than an assignment.
    joinBoard();
    const fetchMock = stubFetch();
    expect(
      submitScore({
        date: "2026-09-20",
        isToday: true,
        words: WORDS_HERE,
        mode: "freeform",
      }),
    ).toBe(true);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day.mode).toBe("freeform");
  });

  it("imports every mode of every day, each to its own board", () => {
    const playerId = joinBoard()!;
    const fetchMock = stubFetch();
    const history: DailyProgress[] = [
      {
        date: CHOSEN,
        drop: "INK",
        mode: "standard",
        acceptedWords: WORDS_HERE,
        rejectedAttempts: [],
        completed: false,
      },
      {
        date: CHOSEN,
        drop: "INK",
        mode: "freeform",
        acceptedWords: WORDS_HERE,
        rejectedAttempts: [],
        completed: false,
      },
      {
        date: "2026-09-28",
        drop: "INK",
        mode: "freeform",
        acceptedWords: WORDS_HERE,
        rejectedAttempts: [],
        completed: false,
      },
    ];
    // A browser that has played both ways holds a record of each, and all of
    // them are real days of play. They go up together and the labels are what
    // keep them apart -- the same date twice is two rows, one per board. None is
    // unranked: that is for archive play and the feed's repair, not a mode.
    expect(backfillHistory(playerId, history, "2026-09-28")).toBe(3);
    const scores = posted(fetchMock).scores as Record<string, unknown>[];
    expect(scores.map((day) => [day.date, day.mode, day.unranked ?? false])).toEqual([
      [CHOSEN, "standard", false],
      [CHOSEN, "freeform", false],
      ["2026-09-28", "freeform", false],
    ]);
  });
});

describe("syncing words the feed has not had", () => {
  const DAY = "2026-09-01";
  const LATER = "2026-09-02";
  /** Lets the response's `then` run, which is where the ledger is written. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends a past day's words unranked, including one played out of the archive", () => {
    const playerId = joinBoard()!;
    const fetchMock = stubFetch();
    // Played on its day, and played a week late: both were found on their drop.
    const history = [stored(DAY), stored(LATER, "2026-09-09T20:00:00")];

    expect(backfillFinds(playerId, history)).toBe(2);
    const scores = posted(fetchMock).scores as Record<string, unknown>[];
    expect(scores.map((day) => day.date)).toEqual([DAY, LATER]);
    // The feed's repair, not the board's: nothing here may rank.
    expect(scores.every((day) => day.unranked === true)).toBe(true);
    expect((scores[1].found as { word: string }[]).map((f) => f.word)).toEqual([
      "inkling",
      "wrinkle",
    ]);
  });

  it("sends each word once the server has taken it", async () => {
    const playerId = joinBoard()!;
    stubFetch();
    backfillFinds(playerId, [stored(DAY)]);
    await settle();

    const fetchMock = stubFetch();
    expect(backfillFinds(playerId, [stored(DAY)])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only the words a day has gained since", async () => {
    const playerId = joinBoard()!;
    stubFetch();
    backfillFinds(playerId, [{ ...stored(DAY), acceptedWords: WORDS.slice(0, 1) }]);
    await settle();

    const fetchMock = stubFetch();
    backfillFinds(playerId, [stored(DAY)]);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect((day.found as { word: string }[]).map((f) => f.word)).toEqual(["wrinkle"]);
  });

  it("tries again on the next open when the server did not take it", async () => {
    const playerId = joinBoard()!;
    stubFetch(new Response(null, { status: 503 }));
    backfillFinds(playerId, [stored(DAY)]);
    await settle();
    expect(localStorage.getItem(FINDS_SENT_KEY)).toBeNull();

    const fetchMock = stubFetch();
    expect(backfillFinds(playerId, [stored(DAY)])).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips days before the feed's floor, which the page cannot show", () => {
    const playerId = joinBoard()!;
    const fetchMock = stubFetch();
    expect(backfillFinds(playerId, [stored("2026-08-20")])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs on every open, from what this browser remembers", () => {
    joinBoard();
    localStorage.setItem(
      `ick:progress:${DAY}`,
      JSON.stringify(stored(DAY, "2026-09-09T20:00:00"))
    );
    const fetchMock = stubFetch();

    syncHistory(LATER);
    // The archive day cannot go on the board, so the finds request is the only one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [day] = posted(fetchMock).scores as Record<string, unknown>[];
    expect(day).toMatchObject({ date: DAY, unranked: true });
  });
});
