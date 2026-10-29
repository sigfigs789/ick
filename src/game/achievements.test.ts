import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS,
  achievementsReported,
  achievementStatuses,
  achievementsToCatchUp,
  announcedAchievements,
  celebrationShareLine,
  countedRecord,
  earnedIds,
  earnedShareLabel,
  fellowHolder,
  fetchAchievementRates,
  firstToEarn,
  holdersOf,
  markAchievementsAnnounced,
  newlyEarned,
  resetAchievementRates,
  soleHolder,
  subscribeToAchievementRates,
  syncAchievements,
  type AchievementRates,
  type AchievementRecord,
} from "./achievements";
import { addDays } from "./date";
import { handleFor } from "./handle";
import { PLAYER_KEY } from "./player";
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
      expect(ids).toContain("first-legend");
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

  it("compares the retry's replacement with the word it gave up", () => {
    const at = (zipf: number): AcceptedWord => ({ word: `z${zipf}`, rarity: "Common", zipf });
    const retried = (gaveUp: number, words: AcceptedWord[]) =>
      ({ retryUsed: true, retried: { word: at(gaveUp), replacedAt: 1 }, acceptedWords: words });
    const history = [
      // A retry from before the word was kept, and one not yet replaced.
      day("2026-10-01", [at(1)], { retryUsed: true }),
      day("2026-10-02", [], retried(4, [at(5)])),
      // The same score both ways earns neither.
      day("2026-10-03", [], retried(4, [at(5), at(4)])),
      day("2026-10-04", [], retried(4, [at(5), at(2)])),
      day("2026-10-05", [], retried(2, [at(5), at(4)])),
    ];
    expect(statusOf("second-chance", { history }).earnedOn).toBe("2026-10-04");
    expect(statusOf("buyers-remorse", { history }).earnedOn).toBe("2026-10-05");
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

  it("stores a new badge even when a retired one keeps the count level", () => {
    const progress = day("2026-10-20", [{ word: "inkhornism", rarity: "Legend", zipf: -1.57 }], {
      firstWordAt: "2026-10-20T12:00:00",
    });
    localStorage.setItem("ick:progress:2026-10-20", JSON.stringify({ ...progress, mode: "standard" }));
    const streak = { currentStreak: 0, longestStreak: 0, totalCompleted: 1, crushedIt: 1, elite: 1, highScore: 10 } as StreakState;
    const earned = syncAchievements(streak).filter((s) => s.earnedOn);
    // As many retired badges kept as there are new ones, so a count would match.
    const retired = Object.fromEntries(earned.map((_, i) => [`retired-${i}`, "2026-10-01"]));
    localStorage.setItem("ick:achievements", JSON.stringify(retired));

    syncAchievements(streak);
    const stored = JSON.parse(localStorage.getItem("ick:achievements")!);
    expect(stored["first-legend"]).toBe("2026-10-20");
    vi.useRealTimers();
  });
});

