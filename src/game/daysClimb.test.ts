import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkDaysClimb, daysClimb, daysRankIn, rememberDaysRank } from "./daysClimb";
import { fetchTotalBoard, type TotalBoard, type TotalEntry } from "./leaderboard";
import { PLAYER_KEY } from "./player";

vi.mock("./leaderboard", () => ({ fetchTotalBoard: vi.fn() }));

const ME = "11111111-1111-4111-8111-111111111111";

function row(playerId: string, rank: number, puzzles = 10): TotalEntry {
  return {
    rank,
    playerId,
    name: playerId,
    puzzles,
    firstPlayed: "2026-09-01",
    lastPlayed: "2026-10-24",
  };
}

function board(entries: TotalEntry[], self: TotalEntry | null = null): TotalBoard {
  return { entries, self };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchTotalBoard).mockReset();
});

describe("daysRankIn", () => {
  it("finds the player on the board or below the cut", () => {
    expect(daysRankIn(board([row("a", 1), row(ME, 2)]), ME)).toBe(2);
    expect(daysRankIn(board([row("a", 1)], row(ME, 40)), ME)).toBe(40);
  });

  it("has no rank for a stranger or nobody", () => {
    expect(daysRankIn(board([row("a", 1)]), ME)).toBeNull();
    expect(daysRankIn(board([row(ME, 1)]), null)).toBeNull();
  });
});

describe("daysClimb", () => {
  it("is a move to a smaller rank than the one last seen", () => {
    rememberDaysRank(12);
    expect(daysClimb(9, 30)).toEqual({ from: 12, to: 9, days: 30 });
  });

  it("is nothing with no rank remembered, or no rise", () => {
    expect(daysClimb(3, 30)).toBeNull();
    rememberDaysRank(5);
    expect(daysClimb(5, 30)).toBeNull();
    expect(daysClimb(7, 30)).toBeNull();
    expect(daysClimb(null, 30)).toBeNull();
  });
});

describe("checkDaysClimb", () => {
  it("asks for nothing for a player who has not joined", async () => {
    expect(await checkDaysClimb()).toBeNull();
    expect(fetchTotalBoard).not.toHaveBeenCalled();
  });

  it("reads one fresh row, reports the climb, and remembers the new rank", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    rememberDaysRank(12);
    vi.mocked(fetchTotalBoard).mockResolvedValue(board([row("a", 1)], row(ME, 9, 31)));
    expect(await checkDaysClimb()).toEqual({ from: 12, to: 9, days: 31 });
    expect(fetchTotalBoard).toHaveBeenCalledWith(ME, { limit: 1, fresh: true });
    // The same rank again is no news.
    expect(await checkDaysClimb()).toBeNull();
  });

  it("learns a first rank without announcing it", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    vi.mocked(fetchTotalBoard).mockResolvedValue(board([row("a", 1)], row(ME, 3)));
    expect(await checkDaysClimb()).toBeNull();
    expect(daysClimb(2, 10)).toEqual({ from: 3, to: 2, days: 10 });
  });

  it("swallows a failed read", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    rememberDaysRank(12);
    vi.mocked(fetchTotalBoard).mockRejectedValue(new Error("offline"));
    expect(await checkDaysClimb()).toBeNull();
  });
});
