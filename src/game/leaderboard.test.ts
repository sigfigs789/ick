import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBoards, submitScore } from "./leaderboard";
import { savePlayerName } from "./player";
import { todayDateString } from "./date";
import type { AcceptedWord } from "./types";

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
  it("posts the day's running total for a joined player", () => {
    const player = savePlayerName("Mo");
    const fetchMock = stubFetch();
    const today = todayDateString();

    expect(submitScore({ date: today, isToday: true, words: WORDS })).toBe(true);
    const body = posted(fetchMock);
    expect(body).toEqual({
      playerId: player?.id,
      name: "Mo",
      date: today,
      total: expect.any(Number),
      top: expect.any(Number),
      words: 2,
    });
    // The two numbers the game already shows the player, not a third scheme.
    expect(body.top as number).toBeLessThanOrEqual(body.total as number);
  });

  it("sends nothing when nobody has joined on this browser", () => {
    const fetchMock = stubFetch();
    expect(submitScore({ date: todayDateString(), isToday: true, words: WORDS })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps archive play off the board", () => {
    savePlayerName("Mo");
    const fetchMock = stubFetch();
    // Same reason it stays off the streak: the answers are lookupable.
    expect(submitScore({ date: "2026-07-04", isToday: false, words: WORDS })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing before the first word is accepted", () => {
    savePlayerName("Mo");
    const fetchMock = stubFetch();
    expect(submitScore({ date: todayDateString(), isToday: true, words: [] })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a failed submission rather than surfacing it", () => {
    savePlayerName("Mo");
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

describe("reading the boards", () => {
  it("ranks each board in the order the server sent it", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          weekStart: "2026-08-24",
          weekly: [
            { playerId: "a", name: "Ada", score: 40, best: 9.9, puzzles: 5 },
            { playerId: "b", name: "Mo", score: 20, best: 9.4, puzzles: 3 },
          ],
          allTime: [{ playerId: "b", name: "Mo", score: 300, best: 10, puzzles: 40 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    expect(boards.weekStart).toBe("2026-08-24");
    // Ranks are assigned from the array order, never re-sorted here, so what the
    // player sees is always what the database ranked.
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
          weekly: [
            { playerId: "a", name: "Ada", score: 40 },
            { name: "no id", score: 10 },
            { playerId: "c", name: "Cy", score: "lots" },
            { playerId: "d", name: "Di", score: 5 },
          ],
          allTime: "not a board",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const boards = await fetchBoards("2026-08-27");
    // Ranks close up over the dropped rows rather than leaving a gap.
    expect(boards.weekly.map((e) => [e.rank, e.name])).toEqual([
      [1, "Ada"],
      [2, "Di"],
    ]);
    expect(boards.allTime).toEqual([]);
    // Missing optional numbers fall back rather than rendering as undefined.
    expect(boards.weekly[0]).toMatchObject({ best: 0, puzzles: 0 });
  });

  it("falls back to the requested week when the server echoes nothing", async () => {
    stubFetch(
      new Response(JSON.stringify({ weekly: [], allTime: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    // 2026-08-27 is a Thursday; its week began on the 24th.
    expect((await fetchBoards("2026-08-27")).weekStart).toBe("2026-08-24");
  });

  it("rejects on a failed read, so the caller can say so", async () => {
    stubFetch(new Response("nope", { status: 502 }));
    await expect(fetchBoards("2026-08-27")).rejects.toThrow("leaderboard 502");
  });
});
