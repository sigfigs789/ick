import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkStreakClimb,
  rememberStreakRank,
  streakClimb,
  streakRankIn,
} from "./streakClimb";
import { fetchBoards, type Boards, type StreakEntry } from "./leaderboard";
import { PLAYER_KEY } from "./player";

vi.mock("./leaderboard", () => ({ fetchBoards: vi.fn() }));

const ME = "11111111-1111-4111-8111-111111111111";

function row(playerId: string, rank: number | null, current = 5): StreakEntry {
  return {
    rank,
    playerId,
    name: playerId,
    current,
    best: current,
    frozen: false,
    covered: false,
    atRisk: false,
    lost: rank === null,
    resting: false,
  };
}

function boards(
  streak: StreakEntry[] | null,
  streakSelf: StreakEntry | null = null
): Pick<Boards, "streak" | "streakSelf"> {
  return { streak, streakSelf };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchBoards).mockReset();
});

describe("streakRankIn", () => {
  it("finds the player on the board or below the cut", () => {
    expect(streakRankIn(boards([row("a", 1), row(ME, 2)]), ME)).toBe(2);
    expect(streakRankIn(boards([row("a", 1)], row(ME, 40)), ME)).toBe(40);
  });

  it("has no rank for a stranger, a lost run, or a build with no board", () => {
    expect(streakRankIn(boards([row("a", 1)]), ME)).toBeNull();
    expect(streakRankIn(boards([row(ME, null)]), ME)).toBeNull();
    expect(streakRankIn(boards(null), ME)).toBeNull();
    expect(streakRankIn(boards([row(ME, 1)]), null)).toBeNull();
  });
});

describe("streakClimb", () => {
  it("is a move to a smaller rank than the one last seen", () => {
    rememberStreakRank(12);
    expect(streakClimb(9)).toEqual({ from: 12, to: 9 });
  });

  it("is nothing with no rank remembered, or no rise", () => {
    expect(streakClimb(3)).toBeNull();
    rememberStreakRank(5);
    expect(streakClimb(5)).toBeNull();
    expect(streakClimb(7)).toBeNull();
    expect(streakClimb(null)).toBeNull();
  });
});

describe("checkStreakClimb", () => {
  it("asks for nothing for a player who has not joined", async () => {
    expect(await checkStreakClimb("2026-10-24")).toBeNull();
    expect(fetchBoards).not.toHaveBeenCalled();
  });

  it("reads one fresh row, reports the climb, and remembers the new rank", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    rememberStreakRank(12);
    vi.mocked(fetchBoards).mockResolvedValue(
      boards([row("a", 1)], row(ME, 9)) as Boards
    );
    expect(await checkStreakClimb("2026-10-24")).toEqual({ from: 12, to: 9 });
    expect(fetchBoards).toHaveBeenCalledWith("2026-10-24", { limit: 1, fresh: true });
    // The same rank again is no news.
    expect(await checkStreakClimb("2026-10-24")).toBeNull();
  });

  it("learns a first rank without announcing it", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    vi.mocked(fetchBoards).mockResolvedValue(boards([row(ME, 3)]) as Boards);
    expect(await checkStreakClimb("2026-10-24")).toBeNull();
    expect(streakClimb(2)).toEqual({ from: 3, to: 2 });
  });

  it("swallows a failed read", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: ME }));
    rememberStreakRank(12);
    vi.mocked(fetchBoards).mockRejectedValue(new Error("offline"));
    expect(await checkStreakClimb("2026-10-24")).toBeNull();
  });
});
