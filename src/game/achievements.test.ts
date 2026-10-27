import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS,
  achievementStatuses,
  achievementsToCatchUp,
  announcedAchievements,
  celebrationShareLine,
  countedRecord,
  earnedIds,
  earnedShareLabel,
  firstToEarn,
  markAchievementsAnnounced,
  newlyEarned,
  resetAchievementRates,
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

  it("needs two Mythic or better words in one puzzle for Double myth", () => {
    const split = [day("2026-10-01", [word("Mythic")]), day("2026-10-02", [word("Legend")])];
    expect(statusOf("double-mythic", { history: split }).earnedOn).toBeNull();
    const together = [...split, day("2026-10-03", [word("Mythic"), word("Common"), word("Legend")])];
    expect(statusOf("double-mythic", { history: together }).earnedOn).toBe("2026-10-03");
  });

  it("needs every guess spent and Mythic or better for Pantheon", () => {
    const short = day("2026-10-10", [word("Mythic"), word("Legend")]);
    const slip = day("2026-10-11", [word("Mythic"), word("Mythic"), word("Elusive"), word("Legend")]);
    const all = day("2026-10-12", [word("Mythic"), word("Legend"), word("Mythic"), word("Mythic")]);
    expect(statusOf("pantheon", { history: [short, slip] }).earnedOn).toBeNull();
    expect(statusOf("pantheon", { history: [short, slip, all] }).earnedOn).toBe("2026-10-12");
  });

  it("counts Legends for Legendarium and words for the bigger word counts", () => {
    const legends = statusOf("legend-10", {
      history: [day("2026-10-01", [word("Legend"), word("Legend"), word("Mythic")])],
    });
    expect(legends.progress).toEqual({ current: 2, target: 10 });
    const words = statusOf("words-500", {
      history: [day("2026-10-01", [word("Common"), word("Rare")])],
    });
    expect(words.progress).toEqual({ current: 2, target: 500 });
  });

  it("dates a Straight in to the first puzzle opened with a win", () => {
    const history = [
      day("2026-10-01", [word("Common"), word("Rare")]),
      day("2026-10-02", [word("Elusive"), word("Common")]),
    ];
    expect(statusOf("straight-in", { history }).earnedOn).toBe("2026-10-02");
  });

  it("needs a win with nothing turned away for Clean copy", () => {
    const history = [
      day("2026-10-01", [word("Rare")], { rejectedAttempts: ["inkk"] }),
      day("2026-10-02", [word("Common")]),
      day("2026-10-03", [word("Rare")], { completed: false }),
      day("2026-10-04", [word("Rare")]),
    ];
    expect(statusOf("clean-copy", { history }).earnedOn).toBe("2026-10-04");
  });

  it("needs the retry spent and a win for Second chance", () => {
    const history = [
      day("2026-10-01", [word("Common")], { retryUsed: true }),
      day("2026-10-02", [word("Rare")]),
      day("2026-10-03", [word("Rare")], { retryUsed: true }),
    ];
    expect(statusOf("second-chance", { history }).earnedOn).toBe("2026-10-03");
  });

  it("needs a word of 14 letters or more for Sesquipedalian", () => {
    const history = [
      day("2026-10-01", [word("Rare", "inkhornisms")]),
      day("2026-10-02", [word("Common", "thinkingnesses")]),
    ];
    expect(statusOf("sesquipedalian", { history }).earnedOn).toBe("2026-10-02");
  });

  it("finds an archive play only on a puzzle that says when it was played", () => {
    const history = [
      day("2026-09-01", [word("Common")]),
      day("2026-09-02", [word("Common")], { firstWordAt: "2026-09-02T09:00:00" }),
      day("2026-09-03", [word("Common")], { firstWordAt: "2026-10-20T09:00:00" }),
    ];
    expect(statusOf("archive-play", { history, onItsDay: ["2026-09-02"] }).earnedOn).toBe("2026-09-03");
    expect(
      statusOf("archive-play", { history: history.slice(0, 2), onItsDay: ["2026-09-02"] }).earnedOn
    ).toBeNull();
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

describe("newlyEarned", () => {
  const record: AchievementRecord = {
    history: [day("2026-10-01", [word("Common")]), day("2026-10-03", [word("Mythic")])],
    onItsDay: [],
    streak: noStreak,
    suggestions: [{ word: "inkle", suggestedOn: "2026-10-02" }],
  };

  beforeEach(() => setPlayerMessages(true));

  it("lists only what was earned since the snapshot, leaving out the suggestion box's", () => {
    const before = earnedIds(achievementStatuses({ ...record, history: record.history.slice(0, 1) }, {}, TODAY));
    expect(before.has("first-word")).toBe(true);
    const ids = newlyEarned(before, achievementStatuses(record, {}, TODAY)).map((a) => a.id);
    expect(ids).toContain("first-mythic");
    expect(ids).toContain("first-win");
    expect(ids).not.toContain("first-word");
    expect(ids).not.toContain("word-suggested");
  });

  it("lists nothing when nothing changed", () => {
    const statuses = achievementStatuses(record, {}, TODAY);
    expect(newlyEarned(earnedIds(statuses), statuses)).toEqual([]);
  });
});

describe("achievementsToCatchUp", () => {
  const record: AchievementRecord = {
    history: [
      day("2026-10-01", [word("Common")]),
      day("2026-10-02", [word("Rare")]),
      day("2026-10-03", [word("Mythic"), word("Legend")]),
    ],
    onItsDay: [],
    streak: { currentStreak: 3, longestStreak: 7, lastCompletedDate: "2026-10-03" },
    suggestions: [{ word: "inkle", suggestedOn: "2026-10-02" }],
  };

  beforeEach(() => {
    localStorage.clear();
    setPlayerMessages(true);
  });

  it("puts the most impressive first, and leaves out the suggestion box's", () => {
    const ids = achievementsToCatchUp(new Set(), achievementStatuses(record, {}, TODAY)).map((a) => a.id);
    expect(ids.slice(0, 3)).toEqual(["double-mythic", "first-legend", "first-mythic"]);
    expect(ids.indexOf("streak-7")).toBeLessThan(ids.indexOf("streak-3"));
    expect(ids.indexOf("streak-3")).toBeLessThan(ids.indexOf("straight-in"));
    expect(ids[ids.length - 1]).toBe("first-word");
    expect(ids).not.toContain("word-suggested");
  });

  it("leaves out what has been announced", () => {
    markAchievementsAnnounced(["first-legend", "first-word"]);
    markAchievementsAnnounced(["first-word"]);
    expect([...announcedAchievements()].sort()).toEqual(["first-legend", "first-word"]);
    const ids = achievementsToCatchUp(announcedAchievements(), achievementStatuses(record, {}, TODAY)).map(
      (a) => a.id
    );
    expect(ids).not.toContain("first-legend");
    expect(ids).not.toContain("first-word");
    expect(ids).toContain("first-mythic");
  });
});

describe("earnedShareLabel", () => {
  const rates = { players: 200, earned: { none: 0, one: 1, few: 9, some: 92 } };

  it("reads the share of players who have guessed", () => {
    expect(earnedShareLabel("few", rates)).toBe("4.5% of players");
    expect(earnedShareLabel("some", rates)).toBe("46% of players");
    expect(earnedShareLabel("one", rates)).toBe("Under 1% of players");
    expect(earnedShareLabel("none", rates)).toBe("No player yet");
  });

  it("says nothing for a badge the snapshot predates", () => {
    expect(earnedShareLabel("new-badge", rates)).toBeNull();
  });

  /**
   * Badges added since scripts/achievement-rates.mts last ran: they show no
   * share until the live counts or the next snapshot have them. Empty this once
   * the snapshot is taken again.
   */
  const AWAITING_SNAPSHOT = new Set([
    "double-extremely-rare",
    "podium",
    "triple-extremely-rare",
    "extremely-rare-average",
    "extremely-rare-25",
    "alphabet-soup",
    "extremely-rare-100",
    "quick-draw",
    "sharpshooter",
    "little-gem",
  ]);

  it("has a share for every badge in the shipped snapshot", () => {
    for (const { id } of ACHIEVEMENTS) {
      if (AWAITING_SNAPSHOT.has(id)) expect(earnedShareLabel(id)).toBeNull();
      else expect(earnedShareLabel(id)).not.toBeNull();
    }
  });
});

describe("the card for a lone badge", () => {
  beforeEach(() => resetAchievementRates());

  it("never calls a player first off the snapshot alone", () => {
    expect(firstToEarn("days-365")).toBe(false);
    expect(celebrationShareLine("days-365")).toBeNull();
  });

  it("calls the player first when the live count has nobody", () => {
    resetAchievementRates({ players: 700, earned: {} });
    expect(firstToEarn("days-365")).toBe(true);
    expect(celebrationShareLine("days-365")).toBe("You're the first player to earn it!");
  });

  it("keeps the snapshot as a floor under the live counts", () => {
    // The live count has not heard from the players before reporting began.
    resetAchievementRates({ players: 700, earned: { "first-word": 3 } });
    expect(firstToEarn("first-word")).toBe(false);
    expect(celebrationShareLine("first-word")).toMatch(/^Earned by \d+% of players\.$/);
  });

  it("says only for a rare badge, but never for days played", () => {
    const rates = { players: 1000, earned: { "first-legend": 250, pantheon: 43, "days-10": 82, "streak-30": 6 } };
    expect(celebrationShareLine("first-legend", rates)).toBe("Earned by 25% of players.");
    expect(celebrationShareLine("pantheon", rates)).toBe("Earned by only 4.3% of players.");
    expect(celebrationShareLine("streak-30", rates)).toBe("Earned by fewer than 1% of players.");
    expect(celebrationShareLine("days-10", rates)).toBe("Earned by 8.2% of players.");
  });
});

describe("the harder badges", () => {
  const legend = (w: string, zipf = 0.5): AcceptedWord => ({ word: w, rarity: "Legend", zipf });
  const days = (n: number, from = "2026-10-01") =>
    Array.from({ length: n }, (_, i) => addDays(from, i));

  it("needs a Legend on 5 days in a row, each on its own day", () => {
    const dates = days(5);
    const history = dates.map((d) => day(d, [legend(`l${d}`)]));
    expect(statusOf("legend-streak", { history, onItsDay: dates }).earnedOn).toBe("2026-10-05");
    const gap = statusOf("legend-streak", { history, onItsDay: dates.filter((d) => d !== "2026-10-03") });
    expect(gap.earnedOn).toBeNull();
    expect(gap.progress).toEqual({ current: 2, target: 5 });
  });

  it("needs 7 days in a row with nothing turned away for Ironclad", () => {
    const dates = days(7);
    const history = dates.map((d) => day(d, [word("Common")]));
    expect(statusOf("ironclad", { history, onItsDay: dates }).earnedOn).toBe("2026-10-07");
    history[3] = day(dates[3], [word("Common")], { rejectedAttempts: ["zzz"] });
    expect(statusOf("ironclad", { history, onItsDay: dates }).earnedOn).toBeNull();
  });

  it("needs every guess to score higher than the last for Climber, lower for Rappel", () => {
    const climb = [3, 2, 1, 0.5].map((zipf, i) => ({ word: `c${i}`, rarity: "Rare" as const, zipf }));
    expect(statusOf("climber", { history: [day("2026-10-10", climb)] }).earnedOn).toBe("2026-10-10");
    expect(statusOf("dawn-wall", { history: [day("2026-10-10", climb)] }).earnedOn).toBeNull();
    const summit = [...climb.slice(0, 3), { word: "c3", rarity: "Legend" as const, zipf: 0.5 }];
    expect(statusOf("dawn-wall", { history: [day("2026-10-10", summit)] }).earnedOn).toBe(
      "2026-10-10"
    );
    expect(statusOf("rappel", { history: [day("2026-10-10", [...climb].reverse())] }).earnedOn).toBe(
      "2026-10-10"
    );
    const dip = [climb[0], climb[2], climb[1], climb[3]];
    expect(statusOf("climber", { history: [day("2026-10-10", dip)] }).earnedOn).toBeNull();
  });

  it("needs a Mythic word starting with the drop and another ending with it for Bookends", () => {
    const mythic = (w: string): AcceptedWord => ({ word: w, rarity: "Mythic", zipf: 1.2 });
    const both = day("2026-10-10", [mythic("inkhorn"), mythic("bethink")]);
    expect(statusOf("bookends", { history: [both] }).earnedOn).toBe("2026-10-10");
    const one = day("2026-10-10", [mythic("inkhorn"), mythic("inkling")]);
    expect(statusOf("bookends", { history: [one] }).earnedOn).toBeNull();
  });

  it("needs a Legend on every day of the week for Grand tour", () => {
    const history = days(7).map((d) => day(d, [legend(`l${d}`)]));
    expect(statusOf("grand-tour", { history }).earnedOn).toBe("2026-10-07");
    expect(statusOf("grand-tour", { history: history.slice(1) }).progress).toEqual({
      current: 6,
      target: 7,
    });
  });

  it("averages the day's best word for Master's average", () => {
    const dates = days(10);
    const history = dates.map((d) => day(d, [{ word: `e${d}`, rarity: "Mythic", zipf: 1 }]));
    expect(statusOf("elusive-average", { history, onItsDay: dates }).earnedOn).toBe("2026-10-10");
    const weak = dates.map((d) => day(d, [word("Common")]));
    expect(statusOf("elusive-average", { history: weak, onItsDay: dates }).earnedOn).toBeNull();
  });
});

describe("the Extremely Rare badges", () => {
  const days = (n: number, from = "2026-10-01") =>
    Array.from({ length: n }, (_, i) => addDays(from, i));

  it("counts Extremely Rare or better words in one puzzle for Double take and Three of a kind", () => {
    const two = day("2026-10-10", [word("Extremely Rare"), word("Rare"), word("Elusive")]);
    const three = day("2026-10-11", [word("Extremely Rare"), word("Mythic"), word("Elusive")]);
    expect(statusOf("double-extremely-rare", { history: [two] }).earnedOn).toBe("2026-10-10");
    expect(statusOf("triple-extremely-rare", { history: [two] }).earnedOn).toBeNull();
    expect(statusOf("triple-extremely-rare", { history: [two, three] }).earnedOn).toBe("2026-10-11");
  });

  it("needs exactly a Rare, an Extremely Rare and an Elusive for Podium finish", () => {
    const higher = day("2026-10-10", [word("Rare"), word("Extremely Rare"), word("Mythic")]);
    const medals = day("2026-10-11", [word("Elusive"), word("Common"), word("Rare"), word("Extremely Rare")]);
    expect(statusOf("podium", { history: [higher] }).earnedOn).toBeNull();
    expect(statusOf("podium", { history: [higher, medals] }).earnedOn).toBe("2026-10-11");
  });

  it("needs the first word Extremely Rare or better for Quick draw", () => {
    const history = [
      day("2026-10-01", [word("Rare"), word("Legend")]),
      day("2026-10-02", [word("Extremely Rare")]),
    ];
    expect(statusOf("quick-draw", { history }).earnedOn).toBe("2026-10-02");
  });

  it("needs every guess Extremely Rare or better for Sharpshooter", () => {
    const slip = day("2026-10-10", [word("Elusive"), word("Rare"), word("Mythic"), word("Extremely Rare")]);
    const all = day("2026-10-11", [word("Extremely Rare"), word("Elusive"), word("Extremely Rare"), word("Legend")]);
    expect(statusOf("sharpshooter", { history: [slip] }).earnedOn).toBeNull();
    expect(statusOf("sharpshooter", { history: [slip, all] }).earnedOn).toBe("2026-10-11");
  });

  it("needs a short Extremely Rare word for Little gem", () => {
    const history = [
      day("2026-10-01", [word("Elusive", "inkles"), word("Rare", "inkle")]),
      day("2026-10-02", [word("Extremely Rare", "inkle")]),
    ];
    expect(statusOf("little-gem", { history }).earnedOn).toBe("2026-10-02");
  });

  it("counts Extremely Rare or better words for Magpie and Cabinet of curiosities", () => {
    const history = [day("2026-10-01", [word("Extremely Rare"), word("Legend"), word("Rare")])];
    expect(statusOf("extremely-rare-25", { history }).progress).toEqual({ current: 2, target: 25 });
    expect(statusOf("extremely-rare-100", { history }).progress).toEqual({ current: 2, target: 100 });
  });

  it("counts the first letters of Extremely Rare or better words for Alphabet soup", () => {
    const letters = "abcdefghijklm".split("");
    const history = letters.map((l, i) =>
      day(addDays("2026-10-01", i), [word("Extremely Rare", `${l}ink`), word("Rare", `zink${i}`)])
    );
    expect(statusOf("alphabet-soup", { history }).earnedOn).toBe("2026-10-13");
    const repeat = [...history.slice(0, 12), day("2026-10-13", [word("Mythic", "aink")])];
    expect(statusOf("alphabet-soup", { history: repeat }).progress).toEqual({ current: 12, target: 13 });
  });

  it("averages the day's best word for Bachelor's average", () => {
    const dates = days(7);
    const history = dates.map((d) => day(d, [{ word: `e${d}`, rarity: "Elusive", zipf: 1.5 }]));
    expect(statusOf("extremely-rare-average", { history, onItsDay: dates }).earnedOn).toBe("2026-10-07");
    const weak = dates.map((d) => day(d, [word("Common")]));
    expect(statusOf("extremely-rare-average", { history: weak, onItsDay: dates }).earnedOn).toBeNull();
  });
});

describe("countedRecord", () => {
  it("earns a badge from an unattested Legend but leaves it out of the count", () => {
    const unattested: AcceptedWord = { word: "zzyzx", rarity: "Legend", zipf: -1.57 };
    const history = [day("2026-10-10", [unattested])];
    expect(statusOf("first-legend", { history }).earnedOn).toBe("2026-10-10");
    const counted = countedRecord({ history, onItsDay: [], streak: noStreak });
    expect(statusOf("first-legend", counted).earnedOn).toBeNull();
    expect(statusOf("first-word", counted).earnedOn).toBe("2026-10-10");
  });

  it("still counts a measured Legend", () => {
    const history = [day("2026-10-10", [{ word: "rare", rarity: "Legend", zipf: 0.5 }])];
    const counted = countedRecord({ history, onItsDay: [], streak: noStreak });
    expect(statusOf("first-legend", counted).earnedOn).toBe("2026-10-10");
  });
});
