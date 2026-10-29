import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "./achievements";
import { ACHIEVEMENT_VERBS, comeBackGoal as rawComeBackGoal, streakGoal as rawStreakGoal } from "./comeBack";
import { addDays } from "./date";
import type { StreakState } from "./types";

// Every achievement line as if it opened "Shoot for", whichever verb the day drew.
const leadingVerb = new RegExp(`^(${ACHIEVEMENT_VERBS.join("|")}) (?=\\S+ ")`);
const sameVerb = (line: string) => line.replace(leadingVerb, "Shoot for ");
const streakGoal = (...args: Parameters<typeof rawStreakGoal>) => {
  const line = rawStreakGoal(...args);
  return line === null ? null : sameVerb(line);
};
const comeBackGoal = (...args: Parameters<typeof rawComeBackGoal>) => {
  const goal = rawComeBackGoal(...args);
  return goal && { ...goal, line: sameVerb(goal.line) };
};

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
  it("tells a new player only of an achievement", () => {
    const locked = [{ achievement: ACHIEVEMENTS.find((a) => a.id === "clean-sweep")!, earnedOn: null }];
    expect(streakGoal(streak({}), FRIDAY, locked)).toBe('Shoot for 🧹 "Clean sweep" Achievement!');
    // Not of a freeze, a lazy weekend or a best streak, even with none locked.
    expect(streakGoal(streak({ playedDates: ["2026-10-26"] }), "2026-10-26")).toBeNull();
    expect(streakGoal(streak({ currentStreak: 0, longestStreak: 1 }), FRIDAY)).toBeNull();
  });

  it("tells a 2-day player when the first freeze comes", () => {
    expect(streakGoal(streak({ currentStreak: 1, longestStreak: 2 }), FRIDAY)).toBe("2 days to your next 🧊 streak freeze.");
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
      expect(streakGoal(run(["2026-10-26"]), "2026-10-26")).toBe("Play 2 more days this week and unlock a lazy weekend 😴");
      expect(streakGoal(run(["2026-10-27", "2026-10-28"]), "2026-10-28")).toBe(
        "Play tomorrow and unlock a lazy weekend 😴"
      );
      // Too late for the whole weekend: Saturday played as the third still rests Sunday.
      expect(streakGoal(run(["2026-10-27", "2026-10-30"]), "2026-10-30")).toBe("Play tomorrow for a lazy Sunday 😴");
      expect(streakGoal(run(["2026-10-29"]), "2026-10-29")).toBe("2 more days by Saturday unlocks a lazy Sunday 😴");
      // A Sunday played looks to the next week.
      expect(streakGoal(run(["2026-11-01"]), "2026-11-01")).toBe("Play 3 more days this week and unlock a lazy weekend 😴");
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
        streakGoal(streak({ currentStreak: 1, longestStreak: 2, playedDates: ["2026-10-26"] }), "2026-10-26")
      ).toBe("2 days to your next 🧊 streak freeze.");
      // Two days to a lazy weekend, four to the cap rising at 14.
      expect(
        streakGoal(
          streak({ currentStreak: 10, longestStreak: 10, bankedFreezes: 1, playedDates: ["2026-10-26"] }),
          "2026-10-26"
        )
      ).toBe("Play 2 more days this week and unlock a lazy weekend 😴");
      // Two days from beating the best too: the best streak, since a lazy
      // weekend only leads from one day away.
      expect(
        streakGoal(
          streak({ currentStreak: 8, longestStreak: 9, bankedFreezes: 2, playedDates: ["2026-10-26"] }),
          "2026-10-26"
        )
      ).toBe("2 days to beat your best streak of 9.");
    });

    it("comes after a freeze tomorrow earns", () => {
      expect(
        streakGoal(streak({ currentStreak: 2, longestStreak: 2, playedDates: ["2026-10-26"] }), "2026-10-26")
      ).toMatch(/^Tomorrow earns a 🧊 freeze/);
    });
  });

  describe("with nothing else soon enough", () => {
    // Cap full, and a Friday with no lazy weekend left to earn.
    const maxed = streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2 });
    const byId = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;
    const lockedOne = (id: string, progress?: { current: number; target: number }) => ({
      achievement: byId(id),
      earnedOn: null,
      progress,
    });

    it("draws a locked achievement at random each day, the easier ones more often", () => {
      // clean-sweep is held by far more players than pantheon or dawn-wall.
      const locked = [lockedOne("pantheon"), lockedOne("clean-sweep"), lockedOne("dawn-wall")];
      const counts = new Map<string, number>();
      let day = "2026-11-01";
      for (let i = 0; i < 365; i++, day = addDays(day, 1)) {
        const line = streakGoal(maxed, day, locked)!;
        counts.set(line, (counts.get(line) ?? 0) + 1);
        // The same all day long.
        expect(streakGoal(maxed, day, locked)).toBe(line);
      }
      const sweep = counts.get('Shoot for 🧹 "Clean sweep" Achievement!') ?? 0;
      // Not the same one every day, but the easiest most often.
      expect(sweep).toBeLessThan(365);
      expect(counts.size).toBeGreaterThan(1);
      for (const [line, count] of counts) if (!line.includes("Clean sweep")) expect(count).toBeLessThan(sweep);
    });

    it("changes from one day to the next", () => {
      const locked = ["clean-sweep", "pantheon", "dawn-wall", "streak-100", "days-50"].map((id) => lockedOne(id));
      const week = Array.from({ length: 7 }, (_, i) => streakGoal(maxed, addDays(FRIDAY, i), locked));
      expect(new Set(week).size).toBeGreaterThan(1);
    });

    it("names the one coming back earns soonest, within 3 days", () => {
      const locked = [
        lockedOne("clean-sweep"),
        lockedOne("streak-100", { current: 30, target: 100 }),
        lockedOne("days-50", { current: 47, target: 50 }),
        lockedOne("words-100", { current: 96, target: 100 }),
      ];
      // 4 words is one day of guesses; 3 more days played is three.
      expect(streakGoal(maxed, FRIDAY, locked)).toBe('Shoot for 📚 "Hundred words" Achievement!');
      expect(streakGoal(maxed, FRIDAY, locked.slice(0, 3))).toBe('Shoot for 🗓️ "Devotee" Achievement!');
    });

    it("counts a streak achievement from the current streak", () => {
      const run = streak({ currentStreak: 28, longestStreak: 28, bankedFreezes: 2 });
      const locked = [lockedOne("clean-sweep"), lockedOne("streak-30", { current: 28, target: 30 })];
      expect(streakGoal(run, FRIDAY, locked)).toBe('Shoot for 🌕 "One month" Achievement!');
    });

    it("falls back to a draw past 3 days, leaving out streaks and days played", () => {
      const locked = [
        lockedOne("days-50", { current: 46, target: 50 }),
        lockedOne("streak-100", { current: 30, target: 100 }),
        lockedOne("words-100", { current: 10, target: 100 }),
        lockedOne("clean-sweep"),
      ];
      let day = FRIDAY;
      const lines = new Set<string | null>();
      for (let i = 0; i < 60; i++, day = addDays(day, 1)) lines.add(streakGoal(maxed, day, locked));
      expect(lines).toEqual(
        new Set(['Shoot for 🧹 "Clean sweep" Achievement!', 'Shoot for 📚 "Hundred words" Achievement!'])
      );
    });

    it("says nothing with only far-off streaks and days played left", () => {
      const locked = [lockedOne("days-50", { current: 46, target: 50 }), lockedOne("streak-100", { current: 30, target: 100 })];
      expect(streakGoal(maxed, FRIDAY, locked)).toBeNull();
      expect(streakGoal(streak({}), FRIDAY, [lockedOne("days-50", { current: 1, target: 50 })])).toBeNull();
    });

    it("opens with a verb drawn for the day", () => {
      const locked = [lockedOne("clean-sweep")];
      const verbs = new Set<string>();
      let day = FRIDAY;
      for (let i = 0; i < 365; i++, day = addDays(day, 1)) {
        const line = rawStreakGoal(maxed, day, locked)!;
        expect(rawStreakGoal(maxed, day, locked)).toBe(line);
        const verb = ACHIEVEMENT_VERBS.find((v) => line.startsWith(`${v} 🧹 `));
        expect(verb).toBeDefined();
        verbs.add(verb!);
      }
      expect(ACHIEVEMENT_VERBS).toHaveLength(16);
      expect(verbs.size).toBe(ACHIEVEMENT_VERBS.length);
    });

    it("explains the achievement, with how far along a count is", () => {
      expect(comeBackGoal(maxed, FRIDAY, [lockedOne("words-100", { current: 64, target: 100 })])).toEqual({
        line: 'Shoot for 📚 "Hundred words" Achievement!',
        explainer: { title: "Hundred words", text: "Bank 100 words. (64/100 so far)" },
      });
    });

    it("comes ahead of beating the best streak", () => {
      const behind = streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 2 });
      expect(streakGoal(behind, FRIDAY, [lockedOne("clean-sweep")])).toBe('Shoot for 🧹 "Clean sweep" Achievement!');
      expect(streakGoal(behind, FRIDAY, [])).toMatch(/beat your best/);
    });

    it("is not used while a freeze is within 2 days", () => {
      expect(streakGoal(streak({ longestStreak: 2 }), FRIDAY, [lockedOne("clean-sweep")])).toBe("2 days to your next 🧊 streak freeze.");
      // A full cap of 1 rises at 14 days: 2 away from 12, 3 away from 11.
      expect(streakGoal(streak({ currentStreak: 12, longestStreak: 12, bankedFreezes: 1 }), FRIDAY, [lockedOne("clean-sweep")])).toBe(
        "2 days until your 🧊 freeze limit goes up to 2."
      );
      expect(streakGoal(streak({ currentStreak: 11, longestStreak: 11, bankedFreezes: 1 }), FRIDAY, [lockedOne("clean-sweep")])).toBe(
        'Shoot for 🧹 "Clean sweep" Achievement!'
      );
    });

    it("is not used while beating the best streak is within 2 days", () => {
      const close = streak({ currentStreak: 39, longestStreak: 40, bankedFreezes: 2 });
      expect(streakGoal(close, FRIDAY, [lockedOne("clean-sweep")])).toBe("2 days to beat your best streak of 40.");
      const far = streak({ currentStreak: 38, longestStreak: 40, bankedFreezes: 2 });
      expect(streakGoal(far, FRIDAY, [lockedOne("clean-sweep")])).toBe('Shoot for 🧹 "Clean sweep" Achievement!');
    });

    it("is not used while a lazy weekend is one day away, and is past that", () => {
      const monday = "2026-10-26";
      const locked = [lockedOne("clean-sweep")];
      const oneAway = streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2, playedDates: ["2026-10-26", "2026-10-27"] });
      expect(streakGoal(oneAway, "2026-10-27", locked)).toBe("Play tomorrow and unlock a lazy weekend 😴");
      const twoAway = streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2, playedDates: [monday] });
      expect(streakGoal(twoAway, monday, locked)).toBe('Shoot for 🧹 "Clean sweep" Achievement!');
    });

    it("says nothing with every achievement earned", () => {
      expect(streakGoal(maxed, FRIDAY, [])).toBeNull();
    });
  });

  describe("comeBackGoal", () => {
    it("explains a freeze", () => {
      expect(comeBackGoal(streak({ longestStreak: 2 }), FRIDAY)?.explainer?.title).toBe("Streak freezes");
    });

    it("explains a lazy weekend, or a lazy Sunday", () => {
      const run = (playedDates: string[]) =>
        streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 2, playedDates });
      expect(comeBackGoal(run(["2026-10-27", "2026-10-28"]), "2026-10-28")).toEqual({
        line: "Play tomorrow and unlock a lazy weekend 😴",
        explainer: {
          title: "Lazy weekend",
          text: "Play any 3 days this week and your streak is paused through the weekend.",
        },
      });
      expect(comeBackGoal(run(["2026-10-27", "2026-10-30"]), "2026-10-30")?.explainer?.title).toBe("Lazy Sunday");
    });

    it("leaves beating the best streak unexplained", () => {
      const goal = comeBackGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 }), FRIDAY, []);
      expect(goal?.line).toMatch(/beat your best/);
      expect(goal?.explainer).toBeUndefined();
    });
  });
});
