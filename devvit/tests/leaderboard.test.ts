/**
 * The Redis leaderboard's arithmetic.
 *
 * The website's board is a GROUP BY, so it cannot disagree with itself. This one
 * keeps a day row, three sorted sets, three window-word hashes and three puzzle
 * counts in step by hand, and every test here is about one of the ways that can
 * go wrong: a delta pushed twice, a day raised without its windows following, a
 * retry that lowers a day but not the week it sits in.
 *
 * Runs under the repo's vitest rather than the Devvit project's own runner --
 * see devvit/tests/windows.test.ts for why.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./redis-fake";

const redis = new FakeRedis();

// The core imports a module-level `redis` singleton from the Devvit server
// runtime, which does not exist outside a post. The fake stands in for it.
vi.mock("@devvit/web/server", () => ({ redis }));

const { readBoard, readFinds, readSelf, submitScores } = await import(
  "../src/server/core/leaderboard"
);

/**
 * Seed the cache the scheduled import writes, standing in for the job itself.
 *
 * Writing the cache rather than stubbing `importedBoard` on purpose: the key
 * shape and the JSON round trip are part of what the merge depends on, and a
 * stub would pass with either of them broken.
 */
async function seedImportedBoard(
  window: string,
  start: string,
  rows: { playerId: string; windowWord: string; windowZipf: number; score: number; puzzles?: number }[],
) {
  await redis.set(
    `import:b:${window}:${start}`,
    JSON.stringify(rows.map((row, i) => ({ rank: i + 1, puzzles: 1, source: "w", ...row }))),
  );
}

async function seedImportedFinds(
  date: string,
  rows: { word: string; zipf: number; finders: number }[],
) {
  await redis.set(
    `import:f:${date}`,
    JSON.stringify(rows.map((row) => ({ ...row, foundOn: date }))),
  );
}

/** A Wednesday, so the week it sits in is unambiguous. */
const WED = "2026-07-08";
/** The Sunday opening that week, and the Saturday closing it. */
const WEEK = "2026-07-05";
const SAT = "2026-07-11";
/** The Sunday *after*, which starts a different week inside the same month. */
const NEXT_SUN = "2026-07-12";
const MONTH = "2026-07-01";

/** One submitted puzzle, with the fields a test is not asserting on defaulted. */
function score(over: Partial<Parameters<typeof submitScores>[1][number]> = {}) {
  return {
    date: WED,
    word: "quixotic",
    zipf: 2.5,
    total: 12,
    top: 7,
    words: 3,
    ...over,
  };
}

beforeEach(() => {
  // A fresh store per test; the fake holds everything in two maps.
  Object.assign(redis, new FakeRedis());
});

describe("a first submission", () => {
  it("puts the player on all three boards at the day's total", async () => {
    expect(await submitScores("ann", [score()])).toBe(1);

    for (const [window, start] of [["d", WED], ["w", WEEK], ["m", MONTH]] as const) {
      const board = await readBoard(window, start);
      expect(board, `${window} board`).toHaveLength(1);
      expect(board[0]).toMatchObject({
        rank: 1,
        playerId: "ann",
        windowWord: "quixotic",
        windowZipf: 2.5,
        score: 12,
        puzzles: 1,
      });
    }
  });

  it("does not put them on a week or month the puzzle is not in", async () => {
    await submitScores("ann", [score()]);
    expect(await readBoard("w", NEXT_SUN)).toEqual([]);
    expect(await readBoard("m", "2026-08-01")).toEqual([]);
  });
});

