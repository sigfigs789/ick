import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS,
  achievementStatuses,
  syncAchievements,
  type AchievementRecord,
} from "./achievements";
import { addDays } from "./date";
import { setPlayerMessages } from "./playerMessages";
import type { AcceptedWord, DailyProgress, Rarity, StreakState } from "./types";

function word(rarity: Rarity, w = rarity.toLowerCase().replace(" ", "")): AcceptedWord {
  return { word: w, rarity, zipf: 3 };
}

function day(date: string, words: AcceptedWord[], extra: Partial<DailyProgress> = {}): DailyProgress {
  return { date, drop: "ink", acceptedWords: words, rejectedAttempts: [], completed: true, ...extra };
}

const noStreak = { currentStreak: 0, longestStreak: 0 };
const TODAY = "2026-10-24";

function statusOf(id: string, record: Partial<AchievementRecord>, kept: Record<string, string> = {}) {
  const full: AchievementRecord = { history: [], onItsDay: [], streak: noStreak, ...record };
  return achievementStatuses(full, kept, TODAY).find((s) => s.achievement.id === id)!;
}

describe("achievements", () => {
  it("have unique ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates a first find to the puzzle it was found on", () => {
    const history = [day("2026-10-01", [word("Common")]), day("2026-10-03", [word("Mythic")])];
    expect(statusOf("first-word", { history }).earnedOn).toBe("2026-10-01");
    expect(statusOf("first-mythic", { history }).earnedOn).toBe("2026-10-03");
    expect(statusOf("first-legend", { history }).earnedOn).toBeNull();
  });

  it("shows how far along a count is, and dates the puzzle that reaches it", () => {
    const mythics = (date: string, n: number) =>
      day(date, Array.from({ length: n }, (_, i) => word("Mythic", `m${date}${i}`)));
    const partial = statusOf("mythic-10", { history: [mythics("2026-10-01", 4)] });
    expect(partial.earnedOn).toBeNull();
    expect(partial.progress).toEqual({ current: 4, target: 10 });

    const done = statusOf("mythic-10", {
      history: [mythics("2026-10-01", 4), mythics("2026-10-02", 4), mythics("2026-10-03", 4)],
    });
    expect(done.earnedOn).toBe("2026-10-03");
  });

  it("dates a streak milestone from the current streak, or today for an old one", () => {
    const current = { currentStreak: 9, longestStreak: 9, lastCompletedDate: "2026-10-20" };
    expect(statusOf("streak-7", { streak: current }).earnedOn).toBe("2026-10-18");
    const old = { currentStreak: 1, longestStreak: 12, lastCompletedDate: "2026-10-20" };
    expect(statusOf("streak-7", { streak: old }).earnedOn).toBe(TODAY);
    expect(statusOf("streak-30", { streak: old }).progress).toEqual({ current: 12, target: 30 });
  });

  it("needs every day of a month for a perfect month", () => {
    const september = Array.from({ length: 30 }, (_, i) => addDays("2026-09-01", i));
    expect(statusOf("perfect-month", { onItsDay: september }).earnedOn).toBe("2026-09-30");
    expect(statusOf("perfect-month", { onItsDay: september.slice(1) }).earnedOn).toBeNull();
  });

  it("knows a clean sweep from a win on the last guess", () => {
    const rare = word("Rare");
    const sweep = day("2026-10-10", [rare, rare, rare, rare]);
    const wire = day("2026-10-11", [word("Common"), word("Common"), word("Uncommon"), rare]);
    const short = day("2026-10-12", [rare], { completed: true });
    expect(statusOf("clean-sweep", { history: [short, sweep] }).earnedOn).toBe("2026-10-10");
    expect(statusOf("down-to-the-wire", { history: [sweep, wire] }).earnedOn).toBe("2026-10-11");
  });

  it("needs a win in both modes on one day for Both ways", () => {
    const history = [
      day("2026-10-10", [word("Rare")], { mode: "standard" }),
      day("2026-10-10", [word("Common")], { mode: "freeform" }),
      day("2026-10-11", [word("Rare")], { mode: "standard" }),
      day("2026-10-11", [word("Elusive")], { mode: "freeform" }),
    ];
    expect(statusOf("both-ways", { history }).earnedOn).toBe("2026-10-11");
  });

  it("counts every current tier for Full spectrum", () => {
    const tiers: Rarity[] = ["Common", "Uncommon", "Rare", "Extremely Rare", "Elusive", "Mythic"];
    const almost = statusOf("full-spectrum", { history: [day("2026-10-01", tiers.map((t) => word(t)))] });
    expect(almost.progress).toEqual({ current: 6, target: 7 });
    const done = statusOf("full-spectrum", {
      history: [day("2026-10-01", tiers.map((t) => word(t))), day("2026-10-02", [word("Legend")])],
    });
    expect(done.earnedOn).toBe("2026-10-02");
  });

  it("dates the suggestion badges to the first suggestion and the first acceptance", () => {
    const suggestions = [
      { word: "zibeline", suggestedOn: "2026-10-04" },
      { word: "quockerwodger", suggestedOn: "2026-10-02", acceptedOn: "2026-10-09" },
    ];
    expect(statusOf("word-suggested", { suggestions }).earnedOn).toBe("2026-10-02");
    expect(statusOf("suggestion-accepted", { suggestions }).earnedOn).toBe("2026-10-09");
    expect(statusOf("suggestion-accepted", { suggestions: suggestions.slice(0, 1) }).earnedOn).toBeNull();
    expect(statusOf("word-suggested", {}).earnedOn).toBeNull();
  });

  it("leaves the suggestion badges off a host with no suggestion box", () => {
    setPlayerMessages(false);
    try {
      const ids = achievementStatuses({ history: [], onItsDay: [], streak: noStreak }, {}, TODAY).map(
        (s) => s.achievement.id
      );
      expect(ids).not.toContain("word-suggested");
      expect(ids).not.toContain("suggestion-accepted");
      expect(ids).toContain("first-word");
    } finally {
      setPlayerMessages(true);
    }
  });

  it("keeps a badge already earned even when the record no longer shows it", () => {
    expect(statusOf("first-legend", {}, { "first-legend": "2026-10-05" }).earnedOn).toBe("2026-10-05");
  });
});

describe("syncAchievements", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  });

  it("stores what was earned, so a later rescore cannot take it away", () => {
    // Real Zipfs, since a load may re-tier a word from its Zipf.
    const progress = day("2026-10-20", [{ word: "inkhornism", rarity: "Legend", zipf: -1.57 }], {
      firstWordAt: "2026-10-20T12:00:00",
    });
    localStorage.setItem("ick:progress:2026-10-20", JSON.stringify({ ...progress, mode: "standard" }));
    const streak = { currentStreak: 0, longestStreak: 0, totalCompleted: 1, crushedIt: 1, elite: 1, highScore: 10 } as StreakState;

    const first = syncAchievements(streak);
    expect(first.find((s) => s.achievement.id === "first-legend")?.earnedOn).toBe("2026-10-20");

    // The word is rescored down after the day.
    localStorage.setItem(
      "ick:progress:2026-10-20",
      JSON.stringify({ ...progress, mode: "standard", acceptedWords: [{ word: "inkhornism", rarity: "Common", zipf: 5.5 }] })
    );
    const later = syncAchievements(streak);
    expect(later.find((s) => s.achievement.id === "first-legend")?.earnedOn).toBe("2026-10-20");
    vi.useRealTimers();
  });
});
