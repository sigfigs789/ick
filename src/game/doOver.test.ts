import { beforeEach, describe, expect, it } from "vitest";
import { doOverHeld, doOverPlays, doOverProgress, doOverSpent, doOverTomorrow, spendDoOver } from "./doOver";
import type { StreakState } from "./types";

const streak = (playedDates: string[]): StreakState => ({
  currentStreak: playedDates.length,
  longestStreak: playedDates.length,
  totalCompleted: 0,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
  playedDates,
});

// The week of Monday 2026-11-02 to Sunday 2026-11-08.
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const THU = "2026-11-05";
const SAT = "2026-11-07";
const SUN = "2026-11-08";

beforeEach(() => localStorage.clear());

describe("do-over", () => {
  it("counts only this week's days played", () => {
    expect(doOverPlays(streak(["2026-11-01", MON, TUE]), TUE)).toBe(2);
  });

  it("is held from the fourth day played until spent, once a week", () => {
    expect(doOverHeld(streak([MON, TUE, WED]), WED)).toBe(false);
    expect(doOverHeld(streak([MON, TUE, WED, THU]), THU)).toBe(true);
    spendDoOver(THU);
    expect(doOverSpent(SUN)).toBe(true);
    // A fifth day earns no second one.
    expect(doOverHeld(streak([MON, TUE, WED, THU, SAT]), SAT)).toBe(false);
    // Next week starts fresh.
    expect(doOverSpent("2026-11-09")).toBe(false);
  });

  it("says whether 4 days can still be reached this week", () => {
    expect(doOverProgress(streak([MON]), MON)).toEqual({ played: 1, reachable: true, spent: false });
    // Saturday unplayed with one day played: Saturday and Sunday make three.
    expect(doOverProgress(streak([MON]), SAT).reachable).toBe(false);
    expect(doOverProgress(streak([MON, TUE]), SAT).reachable).toBe(true);
  });

  it("is a day away only on the third day played, with tomorrow in the week", () => {
    expect(doOverTomorrow(streak([MON, TUE, WED]), WED)).toBe(true);
    expect(doOverTomorrow(streak([MON, TUE]), TUE)).toBe(false);
    // Today not played yet.
    expect(doOverTomorrow(streak([MON, TUE, WED]), THU)).toBe(false);
    // Sunday ends the week.
    expect(doOverTomorrow(streak([MON, TUE, SUN]), SUN)).toBe(false);
  });
});