describe("a day's score is monotonic", () => {
  it("ignores a resubmission that would lower it, in every window", async () => {
    await submitScores("ann", [score({ total: 12 })]);
    expect(await submitScores("ann", [score({ total: 5 })])).toBe(0);

    expect((await readBoard("d", WED))[0]?.score).toBe(12);
    expect((await readBoard("w", WEEK))[0]?.score).toBe(12);
    expect((await readBoard("m", MONTH))[0]?.score).toBe(12);
  });

  it("moves the wider windows by the difference, not by the whole total", async () => {
    await submitScores("ann", [score({ total: 12 })]);
    await submitScores("ann", [score({ total: 20 })]);

    // The bug this is here for: pushing 20 into a week that already held 12.
    expect((await readBoard("w", WEEK))[0]?.score).toBe(20);
    expect((await readBoard("m", MONTH))[0]?.score).toBe(20);
  });

  it("treats a re-sent backfill as a no-op", async () => {
    const history = [score({ date: WED }), score({ date: SAT, total: 8 })];
    expect(await submitScores("ann", history)).toBe(2);
    expect(await submitScores("ann", history)).toBe(0);

    expect((await readBoard("w", WEEK))[0]).toMatchObject({ score: 20, puzzles: 2 });
  });

  it("sums separate days inside the window rather than replacing them", async () => {
    await submitScores("ann", [score({ date: WED, total: 12 })]);
    await submitScores("ann", [score({ date: SAT, total: 8 })]);

    expect((await readBoard("w", WEEK))[0]).toMatchObject({ score: 20, puzzles: 2 });
    // The two days are in the same month but different weeks once one moves.
    await submitScores("ann", [score({ date: NEXT_SUN, total: 6 })]);
    expect((await readBoard("w", WEEK))[0]?.score).toBe(20);
    expect((await readBoard("w", NEXT_SUN))[0]?.score).toBe(6);
    expect((await readBoard("m", MONTH))[0]).toMatchObject({ score: 26, puzzles: 3 });
  });
});

describe("a retry", () => {
  it("is the one thing that can lower a day, and lowers its windows with it", async () => {
    await submitScores("ann", [score({ total: 12 })]);
    await submitScores("ann", [score({ total: 4, retried: true })]);

    expect((await readBoard("d", WED))[0]?.score).toBe(4);
    expect((await readBoard("w", WEEK))[0]?.score).toBe(4);
    expect((await readBoard("m", MONTH))[0]?.score).toBe(4);
  });

  it("does not count the day twice in the puzzle count", async () => {
    await submitScores("ann", [score()]);
    await submitScores("ann", [score({ total: 4, retried: true })]);
    expect((await readBoard("w", WEEK))[0]?.puzzles).toBe(1);
  });
});

describe("the word a window shows", () => {
  it("is the rarest found inside it, not the most recent", async () => {
    await submitScores("ann", [score({ date: WED, word: "quixotic", zipf: 2.5 })]);
    await submitScores("ann", [score({ date: SAT, word: "common", zipf: 5.1, total: 3 })]);

    expect((await readBoard("w", WEEK))[0]).toMatchObject({
      windowWord: "quixotic",
      windowZipf: 2.5,
    });
  });

  it("moves when a rarer one turns up", async () => {
    await submitScores("ann", [score({ date: WED, word: "quixotic", zipf: 2.5 })]);
    await submitScores("ann", [score({ date: SAT, word: "zarf", zipf: 1.1, total: 3 })]);

    expect((await readBoard("w", WEEK))[0]).toMatchObject({ windowWord: "zarf", windowZipf: 1.1 });
    // The day's own board still shows that day's word, not the week's best.
    expect((await readBoard("d", WED))[0]?.windowWord).toBe("quixotic");
  });
});