describe("newlyEarned", () => {
  const record: AchievementRecord = {
    history: [day("2026-10-01", [word("Common", "stir")]), day("2026-10-03", [word("Mythic")])],
    onItsDay: [],
    streak: noStreak,
    suggestions: [{ word: "inkle", suggestedOn: "2026-10-02" }],
  };

  beforeEach(() => setPlayerMessages(true));

  it("lists only what was earned since the snapshot, leaving out the suggestion box's", () => {
    const before = earnedIds(achievementStatuses({ ...record, history: record.history.slice(0, 1) }, {}, TODAY));
    expect(before.has("short-king")).toBe(true);
    const ids = newlyEarned(before, achievementStatuses(record, {}, TODAY)).map((a) => a.id);
    expect(ids).toContain("first-mythic");
    expect(ids).toContain("small-but-mighty");
    expect(ids).not.toContain("short-king");
    expect(ids).not.toContain("word-suggested");
  });

  it("keeps the quiet ones off the card, though they are earned", () => {
    const statuses = achievementStatuses(record, {}, TODAY);
    const quiet = ["first-word", "first-win", "straight-in", "triple-letter"];
    for (const id of quiet) expect(ACHIEVEMENTS.find((a) => a.id === id)?.quiet).toBe(true);
    expect(earnedIds(statuses).has("first-word")).toBe(true);
    const announced = newlyEarned(new Set(), statuses).map((a) => a.id);
    expect(announced.filter((id) => quiet.includes(id))).toEqual([]);
    expect(achievementsToCatchUp(new Set(), statuses).map((a) => a.id)).not.toContain("first-word");
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
    expect(ids.indexOf("streak-3")).toBeLessThan(ids.indexOf("small-but-mighty"));
    expect(ids).not.toContain("word-suggested");
  });

  it("leaves out what has been announced", () => {
    markAchievementsAnnounced(["first-legend", "streak-3"]);
    markAchievementsAnnounced(["streak-3"]);
    expect([...announcedAchievements()].sort()).toEqual(["first-legend", "streak-3"]);
    const ids = achievementsToCatchUp(announcedAchievements(), achievementStatuses(record, {}, TODAY)).map(
      (a) => a.id
    );
    expect(ids).not.toContain("first-legend");
    expect(ids).not.toContain("streak-3");
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

  it("names the one player holding a badge", () => {
    const sole = { ...rates, sole: { one: "StormyFox47" } };
    expect(earnedShareLabel("one", sole)).toBe("Only earned by StormyFox47!");
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: "me" }));
    expect(earnedShareLabel("one", { ...rates, sole: { one: handleFor("me") } })).toBe("Only earned by you!");
    localStorage.removeItem(PLAYER_KEY);
  });

  it("names nobody once a second player holds it", () => {
    const stale = { ...rates, earned: { ...rates.earned, one: 2 }, sole: { one: "StormyFox47" } };
    expect(earnedShareLabel("one", stale)).toBe("1% of players");
  });

  it("counts this player in a badge they hold", () => {
    // The counts have nobody yet: the player is the one.
    expect(earnedShareLabel("none", rates, true)).toBe("Under 1% of players");
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: "me" }));
    expect(earnedShareLabel("none", rates, true)).toBe("Only earned by you!");
    expect(soleHolder("none", rates, true)).toEqual({ name: handleFor("me"), self: true });
    // The one the counts name is someone else, so this player is a second.
    expect(earnedShareLabel("one", { ...rates, sole: { one: "StormyFox47" } }, true)).toBe(
      "Only earned by StormyFox47 and you!"
    );
    expect(fellowHolder("one", { ...rates, sole: { one: "StormyFox47" } }, true)).toBe("StormyFox47");
    expect(fellowHolder("one", { ...rates, sole: { one: "StormyFox47" } })).toBeNull();
    expect(earnedShareLabel("one", { ...rates, sole: { one: handleFor("me") } }, true)).toBe("Only earned by you!");
    localStorage.removeItem(PLAYER_KEY);
    expect(earnedShareLabel("some", rates, true)).toBe("46% of players");
  });

  it("says nothing for a badge the snapshot predates", () => {
    expect(earnedShareLabel("new-badge", rates)).toBeNull();
  });

  it("has a share for every badge in the shipped snapshot", () => {
    for (const { id } of ACHIEVEMENTS) expect(earnedShareLabel(id)).not.toBeNull();
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
    resetAchievementRates({ players: 700, earned: { sesquipedalian: 3 } });
    expect(firstToEarn("sesquipedalian")).toBe(false);
    expect(celebrationShareLine("sesquipedalian")).toMatch(/^Earned by \d+% of players\.$/);
  });

  it("says only for a rare badge, but never for days played", () => {
    const rates = { players: 1000, earned: { "first-legend": 250, pantheon: 43, "days-10": 82, "streak-30": 6 } };
    expect(celebrationShareLine("first-legend", rates)).toBe("Earned by 25% of players.");
    expect(celebrationShareLine("pantheon", rates)).toBe("Earned by only 4.3% of players.");
    expect(celebrationShareLine("streak-30", rates)).toBe("Earned by fewer than 1% of players.");
    expect(celebrationShareLine("days-10", rates)).toBe("Earned by 8.2% of players.");
  });
});

