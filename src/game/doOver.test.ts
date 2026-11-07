import { beforeEach, describe, expect, it } from "vitest";
import { doOverHeld, doOverPlays, doOverProgress, doOverTomorrow, spendDoOver } from "./doOver";
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

const SUN = "2026-11-01";
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const THU = "2026-11-05";
const FRI = "2026-11-06";
const SAT = "2026-11-07";
const NEXT_MON = "2026-11-09";

beforeEach(() => localStorage.clear());

describe("do-over", () => {
  it("counts days played from Monday 2026-11-02, so everyone starts at 0", () => {
    expect(doOverPlays(streak(["2026-10-30", SUN, MON, TUE]), TUE)).toBe(2);
    // The weekly do-over's spent mark is ignored.
    localStorage.setItem("ick:do-over-spent", MON);
    expect(doOverPlays(streak([MON, TUE]), TUE)).toBe(2);
  });

  it("is earned on the third day played and never expires", () => {
    expect(doOverHeld(streak([MON, TUE]), TUE)).toBe(false);
    expect(doOverHeld(streak([MON, TUE, WED]), WED)).toBe(true);
    expect(doOverHeld(streak([MON, TUE, WED]), "2026-12-20")).toBe(true);
    // Only one is held.
    expect(doOverProgress(streak([MON, TUE, WED, THU, FRI, SAT]), SAT)).toEqual({ played: 3 });
  });

  it("counts again from the day after it is spent", () => {
    const days = [MON, TUE, WED, THU, FRI];
    spendDoOver(WED);
    expect(doOverHeld(streak(days), FRI)).toBe(false);
    expect(doOverProgress(streak(days), FRI)).toEqual({ played: 2 });
    expect(doOverHeld(streak([...days, SAT]), SAT)).toBe(true);
  });

  it("is a day away only on the second day played", () => {
    expect(doOverTomorrow(streak([MON, TUE]), TUE)).toBe(true);
    expect(doOverTomorrow(streak([MON]), MON)).toBe(false);
    expect(doOverTomorrow(streak([MON, TUE]), WED)).toBe(false);
  });
});
