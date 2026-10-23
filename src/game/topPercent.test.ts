import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STANDING_KEY,
  checkStanding,
  ordinal,
  percentAhead,
  standingCopy,
  topPercentBand,
} from "./topPercent";
import { PLAYER_KEY } from "./player";

describe("topPercentBand", () => {
  it("awards the tightest band a rank reaches", () => {
    expect(topPercentBand(1, 200)).toBe(1);
    expect(topPercentBand(2, 200)).toBe(1);
    expect(topPercentBand(3, 200)).toBe(5);
    expect(topPercentBand(10, 200)).toBe(5);
    expect(topPercentBand(11, 200)).toBe(10);
    expect(topPercentBand(20, 200)).toBe(10);
    expect(topPercentBand(21, 200)).toBeNull();
  });

  it("only hands out a band once the board is big enough to have one", () => {
    // Second of three is not the top 5% of anything worth saying.
    expect(topPercentBand(1, 9)).toBeNull();
    expect(topPercentBand(2, 3)).toBeNull();
    expect(topPercentBand(2, 19)).toBeNull();
    expect(topPercentBand(2, 20)).toBe(10);
    expect(topPercentBand(2, 40)).toBe(5);
    expect(topPercentBand(2, 199)).toBe(5);
  });

  it("gives nothing to a lost run or a rank off the board", () => {
    expect(topPercentBand(null, 500)).toBeNull();
    expect(topPercentBand(0, 500)).toBeNull();
    expect(topPercentBand(501, 500)).toBeNull();
  });
});

describe("the standing copy", () => {
  it("says how far ahead of the field a rank is", () => {
    expect(percentAhead(12, 340)).toBe(96);
    expect(percentAhead(1, 100)).toBe(99);
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(112)).toBe("112th");
  });

  it("names the band and the place, for a climb and for a finished month", () => {
    const base = { band: 5 as const, rank: 12, size: 340, month: "2026-10-01", mode: "standard" as const };
    expect(standingCopy({ ...base, kind: "entered" })).toEqual({
      title: "Top 5% this month!",
      body: "You're 12th of 340 players so far, ahead of 96% of them.",
    });
    const finished = standingCopy({ ...base, kind: "month" });
    expect(finished.title).toMatch(/top 5%!$/);
    expect(finished.body).toBe("You finished 12th of 340 players, ahead of 96% of them.");
  });
});

describe("checkStanding", () => {
  const ME = "00000000-0000-4000-8000-00000000abcd";

  /** A month board of `size` players with this browser at `rank`. */
  function board(rank: number, size: number) {
    return Array.from({ length: size }, (_, index) => ({
      rank: index + 1,
      playerId: index + 1 === rank ? ME : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      windowWord: "word",
      windowZipf: 3,
      score: 100 - index,
      puzzles: 1,
    }));
  }

  function stubMonth(rank: number, size: number) {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      new Response(
        JSON.stringify({ weekStart: "2026-10-18", mode: "standard", daily: [], weekly: [], allTime: board(rank, size) }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks nothing of a browser with no player", async () => {
    localStorage.removeItem(PLAYER_KEY);
    const fetchMock = stubMonth(4, 100);
    expect(await checkStanding("2026-10-23")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces a band once, and again only when it tightens", async () => {
    stubMonth(8, 100);
    expect(await checkStanding("2026-10-23")).toMatchObject({ kind: "entered", band: 10, rank: 8, size: 100 });
    expect(await checkStanding("2026-10-23")).toBeNull();
    stubMonth(4, 100);
    expect(await checkStanding("2026-10-23")).toMatchObject({ kind: "entered", band: 5 });
    // Slipping back out and in again is not a second party.
    stubMonth(8, 100);
    expect(await checkStanding("2026-10-23")).toBeNull();
  });

  it("says nothing outside a band", async () => {
    stubMonth(30, 100);
    expect(await checkStanding("2026-10-23")).toBeNull();
    expect(localStorage.getItem(STANDING_KEY)).toBeNull();
  });

  it("reports the month just gone once, in its first days", async () => {
    const fetchMock = stubMonth(1, 150);
    expect(await checkStanding("2026-11-02")).toMatchObject({
      kind: "month",
      band: 1,
      rank: 1,
      month: "2026-10-01",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("month=2026-10-01");
    // Reported: the next open looks at this month instead.
    fetchMock.mockClear();
    await checkStanding("2026-11-02");
    expect(String(fetchMock.mock.calls[0][0])).toContain("month=2026-11-01");
  });

  it("leaves a month alone once it is more than a week gone", async () => {
    const fetchMock = stubMonth(1, 150);
    await checkStanding("2026-11-12");
    expect(String(fetchMock.mock.calls[0][0])).toContain("month=2026-11-01");
  });
});
