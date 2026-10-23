import { beforeEach, describe, expect, it } from "vitest";
import {
  formatCountdown,
  googleCalendarUrl,
  loadReminderAdded,
  msUntilNextDrop,
  reminderIcs,
  reminderStart,
  saveReminderAdded,
  streakGoal,
} from "./comeBack";
import type { StreakState } from "./types";

const streak = (over: Partial<StreakState>): StreakState => ({
  currentStreak: 1,
  longestStreak: 1,
  totalCompleted: 1,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
  ...over,
});

describe("msUntilNextDrop", () => {
  it("counts to the next local midnight", () => {
    expect(msUntilNextDrop(new Date(2026, 9, 23, 18, 48, 0))).toBe((5 * 60 + 12) * 60_000);
    expect(msUntilNextDrop(new Date(2026, 9, 23, 0, 0, 0))).toBe(24 * 60 * 60_000);
  });
});

describe("formatCountdown", () => {
  it("shows hours and minutes, then minutes, then under a minute", () => {
    expect(formatCountdown((5 * 60 + 12) * 60_000 + 59_000)).toBe("5h 12m");
    expect(formatCountdown(12 * 60_000)).toBe("12m");
    expect(formatCountdown(59_000)).toBe("under a minute");
  });
});

describe("streakGoal", () => {
  it("tells a first-day player a streak starts tomorrow, and when the first freeze comes", () => {
    expect(streakGoal(streak({}))).toEqual({
      headline: "Play tomorrow to start a streak.",
      detail: "2 days to your next 🧊 streak freeze.",
    });
  });

  it("names the freeze tomorrow earns", () => {
    expect(streakGoal(streak({ currentStreak: 2, longestStreak: 2 })).detail).toMatch(
      /^Tomorrow earns a 🧊 freeze/
    );
    // Day 7 earns one too, while there is room under the cap.
    expect(
      streakGoal(streak({ currentStreak: 6, longestStreak: 6, bankedFreezes: 0 })).detail
    ).toMatch(/^Tomorrow earns/);
  });

  it("does not promise a freeze the cap would not keep", () => {
    // 4 days, one freeze held, cap 1 until 14 days: day 7 earns nothing kept,
    // and day 14 is the first that raises the cap.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 4, bankedFreezes: 1 }))
    ).toEqual({
      headline: "Play tomorrow to make it a 5-day streak.",
      detail: "10 days to your next 🧊 streak freeze.",
    });
  });

  it("falls back to the best streak, then to a new record", () => {
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 })).detail
    ).toBe("11 days to beat your best streak of 40.");
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 3 })).detail
    ).toBe("This is your longest streak yet.");
  });
});

describe("the daily reminder", () => {
  const now = new Date(2026, 9, 23, 9, 41, 0);

  it("starts tomorrow at the half hour the player is playing now", () => {
    expect(reminderStart(now, "2026-10-23")).toBe("20261024T093000");
    expect(reminderStart(new Date(2026, 9, 31, 21, 5), "2026-10-31")).toBe("20261101T210000");
  });

  it("is a daily repeating event with an alarm, in CRLF iCalendar", () => {
    const ics = reminderIcs(now, "2026-10-23");
    expect(ics.split("\r\n")).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "DTSTART:20261024T093000",
        "RRULE:FREQ=DAILY",
        "TRIGGER:PT0M",
        "URL:https://wordink.app/?s=rem",
        "END:VCALENDAR",
      ])
    );
    expect(ics).toContain("DESCRIPTION:Find the rarest word with today's letters. https://wordink.app/?s=rem");
  });

  it("links to Google Calendar with the same start and a daily rule", () => {
    const url = new URL(googleCalendarUrl(now, "2026-10-23"));
    expect(url.searchParams.get("dates")).toBe("20261024T093000/20261024T093500");
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=DAILY");
  });

  beforeEach(() => localStorage.clear());

  it("remembers that it was added", () => {
    expect(loadReminderAdded()).toBe(false);
    saveReminderAdded();
    expect(loadReminderAdded()).toBe(true);
  });
});
