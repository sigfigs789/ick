import { describe, expect, it } from "vitest";
import { reminderRiskDate, shouldOfferReminders } from "./streakReminder";
import type { StreakState } from "./types";

const base: StreakState = {
  currentStreak: 3,
  longestStreak: 3,
  lastCompletedDate: "2026-11-18", // a Wednesday
  totalCompleted: 3,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
  bankedFreezes: 0,
  playedDates: ["2026-11-16", "2026-11-17", "2026-11-18"],
};

describe("reminderRiskDate", () => {
  it("is today before today is played", () => {
    expect(reminderRiskDate(base, "2026-11-19")).toBe("2026-11-19");
  });
  it("is tomorrow once today is played", () => {
    expect(reminderRiskDate({ ...base, lastCompletedDate: "2026-11-19" }, "2026-11-19")).toBe(
      "2026-11-20"
    );
  });
  it("is null with no streak or a saved freeze to spend", () => {
    expect(reminderRiskDate({ ...base, currentStreak: 0 }, "2026-11-19")).toBeNull();
    expect(reminderRiskDate({ ...base, bankedFreezes: 1 }, "2026-11-19")).toBeNull();
  });
  it("is null on an earned rest day", () => {
    const streak = {
      ...base,
      lastCompletedDate: "2026-11-20",
      playedDates: ["2026-11-16", "2026-11-18", "2026-11-20"],
    };
    expect(reminderRiskDate(streak, "2026-11-20")).toBeNull(); // Saturday tomorrow, earned
  });
});

describe("shouldOfferReminders", () => {
  const ready = {
    playedDays: 3,
    supported: true,
    permission: "default" as const,
    dismissed: false,
  };
  it("offers from the 3rd day played, played today or not", () => {
    expect(shouldOfferReminders(ready)).toBe(true);
    expect(shouldOfferReminders({ ...ready, playedDays: 10 })).toBe(true);
  });
  it.each([
    { playedDays: 2 },
    { supported: false },
    { permission: "granted" as const },
    { permission: "denied" as const },
    { dismissed: true },
  ])("does not offer when %o", (change) => {
    expect(shouldOfferReminders({ ...ready, ...change })).toBe(false);
  });
});
