import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxGuessesFor } from "./constants";
import {
  loadOrCreateProgress,
  loadProgress,
  loadStreak,
  newProgress,
  playedOnItsDay,
  recordAcceptedWord,
  recordRejectedAttempt,
  resetProgress,
  retryWord,
} from "./storage";
import { rarityScore } from "./dictionary";

// Every fixture date here predates the five-guess cutover, so these tests run
// against the six-guess limit those puzzles played with.
const MAX_GUESSES = maxGuessesFor("2024-01-01");
import type { AcceptedWord, DailyProgress, Rarity } from "./types";

function word(w: string, zipf = 5, rarity: Rarity = "Common"): AcceptedWord {
  return { word: w, rarity, zipf };
}

function setToday(dateStr: string) {
  vi.setSystemTime(new Date(`${dateStr}T12:00:00`));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // Most tests use "2024-01-01" as their fixture date; pin the clock there
  // by default so streak assertions (which now require the completed
  // puzzle's date to match "today") hold without every test setting it.
  setToday("2024-01-01");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("newProgress / loadOrCreateProgress", () => {
  it("creates fresh, incomplete progress", () => {
    const p = newProgress("2024-01-01", "str");
    expect(p).toMatchObject({
      date: "2024-01-01",
      drop: "str",
      acceptedWords: [],
      rejectedAttempts: [],
      completed: false,
    });
  });

  it("loads existing progress for the same drop instead of recreating it", () => {
    recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    const loaded = loadOrCreateProgress("2024-01-01", "str");
    expect(loaded.acceptedWords).toEqual([word("strange")]);
  });

  it("discards stale progress if the day's drop has since changed", () => {
    recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    const loaded = loadOrCreateProgress("2024-01-01", "ou");
    expect(loaded.acceptedWords).toEqual([]);
    expect(loaded.drop).toBe("ou");
  });

  it("migrates the former Elusive rank to Legend in saved progress", () => {
    localStorage.setItem(
      "ick:progress:2024-01-01",
      JSON.stringify({
        ...newProgress("2024-01-01", "str"),
        acceptedWords: [{ word: "abash", rarity: "Elusive", zipf: 1 }],
      })
    );

    expect(loadProgress("2024-01-01")?.acceptedWords[0].rarity).toBe("Legend");
  });

  it("leaves Elusive alone on a puzzle that uses it as a live tier", () => {
    // Elusive is the rank between Extremely Rare and Mythic from the retuned
    // tiers on, so promoting it there would hand out a Legend nobody earned.
    localStorage.setItem(
      "ick:progress:2026-08-21",
      JSON.stringify({
        ...newProgress("2026-08-21", "res"),
        acceptedWords: [{ word: "reseat", rarity: "Elusive", zipf: 1.5 }],
      })
    );

    expect(loadProgress("2026-08-21")?.acceptedWords[0].rarity).toBe("Elusive");
  });

  it("promotes a deep-tail Mythic save to Legend on a Legend-era puzzle", () => {
    // 2026-08-16+ renamed the deep-tail top rank Mythic -> Legend.
    localStorage.setItem(
      "ick:progress:2026-08-16",
      JSON.stringify({
        ...newProgress("2026-08-16", "aut"),
        acceptedWords: [{ word: "autecism", rarity: "Mythic", zipf: 0.6 }],
      })
    );

    expect(loadProgress("2026-08-16")?.acceptedWords[0].rarity).toBe("Legend");
  });

  it("keeps a deep-tail Mythic save as Mythic on the 2026-08-15 puzzle", () => {
    // 2026-08-15 legitimately labels its deep tail Mythic, so it must not be
    // promoted to a tier that day's system never had.
    localStorage.setItem(
      "ick:progress:2026-08-15",
      JSON.stringify({
        ...newProgress("2026-08-15", "aut"),
        acceptedWords: [{ word: "autecism", rarity: "Mythic", zipf: 0.6 }],
      })
    );

    expect(loadProgress("2026-08-15")?.acceptedWords[0].rarity).toBe("Mythic");
  });

  it.each([0.1, 0.3, 0.5])("refreshes words saved with the former %s unknown-frequency fallback", (zipf) => {
    localStorage.setItem(
      "ick:progress:2024-01-01",
      JSON.stringify({
        ...newProgress("2024-01-01", "rt"),
        acceptedWords: [{ word: "dustcart", rarity: "Mythic", zipf }],
      })
    );

    expect(loadProgress("2024-01-01")?.acceptedWords[0]).toEqual({
      word: "dustcart",
      rarity: "Extremely Rare",
      zipf: 1.4, // pre-cutover puzzle -> legacy scoring, where unknowns floor to 1.4
    });
  });

  it("clears saved progress for a development reset", () => {
    recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));

    expect(resetProgress("2024-01-01", "str")).toMatchObject({
      acceptedWords: [],
      rejectedAttempts: [],
      completed: false,
    });
    expect(loadProgress("2024-01-01")).toBeNull();
  });
});

