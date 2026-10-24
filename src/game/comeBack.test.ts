import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "./achievements";
import { streakGoal } from "./comeBack";
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

// A Friday with nothing played that week, which can earn no more: the goals
// other than the weekend off.
const FRIDAY = "2026-11-06";

describe("streakGoal", () => {
  it("tells a first-day player when the first freeze comes", () => {
    expect(streakGoal(streak({}), FRIDAY)).toBe("2 days to your next 🧊 streak freeze.");
  });

  it("names the freeze tomorrow earns", () => {
    expect(streakGoal(streak({ currentStreak: 2, longestStreak: 2 }), FRIDAY)).toMatch(
      /^Tomorrow earns a 🧊 freeze/
    );
    // Day 7 earns one too, while there is room under the cap.
    expect(
      streakGoal(streak({ currentStreak: 6, longestStreak: 6, bankedFreezes: 0 }), FRIDAY)
    ).toMatch(/^Tomorrow earns/);
  });

  it("does not promise a freeze the cap would not keep", () => {
    // 4 days, one freeze held, cap 1 until 14 days: day 7 earns nothing kept,
    // and day 14 is the first that raises the cap.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 4, bankedFreezes: 1 }), FRIDAY)
    ).toBe("10 days until your 🧊 freeze limit goes up to 2.");
  });

  it("says the cap rises when it is full", () => {
    // Back on a 1-day run with a best past 3: one held, the cap rises at 14,
    // but beating the best of 5 is nearer.
    expect(
      streakGoal(streak({ currentStreak: 1, longestStreak: 5, bankedFreezes: 1 }), FRIDAY)
    ).toBe("5 days to beat your best streak of 5.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 13, bankedFreezes: 1 }), FRIDAY)
    ).toBe("Tomorrow your 🧊 freeze limit goes up to 2, and you earn a freeze to fill it.");
    // Two is the most the cap ever reaches, so a full one past 14 days never rises.
    expect(
      streakGoal(streak({ currentStreak: 20, longestStreak: 20, bankedFreezes: 2 }), FRIDAY)
    ).toBeNull();
  });

  it("promises no freeze to a player still holding three from the old cap", () => {
    expect(
      streakGoal(streak({ currentStreak: 27, longestStreak: 40, bankedFreezes: 3 }), FRIDAY)
    ).toBe("14 days to beat your best streak of 40.");
  });

  it("counts the freeze a holder would add when there is room for it", () => {
    // Cap 2 from a best of 20, one held: day 14 of this run earns the 2nd.
    expect(
      streakGoal(streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 1 }), FRIDAY)
    ).toBe("6 days to a 2nd 🧊 streak freeze.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 20, bankedFreezes: 1 }), FRIDAY)
    ).toBe("Tomorrow earns a 2nd 🧊 streak freeze.");
  });

  it("falls back to the best streak, then to nothing", () => {
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 }), FRIDAY)
    ).toBe("11 days to beat your best streak of 40.");
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 3 }), FRIDAY)
    ).toBeNull();
  });

  it("names whichever of the next freeze and the best streak is nearer", () => {
    // Cap full at 1 until 14 days: the cap rises 10 days out, the best is 3 away.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 1 }), FRIDAY)
    ).toBe("3 days to beat your best streak of 6.");
    // A tie goes to the freeze.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 0 }), FRIDAY)
    ).toBe("3 days to your next 🧊 streak freeze.");
  });

  it("never says that tomorrow grows the streak", () => {
    for (let days = 1; days <= 60; days++) {
      for (const banked of [0, 1, 2, 3]) {
        const goal = streakGoal(streak({ currentStreak: days, longestStreak: days, bankedFreezes: banked }), FRIDAY);
        expect(goal ?? "").not.toMatch(/make it a/);
      }
    }
  });

  describe("Weekend off", () => {
    // 2026-10-31 is the first Saturday that can be earned; its week runs 10-26 to 11-01.
    const run = (playedDates: string[]) =>
      streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 2, playedDates });

    it("counts down the days still needed while the week has room", () => {
      expect(streakGoal(run(["2026-10-26"]), "2026-10-26")).toBe("2 more days by Friday unlocks a lazy weekend 😴");
      expect(streakGoal(run(["2026-10-27", "2026-10-28"]), "2026-10-28")).toBe(
        "Play tomorrow for a lazy weekend 😴"
      );
      // Too late for the whole weekend: Saturday played as the third still rests Sunday.
      expect(streakGoal(run(["2026-10-27", "2026-10-30"]), "2026-10-30")).toBe("Play tomorrow for a lazy Sunday 😴");
      expect(streakGoal(run(["2026-10-29"]), "2026-10-29")).toBe("2 more days by Saturday unlocks a lazy Sunday 😴");
      // A Sunday played looks to the next week.
      expect(streakGoal(run(["2026-11-01"]), "2026-11-01")).toBe("3 more days by Friday unlocks a lazy weekend 😴");
    });

    it("is not mentioned once unlocked", () => {
      // Cap full and the best streak 12 days off: nothing nearer to say instead.
      expect(streakGoal(run(["2026-10-26", "2026-10-27", "2026-10-28"]), "2026-10-28")).toBe(
        "13 days to beat your best streak of 20."
      );
      expect(streakGoal(run(["2026-10-26", "2026-10-28", "2026-10-30"]), "2026-10-30")).not.toMatch(/lazy weekend/);
    });

    it("does not promise one the week has no room left for", () => {
      expect(streakGoal(run(["2026-10-30"]), "2026-10-30")).not.toMatch(/lazy/);
      expect(streakGoal(run(["2026-10-31"]), "2026-10-31")).not.toMatch(/lazy/);
    });

    it("is ranked by how soon it lands, a tie going to the freeze", () => {
      // Both two days away: the freeze.
      expect(
        streakGoal(streak({ currentStreak: 1, longestStreak: 1, playedDates: ["2026-10-26"] }), "2026-10-26")
      ).toBe("2 days to your next 🧊 streak freeze.");
      // Two days to a lazy weekend, four to the cap rising at 14.
      expect(
        streakGoal(
          streak({ currentStreak: 10, longestStreak: 10, bankedFreezes: 1, playedDates: ["2026-10-26"] }),
          "2026-10-26"
        )
      ).toBe("2 more days by Friday unlocks a lazy weekend 😴");
      // Tied with beating the best: the lazy weekend, which lapses.
      expect(
        streakGoal(
          streak({ currentStreak: 8, longestStreak: 9, bankedFreezes: 2, playedDates: ["2026-10-26"] }),
          "2026-10-26"
        )
      ).toBe("2 more days by Friday unlocks a lazy weekend 😴");
    });

    it("comes after a freeze tomorrow earns", () => {
      expect(
        streakGoal(streak({ currentStreak: 2, longestStreak: 2, playedDates: ["2026-10-26"] }), "2026-10-26")
      ).toMatch(/^Tomorrow earns a 🧊 freeze/);
    });
  });

  describe("with nothing else ahead", () => {
    // Cap full, no lazy weekend, and the best streak is this one.
    const maxed = streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2 });
    const locked = ACHIEVEMENTS.slice(0, 3).map((achievement) => ({ achievement, earnedOn: null }));

    it("names a locked achievement, the same all day", () => {
      const line = streakGoal(maxed, FRIDAY, locked) ?? "";
      expect(line).toMatch(/^Still to unlock: /);
      expect(locked.some(({ achievement }) => line.includes(achievement.title))).toBe(true);
      expect(streakGoal(maxed, FRIDAY, locked)).toBe(line);
    });

    it("says how far along a count is", () => {
      const words = ACHIEVEMENTS.find((a) => a.id === "words-100")!;
      expect(
        streakGoal(maxed, FRIDAY, [{ achievement: words, earnedOn: null, progress: { current: 64, target: 100 } }])
      ).toBe("Still to unlock: 📚 Hundred words (64/100). Bank 100 words.");
    });

    it("picks from them over the days", () => {
      const lines = new Set(
        ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11"].map((date) =>
          streakGoal(maxed, date, locked)
        )
      );
      expect(lines.size).toBeGreaterThan(1);
    });

    it("is not used while anything else is ahead", () => {
      expect(streakGoal(streak({}), FRIDAY, locked)).toBe("2 days to your next 🧊 streak freeze.");
    });

    it("says nothing with every achievement earned", () => {
      expect(streakGoal(maxed, FRIDAY, [])).toBeNull();
    });
  });
});