describe("refreshing the live counts", () => {
  let answers: AchievementRates[];
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetAchievementRates();
    answers = [];
    fetchMock = vi.fn(async () => Response.json(answers.shift()));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks again, past the edge cache, once a new badge is reported", async () => {
    answers.push({ players: 700, earned: {} }, { players: 701, earned: { "days-365": 1 } });
    await fetchAchievementRates();
    const redraws = vi.fn();
    const stop = subscribeToAchievementRates(redraws);
    achievementsReported(["days-365"]);
    // The first counts stay up until the new ones land.
    expect(holdersOf("days-365")).toBe(0);
    await vi.waitFor(() => expect(redraws).toHaveBeenCalledOnce());
    stop();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^\/api\/achievements\?after=\d+$/);
    expect(holdersOf("days-365")).toBe(1);
    // The one holder is this player, so they were still the first.
    expect(firstToEarn("days-365")).toBe(true);
  });

  it("keeps naming the one other holder once the counts include this player", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: "me" }));
    answers.push(
      { players: 700, earned: { "days-365": 1 }, sole: { "days-365": "StormyFox47" } },
      { players: 701, earned: { "days-365": 2 }, sole: {} }
    );
    await fetchAchievementRates();
    expect(earnedShareLabel("days-365", undefined, true)).toBe("Only earned by StormyFox47 and you!");
    // Two holders, but nothing says this player is one of them.
    expect(earnedShareLabel("days-365", { players: 701, earned: { "days-365": 2 } }, true)).toBe(
      "Under 1% of players"
    );
    achievementsReported(["days-365"]);
    await vi.waitFor(() => expect(holdersOf("days-365")).toBe(2));
    expect(earnedShareLabel("days-365", undefined, true)).toBe("Only earned by StormyFox47 and you!");
    // A third makes it a share again.
    resetAchievementRates({ players: 702, earned: { "days-365": 3 } });
    expect(earnedShareLabel("days-365", undefined, true)).toBe("Under 1% of players");
    localStorage.removeItem(PLAYER_KEY);
  });

  it("does not ask again for a badge already reported", async () => {
    answers.push({ players: 700, earned: {} }, { players: 701, earned: { "days-365": 1 } });
    await fetchAchievementRates();
    achievementsReported(["days-365"]);
    achievementsReported(["days-365"]);
    await vi.waitFor(() => expect(holdersOf("days-365")).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks nothing before anything has asked for the counts", () => {
    achievementsReported(["days-365"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the counts shown when the new ask fails", async () => {
    answers.push({ players: 700, earned: { "days-365": 4 } });
    await fetchAchievementRates();
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    achievementsReported(["days-365"]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(holdersOf("days-365")).toBe(4);
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

describe("the easier rungs", () => {
  it("needs two Legends less than a week apart for Twice in a week", () => {
    const legendOn = (d: string) => day(d, [word("Legend")]);
    const near = [legendOn("2026-10-01"), legendOn("2026-10-07")];
    expect(statusOf("legend-week", { history: near }).earnedOn).toBe("2026-10-07");
    const far = [legendOn("2026-10-01"), legendOn("2026-10-08")];
    expect(statusOf("legend-week", { history: far }).earnedOn).toBeNull();
  });

  it("needs three words of one Extremely Rare or better tier for Three of a kind", () => {
    const three = day("2026-10-10", [word("Extremely Rare"), word("Extremely Rare"), word("Extremely Rare"), word("Rare")]);
    expect(statusOf("three-of-a-kind", { history: [three] }).earnedOn).toBe("2026-10-10");
    const rare = day("2026-10-10", [word("Rare"), word("Rare"), word("Rare"), word("Legend")]);
    expect(statusOf("three-of-a-kind", { history: [rare] }).earnedOn).toBeNull();
    const mixed = day("2026-10-10", [word("Elusive"), word("Elusive"), word("Mythic"), word("Mythic")]);
    expect(statusOf("three-of-a-kind", { history: [mixed] }).earnedOn).toBeNull();
  });

  it("needs four words of one Mythic or better tier for Four of a kind", () => {
    const four = day("2026-10-10", [word("Mythic"), word("Mythic"), word("Mythic"), word("Mythic"), word("Rare")]);
    expect(statusOf("four-of-a-kind", { history: [four] }).earnedOn).toBe("2026-10-10");
    const elusive = day("2026-10-10", [word("Elusive"), word("Elusive"), word("Elusive"), word("Elusive")]);
    expect(statusOf("four-of-a-kind", { history: [elusive] }).earnedOn).toBeNull();
    const mixed = day("2026-10-10", [word("Legend"), word("Legend"), word("Mythic"), word("Mythic")]);
    expect(statusOf("four-of-a-kind", { history: [mixed] }).earnedOn).toBeNull();
  });

  it("needs a Mythic word starting with the drop for Head start", () => {
    const start = day("2026-10-10", [{ word: "inkhorn", rarity: "Mythic", zipf: 1.2 }]);
    expect(statusOf("head-start", { history: [start] }).earnedOn).toBe("2026-10-10");
    const end = day("2026-10-10", [{ word: "bethink", rarity: "Mythic", zipf: 1.2 }]);
    expect(statusOf("head-start", { history: [end] }).earnedOn).toBeNull();
  });
});

describe("Royal flush", () => {
  it("needs one word from each of the four top tiers in one puzzle", () => {
    const top = ["Legend", "Mythic", "Elusive", "Extremely Rare"] as const;
    const flush = day("2026-10-10", top.map((r) => word(r)));
    expect(statusOf("top-four", { history: [flush] }).earnedOn).toBe("2026-10-10");
    const short = day("2026-10-10", [word("Legend"), word("Legend"), word("Mythic"), word("Elusive")]);
    expect(statusOf("top-four", { history: [short] }).earnedOn).toBeNull();
  });
});

describe("Word of the day", () => {
  it("is earned once the tally has a day for the player, unattested words and all", () => {
    expect(statusOf("word-of-the-day", { bestWordWins: 1 }).earnedOn).toBe(TODAY);
    expect(statusOf("word-of-the-day", {}).earnedOn).toBeNull();
    const counted = countedRecord({ history: [], onItsDay: [], streak: noStreak, bestWordWins: 2 });
    expect(statusOf("word-of-the-day", counted).earnedOn).toBe(TODAY);
  });
});

describe("countedRecord", () => {
  it("earns a badge from an unattested Legend but leaves it out of the count", () => {
    const unattested: AcceptedWord = { word: "zzyzx", rarity: "Legend", zipf: -1.57 };
    const history = [day("2026-10-10", [unattested])];
    expect(statusOf("first-legend", { history }).earnedOn).toBe("2026-10-10");
    const counted = countedRecord({ history, onItsDay: [], streak: noStreak });
    expect(statusOf("first-legend", counted).earnedOn).toBeNull();
    expect(statusOf("x-word", counted).earnedOn).toBe("2026-10-10");
  });

  it("still counts a measured Legend", () => {
    const history = [day("2026-10-10", [{ word: "rare", rarity: "Legend", zipf: 0.5 }])];
    const counted = countedRecord({ history, onItsDay: [], streak: noStreak });
    expect(statusOf("first-legend", counted).earnedOn).toBe("2026-10-10");
  });
});

describe("the fun badges", () => {
  const words = (...ws: string[]) => ws.map((w) => word("Common", w));

  it("counts first letters for Alphabet soup, and every letter for The quick brown fox", () => {
    const history = [day("2026-10-01", words("ant", "bat", "cat", "dog")), day("2026-10-02", words("eel", "fox", "gnu", "hen")), day("2026-10-03", words("ibis", "jay"))];
    expect(statusOf("alphabet-10", { history }).earnedOn).toBe("2026-10-03");
    expect(statusOf("alphabet-13", { history }).progress).toEqual({ current: 10, target: 13 });
    const pangram = [day("2026-10-01", words("the", "quick", "brown", "fox")), day("2026-10-02", words("jumps", "over", "lazy", "dog"))];
    expect(statusOf("pangram", { history: pangram }).earnedOn).toBe("2026-10-02");
  });

  it("reads one word for the word badges", () => {
    const one = (id: string, w: string) => statusOf(id, { history: [day("2026-10-01", words(w))] }).earnedOn;
    expect(one("old-macdonald", "television")).toBe("2026-10-01");
    expect(one("old-macdonald", "oneliner")).toBeNull();
    expect(one("x-word", "jazz")).toBeNull();
    expect(one("x-word", "boxer")).toBe("2026-10-01");
    expect(one("tenet", "racecar")).toBe("2026-10-01");
    expect(one("rhythm-nation", "rhythm")).toBe("2026-10-01");
    expect(one("q-without-u", "qatar")).toBe("2026-10-01");
    expect(one("q-without-u", "quick")).toBeNull();
    expect(one("triple-letter", "banana")).toBe("2026-10-01");
    expect(one("double-dip", "inking")).toBeNull();
    expect(one("double-dip", "inkinky")).toBe("2026-10-01");
  });

  it("needs a finished puzzle for the order badges", () => {
    const check = (id: string, ...ws: string[]) => statusOf(id, { history: [day("2026-10-01", words(...ws))] }).earnedOn;
    expect(check("abcs", "ant", "bat", "cat", "dog")).toBe("2026-10-01");
    expect(check("abcs", "ant", "cat", "bat", "dog")).toBeNull();
    expect(check("abcs", "ant", "bat", "cat")).toBeNull();
    expect(check("chain-gang", "ink", "kin", "nap", "pin")).toBe("2026-10-01");
    expect(check("honey-i-blew-up-the-kid", "ink", "kink", "pinks", "inkpot")).toBe("2026-10-01");
    expect(check("peter-piper", "pink", "pick", "peck", "pack")).toBe("2026-10-01");
    expect(check("voldemort", "listen", "silent")).toBe("2026-10-01");
    expect(check("basic", "ant", "bat", "cat", "dog")).toBe("2026-10-01");
  });

  it("needs the same word on two days for Groundhog Day", () => {
    const sameDay = [day("2026-10-01", words("pink"), { mode: "standard" }), day("2026-10-01", words("pink"), { mode: "freeform" })];
    expect(statusOf("groundhog-day", { history: sameDay }).earnedOn).toBeNull();
    const twoDays = [day("2026-10-01", words("pink")), day("2026-10-05", words("Pink"))];
    expect(statusOf("groundhog-day", { history: twoDays }).earnedOn).toBe("2026-10-05");
  });

  it("counts days played on their own day for the weekend and the week", () => {
    // 2026-10-03 is a Saturday.
    expect(statusOf("weekend-at-bernies", { onItsDay: ["2026-10-03", "2026-10-04"] }).earnedOn).toBe("2026-10-04");
    expect(statusOf("weekend-at-bernies", { onItsDay: ["2026-10-04", "2026-10-10"] }).earnedOn).toBeNull();
    const week = Array.from({ length: 7 }, (_, i) => addDays("2026-10-01", i));
    expect(statusOf("eight-days-a-week", { onItsDay: week }).earnedOn).toBe("2026-10-07");
    expect(statusOf("eight-days-a-week", { onItsDay: week.slice(1) }).progress).toEqual({ current: 6, target: 7 });
  });
});