describe("loadStreak", () => {
  it("adds zeroed rarity counters to existing streak data", () => {
    localStorage.setItem(
      "ick:streak",
      JSON.stringify({ currentStreak: 2, longestStreak: 3, totalCompleted: 3 })
    );
    expect(loadStreak()).toMatchObject({ crushedIt: 0, elite: 0, highScore: 0 });
  });

  it("resets an expired streak to zero after a missed day", () => {
    setToday("2024-01-03");
    localStorage.setItem(
      "ick:streak",
      JSON.stringify({ currentStreak: 2, longestStreak: 2, lastCompletedDate: "2024-01-01" })
    );

    expect(loadStreak()).toMatchObject({ currentStreak: 0, longestStreak: 2 });
  });
});

describe("recordAcceptedWord", () => {
  it("appends the word and persists it", () => {
    const p1 = newProgress("2024-01-01", "str");
    const p2 = recordAcceptedWord(p1, word("strange"));
    expect(p2.acceptedWords).toEqual([word("strange")]);
    expect(loadProgress("2024-01-01")?.acceptedWords).toEqual([word("strange")]);
  });

  it("does not auto-complete before MAX_GUESSES words", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange"));
    expect(p.completed).toBe(false);
  });

  it("ends as a loss on the MAX_GUESSES-th valid word while keeping the streak", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    expect(p.completed).toBe(true);
    expect(p.won).toBe(false);
    expect(p.acceptedWords).toHaveLength(MAX_GUESSES);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().totalCompleted).toBe(0);
  });

  it("completes after five words on a puzzle from the five-guess era", () => {
    setToday("2026-08-20");
    let p = newProgress("2026-08-20", "str");
    for (let i = 0; i < 4; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    expect(p.completed).toBe(false);
    p = recordAcceptedWord(p, word("word4"));
    expect(p.completed).toBe(true);
    expect(p.acceptedWords).toHaveLength(5);
  });

  it("keeps the puzzle active and updates the streak immediately after any valid word", () => {
    const p = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("the", 7.7, "Very Common")
    );
    expect(p.completed).toBe(false);
    expect(p.won).toBeUndefined();
    expect(p.acceptedWords).toHaveLength(1);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().totalCompleted).toBe(0);
    expect(loadStreak().crushedIt).toBe(0);
  });

  it("scores an archived Extremely Rare word immediately without changing the streak", () => {
    const p = recordAcceptedWord(
      newProgress("2023-06-01", "str"),
      word("stranger", 2.4, "Extremely Rare")
    );
    expect(p.completed).toBe(false);
    expect(loadStreak()).toMatchObject({
      currentStreak: 0,
      totalCompleted: 0,
      crushedIt: 1,
      elite: 1,
      highScore: rarityScore(2.4, "2023-06-01"),
    });
  });

  it("keeps the highest rarity score across accepted words", () => {
    let p = recordAcceptedWord(newProgress("2023-06-01", "str"), word("common", 5.4));
    p = recordAcceptedWord(p, word("rare", 2.4, "Extremely Rare"));
    recordAcceptedWord(p, word("later", 4.6));
    expect(loadStreak().highScore).toBe(rarityScore(2.4, "2023-06-01"));
  });

  it("wins on the sixth accepted word when a qualifying word was found", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`, i === 2 ? 3.2 : 5, i === 2 ? "Rare" : "Common"));
    }
    expect(p).toMatchObject({ completed: true, won: true });
    expect(loadStreak()).toMatchObject({ currentStreak: 1, crushedIt: 1, elite: 0 });
  });

  it("tracks an Extremely Rare win as Elite", () => {
    let p = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("stranger", 2.4, "Extremely Rare")
    );
    // Elite is banked on the word itself; spending the rest of the guesses is
    // only what makes the puzzle report `won`.
    expect(loadStreak()).toMatchObject({ crushedIt: 1, elite: 1 });
    for (let i = 1; i < MAX_GUESSES; i++) p = recordAcceptedWord(p, word(`filler${i}`));
    expect(p.won).toBe(true);
    expect(loadStreak()).toMatchObject({ crushedIt: 1, elite: 1 });
  });

  it("counts each qualifying rarity once per puzzle", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("rare", 3.2, "Rare"));
    p = recordAcceptedWord(p, word("rarer", 3.1, "Rare"));
    p = recordAcceptedWord(p, word("elite", 2.4, "Extremely Rare"));
    recordAcceptedWord(p, word("eliter", 2.3, "Extremely Rare"));

    expect(loadStreak()).toMatchObject({ crushedIt: 1, elite: 1 });
  });

  it("is a no-op once the puzzle is already completed", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    const extra = recordAcceptedWord(p, word("onemore"));
    expect(extra).toBe(p);
    expect(extra.acceptedWords).toHaveLength(MAX_GUESSES);
  });

  it("completes and saves an archived (non-today) puzzle without touching the streak", () => {
    // "Today" is pinned to 2024-01-01 by the top-level beforeEach; this
    // puzzle's own date is in the past relative to that.
    let p = newProgress("2023-12-15", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    expect(p.completed).toBe(true);
    expect(p.won).toBe(false);
    expect(loadProgress("2023-12-15")?.completed).toBe(true);
    expect(loadStreak().currentStreak).toBe(0);
    expect(loadStreak().totalCompleted).toBe(0);
  });
});

describe("recordRejectedAttempt", () => {
  it("logs the raw attempt without touching accepted words", () => {
    const p1 = newProgress("2024-01-01", "str");
    const p2 = recordRejectedAttempt(p1, "xyz");
    expect(p2.rejectedAttempts).toEqual(["xyz"]);
    expect(p2.acceptedWords).toEqual([]);
  });
});

/**
 * Finishing a puzzle, which now happens exactly one way: the last guess.
 *
 * These used to exercise `lockInResult`, the player-initiated early finish
 * behind the "I'm done guessing" button. The button is gone and so is the
 * function -- what it did to the record (completed, won, completedAt,
 * totalCompleted) is now only ever done by spending the guess limit, so the
 * same properties are asserted against that path.
 */
describe("completing a puzzle at the guess limit", () => {
  /** Spend every guess on `date`'s puzzle, with the first word setting the win. */
  function playOut(date: string, first: AcceptedWord): DailyProgress {
    let p = recordAcceptedWord(newProgress(date, "str"), first);
    for (let i = 1; i < maxGuessesFor(date); i++) {
      p = recordAcceptedWord(p, word(`filler${i}`));
    }
    return p;
  }

  it("does not complete a puzzle with guesses still in hand", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange", 3.2, "Rare"));
    expect(p.completed).toBe(false);
    expect(loadStreak().totalCompleted).toBe(0);
  });

  it("records a qualifying result without updating the streak again", () => {
    const streakAfterFirstWord = (() => {
      recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange", 3.2, "Rare"));
      return loadStreak().currentStreak;
    })();
    localStorage.clear();

    const done = playOut("2024-01-01", word("strange", 3.2, "Rare"));
    expect(done.completed).toBe(true);
    expect(done.won).toBe(true);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().currentStreak).toBe(streakAfterFirstWord);
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("counts an archived Rare win without advancing the streak", () => {
    const done = playOut("2023-06-01", word("strange", 3.2, "Rare"));
    expect(done.completed).toBe(true);
    expect(loadStreak()).toMatchObject({
      currentStreak: 0,
      totalCompleted: 1,
      crushedIt: 1,
      elite: 0,
    });
  });

  it("counts an archived Extremely Rare win as Elite without advancing the streak", () => {
    playOut("2023-06-01", word("stranger", 2.4, "Extremely Rare"));
    expect(loadStreak()).toMatchObject({
      currentStreak: 0,
      totalCompleted: 1,
      crushedIt: 1,
      elite: 1,
    });
  });
});

describe("streak continuation", () => {
  /** Play `date`'s puzzle out to its guess limit, winning it on the first word. */
  function complete(date: string) {
    setToday(date);
    return playOut(date);
  }

  /** The same, without moving "today" -- for finishing an old puzzle in place. */
  function playOut(date: string) {
    let p = recordAcceptedWord(newProgress(date, "str"), word(`w-${date}`, 3.2, "Rare"));
    for (let i = 1; i < maxGuessesFor(date); i++) {
      p = recordAcceptedWord(p, word(`w-${date}-${i}`));
    }
    return p;
  }

  it("increments the streak on consecutive days", () => {
    complete("2024-01-01");
    complete("2024-01-02");
    expect(loadStreak().currentStreak).toBe(2);
    complete("2024-01-03");
    expect(loadStreak().currentStreak).toBe(3);
  });

  it("resets the streak after a missed day", () => {
    complete("2024-01-01");
    complete("2024-01-03"); // skipped 01-02
    expect(loadStreak().currentStreak).toBe(1);
  });

  it("tracks the longest streak even after a reset", () => {
    complete("2024-01-01");
    complete("2024-01-02");
    complete("2024-01-03");
    complete("2024-01-10"); // breaks the streak
    const streak = loadStreak();
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(3);
  });

  it("only counts a given day's completion once", () => {
    const done = complete("2024-01-01");
    // A word arriving after the limit -- a live lookup landing late -- must not
    // re-complete the puzzle and count it a second time.
    recordAcceptedWord(done, word("onemore", 3.2, "Rare"));
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("does not let completing an old puzzle out of order corrupt an existing streak", () => {
    complete("2024-01-01");
    complete("2024-01-02");
    expect(loadStreak().currentStreak).toBe(2);

    // Go back and (belatedly) finish a much older, previously-missed puzzle.
    setToday("2024-01-02"); // "today" stays where the streak left off
    playOut("2023-11-01");

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(2); // unchanged
    expect(streak.totalCompleted).toBe(3); // the archive win still counts toward the score
    expect(streak.crushedIt).toBe(3);
  });
});

describe("live-validated words", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("survives a reload even though the word is not in the curated dictionary", () => {
    // A word accepted via the live Merriam-Webster fallback has no entry in
    // dictionary.json or rarity.json, so its saved rarity is the only record of
    // what it scored. loadProgress must not try to re-derive (or drop) it.
    const live: AcceptedWord = { word: "piloerection", rarity: "Extremely Rare", zipf: 1.54 };
    recordAcceptedWord(newProgress("2026-08-18", "tio"), live);

    const reloaded = loadProgress("2026-08-18");
    expect(reloaded?.acceptedWords).toEqual([live]);
  });

  it("counts toward the streak and high score like any other accepted word", () => {
    setToday("2026-08-18");
    recordAcceptedWord(newProgress("2026-08-18", "tio"), {
      word: "piloerection",
      rarity: "Extremely Rare",
      zipf: 1.54,
    });

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(1);
    expect(streak.elite).toBe(1);
    expect(streak.highScore).toBe(rarityScore(1.54, "2026-08-18"));
  });

  it("keeps a word scored at the unattested floor at the floor, not re-derived", () => {
    // The sentinel Zipf is not one of the legacy fallbacks loadProgress migrates,
    // and rarityFor can't answer for an off-list word -- so it must pass through.
    const live: AcceptedWord = { word: "piloerection", rarity: "Legend", zipf: -1.57 };
    recordAcceptedWord(newProgress("2026-08-18", "tio"), live);

    expect(loadProgress("2026-08-18")?.acceptedWords[0]).toEqual(live);
  });
});

describe("history for the leaderboard's import", () => {
  /** A stored day, with whichever timestamps the test wants on it. */
  function store(
    date: string,
    stamps: { firstWordAt?: string; completedAt?: string },
    words = [word("inkling", 2.6, "Rare")]
  ) {
    localStorage.setItem(
      `ick:progress:${date}`,
      JSON.stringify({
        date,
        drop: "ink",
        acceptedWords: words,
        rejectedAttempts: [],
        completed: Boolean(stamps.completedAt),
        ...stamps,
      })
    );
  }

  it("returns the days played on their own date, oldest first", () => {
    store("2026-08-21", { firstWordAt: "2026-08-21T18:00:00" });
    store("2026-08-19", { firstWordAt: "2026-08-19T09:30:00" });
    store("2026-08-20", { firstWordAt: "2026-08-20T23:59:00" });

    expect(playedOnItsDay().map((p) => p.date)).toEqual([
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("counts a day that was played but never finished", () => {
    // The reason firstWordAt exists: this day has no completedAt at all, and it
    // is still a day the player showed up for.
    store("2026-08-20", { firstWordAt: "2026-08-20T08:00:00" });

    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("counts a day started on its date and finished after midnight", () => {
    // Started at 23:50 and finished in the small hours. The completion stamp
    // lands on the following day; the first word is what says when it was
    // played, and it is the one that decides.
    store("2026-08-20", {
      firstWordAt: "2026-08-20T23:50:00",
      completedAt: "2026-08-21T00:07:00",
    });

    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("counts a session that ran a couple of hours past midnight", () => {
    // Everything about this day happened after midnight -- the player sat down
    // late. A late-night session is an ordinary way to play a daily game, and
    // the live path already treats it this way, so the record does too.
    store("2026-08-20", {
      firstWordAt: "2026-08-21T01:30:00",
      completedAt: "2026-08-21T01:42:00",
    });

    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("counts a legacy record whose only stamp is a small-hours completion", () => {
    // No firstWordAt, and the completion landed at 02:10 the next morning. This
    // is exactly the case the grace window was added for.
    store("2026-08-20", { completedAt: "2026-08-21T02:10:00" });

    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("stops counting once the next day is properly under way", () => {
    // 09:00 the following morning is not a late night, it is archive play.
    store("2026-08-20", { firstWordAt: "2026-08-21T09:00:00" });

    expect(playedOnItsDay()).toEqual([]);
  });

  it("draws the grace window at four hours", () => {
    store("2026-08-20", { firstWordAt: "2026-08-21T03:59:00" });
    store("2026-08-14", { firstWordAt: "2026-08-15T04:00:00" });

    // Inside the window counts; the moment it closes does not.
    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("never counts a stamp from before the puzzle dropped", () => {
    // A clock set wrong, or a hand-edited record. Either way it is not evidence
    // of playing the day it dropped.
    store("2026-08-20", { firstWordAt: "2026-08-19T23:00:00" });

    expect(playedOnItsDay()).toEqual([]);
  });

  it("leaves out a puzzle played later out of the archive", () => {
    // First touched three days after it dropped, so it is archive play -- off
    // the board for the same reason it is off the streak.
    store("2026-08-18", {
      firstWordAt: "2026-08-21T18:00:00",
      completedAt: "2026-08-21T18:04:00",
    });

    expect(playedOnItsDay()).toEqual([]);
  });

  it("falls back to the completion stamp on a record saved before firstWordAt", () => {
    store("2026-08-20", { completedAt: "2026-08-20T18:00:00" });
    store("2026-08-14", { completedAt: "2026-08-21T18:00:00" });

    // The older record can still prove the first of these; the second was
    // finished a full day late and well past the small hours.
    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("leaves out a day with no timestamp at all", () => {
    // Not that it didn't happen -- the record cannot say when, and guessing in
    // the player's favour is how the archive gets in.
    store("2026-08-20", {});

    expect(playedOnItsDay()).toEqual([]);
  });

  it("leaves out a day whose timestamp is unreadable", () => {
    store("2026-08-20", { firstWordAt: "sometime on Thursday" });

    expect(playedOnItsDay()).toEqual([]);
  });

  it("leaves out a day with no accepted words", () => {
    store("2026-08-20", { firstWordAt: "2026-08-20T18:00:00" }, []);

    expect(playedOnItsDay()).toEqual([]);
  });

  it("ignores unrelated keys in storage", () => {
    localStorage.setItem("ick:streak", JSON.stringify({ currentStreak: 4 }));
    localStorage.setItem("ick:player", JSON.stringify({ id: "abc", name: "Mo" }));
    store("2026-08-20", { firstWordAt: "2026-08-20T18:00:00" });

    expect(playedOnItsDay().map((p) => p.date)).toEqual(["2026-08-20"]);
  });

  it("has nothing to import for a browser that has never played", () => {
    expect(playedOnItsDay()).toEqual([]);
  });
});

describe("stamping when a puzzle was played", () => {
  it("records the first accepted word, and never moves it", () => {
    setToday("2026-08-20");
    let progress = newProgress("2026-08-20", "ink");
    progress = recordAcceptedWord(progress, word("inkling", 2.6, "Rare"));
    const stamped = progress.firstWordAt;
    expect(stamped).toBeTruthy();
    // No completion yet: this is the case completedAt cannot cover.
    expect(progress.completedAt).toBeUndefined();

    vi.setSystemTime(new Date("2026-08-20T23:00:00"));
    progress = recordAcceptedWord(progress, word("wrinkle", 3.6));
    // The stamp says when the puzzle was played, so only the first word sets it.
    expect(progress.firstWordAt).toBe(stamped);
  });

  it("survives a round trip through storage", () => {
    setToday("2026-08-20");
    const progress = recordAcceptedWord(
      newProgress("2026-08-20", "ink"),
      word("inkling", 2.6, "Rare")
    );

    expect(loadProgress("2026-08-20")?.firstWordAt).toBe(progress.firstWordAt);
  });
});

describe("retryWord", () => {
  it("drops the chosen word and hands its guess back", () => {
    let progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    progress = recordAcceptedWord(progress, word("strut", 3.2, "Rare"));

    const retried = retryWord(progress, "strange");

    expect(retried.acceptedWords).toEqual([word("strut", 3.2, "Rare")]);
    expect(retried.retryUsed).toBe(true);
    // And it survives the round trip through storage, so a reload doesn't hand
    // the word back.
    expect(loadProgress("2024-01-01")).toMatchObject({
      acceptedWords: [word("strut", 3.2, "Rare")],
      retryUsed: true,
    });
  });

  it("takes any banked word, not only the newest", () => {
    let progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    progress = recordAcceptedWord(progress, word("strut"));
    progress = recordAcceptedWord(progress, word("stroll"));

    const retried = retryWord(progress, "strut");

    expect(retried.acceptedWords.map((w) => w.word)).toEqual(["strange", "stroll"]);
  });

  it("is spent once, however many words are left to regret", () => {
    let progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    progress = recordAcceptedWord(progress, word("strut"));

    const once = retryWord(progress, "strange");
    const twice = retryWord(once, "strut");

    // Returned by identity, so the caller can tell nothing happened.
    expect(twice).toBe(once);
    expect(once.acceptedWords.map((w) => w.word)).toEqual(["strut"]);
  });

  it("leaves progress alone when the word was never banked", () => {
    const progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    expect(retryWord(progress, "stroll")).toBe(progress);
  });

  it("re-opens a puzzle the last guess had finished", () => {
    let progress = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i += 1) {
      progress = recordAcceptedWord(progress, word(`word${i}`, 3.2, "Rare"));
    }
    expect(progress.completed).toBe(true);

    const retried = retryWord(progress, "word0");

    expect(retried.completed).toBe(false);
    expect(retried.completedAt).toBeUndefined();
    expect(retried.won).toBeUndefined();
    // The freed slot is spendable, and re-finishing counts the completion once.
    const refilled = recordAcceptedWord(retried, word("stroll", 3.2, "Rare"));
    expect(refilled.completed).toBe(true);
    expect(refilled.won).toBe(true);
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("keeps the streak and the day it was played", () => {
    const progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    const playedAt = progress.firstWordAt;
    expect(loadStreak().currentStreak).toBe(1);

    const retried = retryWord(progress, "strange");

    // The puzzle was played on its day whether or not the word survived, and a
    // feature the game offers must not cost a streak.
    expect(retried.firstWordAt).toBe(playedAt);
    expect(loadStreak().currentStreak).toBe(1);
  });

  it("hands back the tier counters the dropped word had earned", () => {
    const progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 1.2, "Legend")
    );
    expect(loadStreak()).toMatchObject({ crushedIt: 1, elite: 1 });

    retryWord(progress, "strange");

    expect(loadStreak()).toMatchObject({ crushedIt: 0, elite: 0 });
  });

  it("keeps a counter another word on the puzzle still holds", () => {
    let progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 3.2, "Rare")
    );
    progress = recordAcceptedWord(progress, word("strut", 3.1, "Rare"));
    expect(loadStreak().crushedIt).toBe(1);

    retryWord(progress, "strange");

    // The counter moves once per puzzle, and the puzzle still has a Rare on it.
    expect(loadStreak().crushedIt).toBe(1);
  });

  it("leaves the all-time high score standing", () => {
    const progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 1.2, "Legend")
    );
    const best = loadStreak().highScore;
    expect(best).toBe(rarityScore(1.2, "2024-01-01"));

    retryWord(progress, "strange");

    expect(loadStreak().highScore).toBe(best);
  });
});

describe("retryWord round trips", () => {
  // The rollback tests above prove a tier goes back. These prove it can be
  // earned again exactly once -- the risk being that a counter handed back and
  // then re-earned lands at two, or that a rolled-back streak advances twice.
  it("re-earns the crushed-it counter once, not twice", () => {
    const progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 3.2, "Rare")
    );
    expect(loadStreak().crushedIt).toBe(1);

    const retried = retryWord(progress, "strange");
    expect(loadStreak().crushedIt).toBe(0);

    recordAcceptedWord(retried, word("strut", 3.1, "Rare"));
    expect(loadStreak().crushedIt).toBe(1);
  });

  it("re-earns the elite counter once, not twice", () => {
    const progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 1.2, "Legend")
    );
    expect(loadStreak().elite).toBe(1);

    const retried = retryWord(progress, "strange");
    expect(loadStreak().elite).toBe(0);

    recordAcceptedWord(retried, word("strut", 1.1, "Legend"));
    expect(loadStreak().elite).toBe(1);
  });

  it("does not advance the streak a second time after retrying the only word", () => {
    const progress = recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    expect(loadStreak().currentStreak).toBe(1);

    // Back to an empty puzzle, which is the state that makes the next accepted
    // word look like the day's first one.
    const retried = retryWord(progress, "strange");
    expect(retried.acceptedWords).toEqual([]);

    recordAcceptedWord(retried, word("strut"));
    expect(loadStreak().currentStreak).toBe(1);
  });

  it("counts a re-finished puzzle's completion once", () => {
    let progress = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i += 1) {
      progress = recordAcceptedWord(progress, word(`word${i}`, 3.2, "Rare"));
    }
    expect(loadStreak().totalCompleted).toBe(1);

    let retried = retryWord(progress, "word0");
    expect(loadStreak().totalCompleted).toBe(0);

    retried = recordAcceptedWord(retried, word("stroll", 3.2, "Rare"));
    expect(retried.completed).toBe(true);
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("keeps the all-time high score when the retried word was the best", () => {
    let progress = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("strange", 1.2, "Legend")
    );
    const best = loadStreak().highScore;

    progress = retryWord(progress, "strange");
    recordAcceptedWord(progress, word("strut", 5, "Common"));

    // A personal best across every puzzle ever played, and the word was
    // genuinely found -- a lesser replacement does not lower it.
    expect(loadStreak().highScore).toBe(best);
  });
});