describe("ranking", () => {
  it("orders on summed total, highest first", async () => {
    await submitScores("ann", [score({ total: 12 })]);
    await submitScores("bea", [score({ total: 20, word: "abc", zipf: 4 })]);
    await submitScores("cyd", [score({ total: 6, word: "def", zipf: 4 })]);

    const board = await readBoard("w", WEEK);
    expect(board.map((row) => row.playerId)).toEqual(["bea", "ann", "cyd"]);
    expect(board.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tie on the rarer word", async () => {
    await submitScores("ann", [score({ total: 12, word: "common", zipf: 5 })]);
    await submitScores("bea", [score({ total: 12, word: "zarf", zipf: 1.1 })]);

    expect((await readBoard("w", WEEK)).map((row) => row.playerId)).toEqual(["bea", "ann"]);
  });

  it("breaks a tie on the rarest word even across the board's cut", async () => {
    // Sixteen players level on total, the rarest word belonging to the one the
    // sorted set would have ordered last. Without the over-read in readBoard,
    // that player falls off a fifteen-row board they should top.
    for (let i = 0; i < 15; i += 1) {
      await submitScores(`p${i}`, [score({ total: 10, word: "common", zipf: 5 })]);
    }
    await submitScores("zzz", [score({ total: 10, word: "zarf", zipf: 1.1 })]);

    const board = await readBoard("w", WEEK, 15);
    expect(board).toHaveLength(15);
    expect(board[0]?.playerId).toBe("zzz");
  });
});

describe("a player's own row, below the cut", () => {
  it("is null when they are already on the board", async () => {
    await submitScores("ann", [score()]);
    const board = await readBoard("w", WEEK);
    expect(await readSelf("w", WEEK, "ann", board)).toBeNull();
  });

  it("is null for someone with nothing in the window", async () => {
    await submitScores("ann", [score()]);
    const board = await readBoard("w", WEEK);
    expect(await readSelf("w", WEEK, "nobody", board)).toBeNull();
  });

  it("carries the rank they actually hold", async () => {
    for (let i = 0; i < 15; i += 1) {
      await submitScores(`p${i}`, [score({ total: 100 - i, word: "common", zipf: 5 })]);
    }
    await submitScores("last", [score({ total: 1, word: "common", zipf: 5 })]);

    const board = await readBoard("w", WEEK, 15);
    expect(board.some((row) => row.playerId === "last")).toBe(false);
    expect(await readSelf("w", WEEK, "last", board)).toMatchObject({
      rank: 16,
      playerId: "last",
      score: 1,
    });
  });
});

describe("the finds feed", () => {
  it("counts a player once however often they resubmit a word", async () => {
    const found = [{ word: "quixotic", zipf: 2.5 }];
    await submitScores("ann", [score({ found })]);
    await submitScores("ann", [score({ total: 14, found })]);

    const finds = await readFinds(WED);
    expect(finds).toHaveLength(1);
    expect(finds[0]).toMatchObject({ word: "quixotic", zipf: 2.5, finders: 1, foundOn: WED });
  });

  it("counts distinct players", async () => {
    const found = [{ word: "quixotic", zipf: 2.5 }];
    await submitScores("ann", [score({ found })]);
    await submitScores("bea", [score({ found })]);

    expect((await readFinds(WED))[0]?.finders).toBe(2);
  });

  it("records words from a submission that did not raise the day", async () => {
    await submitScores("ann", [score({ total: 12, found: [{ word: "first", zipf: 3 }] })]);
    // A word that does not beat the day's score still belongs in the feed.
    await submitScores("ann", [score({ total: 12, found: [{ word: "second", zipf: 4 }] })]);

    expect((await readFinds(WED)).map((find) => find.word).sort()).toEqual(["first", "second"]);
  });

  it("belongs to its own puzzle and no other", async () => {
    await submitScores("ann", [score({ date: WED, found: [{ word: "first", zipf: 3 }] })]);
    expect(await readFinds(SAT)).toEqual([]);
  });
});

describe("a batch naming the same day twice", () => {
  it("keeps the better entry rather than letting the second overwrite the first", async () => {
    await submitScores("ann", [
      score({ total: 20, word: "zarf", zipf: 1.1 }),
      score({ total: 6, word: "common", zipf: 5 }),
    ]);

    expect((await readBoard("d", WED))[0]).toMatchObject({
      score: 20,
      windowWord: "zarf",
    });
  });

  it("counts it as one day in the windows", async () => {
    await submitScores("ann", [score({ total: 20 }), score({ total: 6 })]);
    expect((await readBoard("w", WEEK))[0]).toMatchObject({ score: 20, puzzles: 1 });
  });
});

describe("the website's players, merged in", () => {
  it("rank against Reddit's own on the same terms", async () => {
    await submitScores("ann", [score({ total: 12, word: "common", zipf: 5 })]);
    await seedImportedBoard("w", WEEK, [
      { playerId: "uuid-a", windowWord: "zarf", windowZipf: 1.1, score: 30 },
      { playerId: "uuid-b", windowWord: "common", windowZipf: 5, score: 4 },
    ]);

    const board = await readBoard("w", WEEK);
    expect(board.map((row) => [row.playerId, row.source])).toEqual([
      ["uuid-a", "w"],
      ["ann", "r"],
      ["uuid-b", "w"],
    ]);
    expect(board.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("are marked so the client can tell the two populations apart", async () => {
    await seedImportedBoard("w", WEEK, [
      { playerId: "uuid-a", windowWord: "zarf", windowZipf: 1.1, score: 30 },
    ]);
    await submitScores("ann", [score()]);

    const board = await readBoard("w", WEEK);
    expect(board.find((row) => row.playerId === "ann")?.source).toBe("r");
    expect(board.find((row) => row.playerId === "uuid-a")?.source).toBe("w");
  });

  it("show up even when no Reddit player has scored yet", async () => {
    // The case a fresh install is in on day one: an empty sorted set must not
    // short-circuit the read before the imported half is looked at.
    await seedImportedBoard("w", WEEK, [
      { playerId: "uuid-a", windowWord: "zarf", windowZipf: 1.1, score: 30 },
    ]);
    expect((await readBoard("w", WEEK)).map((row) => row.playerId)).toEqual(["uuid-a"]);
  });

  it("lose a tie on total to the rarer word, whichever game it came from", async () => {
    await submitScores("ann", [score({ total: 10, word: "zarf", zipf: 1.1 })]);
    await seedImportedBoard("w", WEEK, [
      { playerId: "uuid-a", windowWord: "common", windowZipf: 5, score: 10 },
    ]);
    expect((await readBoard("w", WEEK))[0]?.playerId).toBe("ann");
  });

  it("never satisfy a Reddit player's own below-the-cut row", async () => {
    // An imported id could in principle collide with a username. The self row is
    // about a Reddit account, so only a Reddit row can be it.
    await submitScores("ann", [score({ total: 1 })]);
    await seedImportedBoard(
      "w",
      WEEK,
      [
        { playerId: "ann", windowWord: "zarf", windowZipf: 1.1, score: 99 },
        ...Array.from({ length: 15 }, (_unused, i) => ({
          playerId: `uuid-${i}`,
          windowWord: "common",
          windowZipf: 5,
          score: 90 - i,
        })),
      ],
    );

    const board = await readBoard("w", WEEK, 15);
    expect(board.every((row) => row.source === "w")).toBe(true);
    // Still owed their own row: the `ann` up there is somebody else's id.
    expect(await readSelf("w", WEEK, "ann", board)).toMatchObject({
      playerId: "ann",
      source: "r",
      score: 1,
    });
  });

  it("are counted when ranking a player below the cut", async () => {
    // The rank comes off a sorted set holding only Reddit's players. On a merged
    // board that is not the rank the player holds, so the imported rows above
    // them have to be counted too.
    await submitScores("ann", [score({ total: 1 })]);
    await seedImportedBoard(
      "w",
      WEEK,
      Array.from({ length: 20 }, (_unused, i) => ({
        playerId: `uuid-${i}`,
        windowWord: "common",
        windowZipf: 5,
        score: 100 - i,
      })),
    );

    const board = await readBoard("w", WEEK, 15);
    expect(await readSelf("w", WEEK, "ann", board)).toMatchObject({ rank: 21 });
  });

  it("fold into the finds feed by word, carrying both counts", async () => {
    await submitScores("ann", [score({ found: [{ word: "quixotic", zipf: 2.5 }] })]);
    await seedImportedFinds(WED, [
      { word: "quixotic", zipf: 2.5, finders: 40 },
      { word: "zarf", zipf: 1.1, finders: 3 },
    ]);

    const finds = await readFinds(WED);
    expect(finds.find((f) => f.word === "quixotic")?.finders).toBe(41);
    expect(finds.find((f) => f.word === "zarf")?.finders).toBe(3);
  });

  it("carry the feed alone when Reddit has found nothing yet", async () => {
    await seedImportedFinds(WED, [{ word: "zarf", zipf: 1.1, finders: 3 }]);
    expect((await readFinds(WED)).map((f) => f.word)).toEqual(["zarf"]);
  });

  it("leave the board working when nothing has been imported", async () => {
    await submitScores("ann", [score()]);
    expect((await readBoard("w", WEEK)).map((row) => row.playerId)).toEqual(["ann"]);
    expect(await readFinds(WED)).toEqual([]);
  });
});
