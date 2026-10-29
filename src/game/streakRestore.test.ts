import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStreak, STREAK_KEY } from "./storage";
import { parseRestoredStreak, restoreStreak, type RestoredStreak } from "./streakRestore";

const PLAYER = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";

function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T12:00:00`));
}

function stubRestore(streak: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ streak }), { status })
      : new Response("boom", { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const RUN: RestoredStreak = {
  current: 6,
  best: 9,
  saved: 1,
  lastPlayed: "2026-08-24",
  playedDates: ["2026-08-23", "2026-08-24"],
  daysPlayed: 21,
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("restoring a streak into a fresh browser", () => {
  it("carries on the run the board has on file", async () => {
    setToday("2026-08-25");
    const fetchMock = stubRestore(RUN);

    expect(await restoreStreak(PLAYER)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/leaderboard?restore=${PLAYER}`,
      expect.objectContaining({ cache: "no-store" })
    );
    const streak = loadStreak();
    expect(streak.currentStreak).toBe(6);
    expect(streak.longestStreak).toBe(9);
    expect(streak.lastCompletedDate).toBe("2026-08-24");
    expect(streak.bankedFreezes).toBe(1);
    expect(streak.totalCompleted).toBe(21);
  });

  it("spends a saved freeze on a day missed since, as the browser that played it would", async () => {
    setToday("2026-08-26");
    stubRestore(RUN);
    await restoreStreak(PLAYER);

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(6);
    expect(streak.bankedFreezes).toBe(0);
    expect(streak.frozenDates).toEqual(["2026-08-25"]);
  });

  it("ends a run the missed days have outlasted, keeping the best", async () => {
    setToday("2026-08-28");
    stubRestore(RUN);
    await restoreStreak(PLAYER);

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(0);
    expect(streak.longestStreak).toBe(9);
  });

  it("rests an earned weekend, from the days on the board", async () => {
    // Three days played Monday to Friday earn the weekend off.
    setToday("2026-11-09");
    stubRestore({
      current: 3,
      best: 3,
      saved: 0,
      lastPlayed: "2026-11-06",
      playedDates: ["2026-11-02", "2026-11-04", "2026-11-06"],
      daysPlayed: 3,
    });
    await restoreStreak(PLAYER);

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(3);
    expect(streak.frozenDates ?? []).toEqual([]);
  });

  it("leaves a browser that already has a streak alone", async () => {
    setToday("2026-08-25");
    localStorage.setItem(STREAK_KEY, JSON.stringify({ currentStreak: 2, longestStreak: 2 }));
    const fetchMock = stubRestore(RUN);

    expect(await restoreStreak(PLAYER)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(STREAK_KEY)!).currentStreak).toBe(2);
  });

  it("stores nothing for a player with no streak, or when the board is down", async () => {
    setToday("2026-08-25");
    stubRestore(null);
    expect(await restoreStreak(PLAYER)).toBe(false);
    stubRestore(null, 502);
    expect(await restoreStreak(PLAYER)).toBe(false);
    expect(localStorage.getItem(STREAK_KEY)).toBeNull();
  });
});

describe("reading a restored streak", () => {
  it("refuses one that does not add up", () => {
    expect(parseRestoredStreak({ ...RUN, current: 0 })).toBeNull();
    expect(parseRestoredStreak({ ...RUN, best: 5 })).toBeNull();
    expect(parseRestoredStreak({ ...RUN, saved: 4 })).toBeNull();
    expect(parseRestoredStreak({ ...RUN, lastPlayed: "yesterday" })).toBeNull();
  });

  it("always counts the last played day among the days played", () => {
    expect(parseRestoredStreak({ ...RUN, playedDates: ["bad", "2026-08-30"] })?.playedDates).toEqual([
      "2026-08-24",
    ]);
  });
});
