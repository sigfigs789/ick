import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_GUESSES } from "./constants";
import {
  loadOrCreateProgress,
  loadProgress,
  loadStreak,
  lockInResult,
  newProgress,
  recordAcceptedWord,
  recordRejectedAttempt,
  resetProgress,
} from "./storage";
import type { AcceptedWord, Rarity } from "./types";

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

  it("migrates the former Elusive rank to Mythic in saved progress", () => {
    localStorage.setItem(
      "ick:progress:2024-01-01",
      JSON.stringify({
        ...newProgress("2024-01-01", "str"),
        acceptedWords: [{ word: "abash", rarity: "Elusive", zipf: 1 }],
      })
    );

    expect(loadProgress("2024-01-01")?.acceptedWords[0].rarity).toBe("Mythic");
  });

  it.each([0.1, 0.3])("refreshes words saved with the former %s unknown-frequency fallback", (zipf) => {
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
      zipf: 0.5,
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
    expect(loadStreak()).toMatchObject({ crushedIt: 0, elite: 0 });
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

  it("ends as a loss on the MAX_GUESSES-th lower-rarity word without updating the streak", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    expect(p.completed).toBe(true);
    expect(p.won).toBe(false);
    expect(p.acceptedWords).toHaveLength(MAX_GUESSES);
    expect(loadStreak().currentStreak).toBe(0);
    expect(loadStreak().totalCompleted).toBe(0);
  });

  it("keeps the puzzle active and updates the streak immediately after a Rare-or-better word", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange"));
    p = recordAcceptedWord(p, word("stranger", 3.2, "Rare"));
    expect(p.completed).toBe(false);
    expect(p.won).toBeUndefined();
    expect(p.acceptedWords).toHaveLength(2);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().totalCompleted).toBe(0);
    expect(loadStreak().crushedIt).toBe(1);
  });

  it("records an archived Extremely Rare word immediately without changing the streak", () => {
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
    });
  });

  it("wins on the sixth accepted word when a qualifying word was found", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`, i === 2 ? 3.2 : 5, i === 2 ? "Rare" : "Common"));
    }
    expect(p).toMatchObject({ completed: true, won: true });
    expect(loadStreak()).toMatchObject({ currentStreak: 1, crushedIt: 1, elite: 0 });
  });

  it("tracks an Extremely Rare locked-in win as Elite", () => {
    let p = recordAcceptedWord(
      newProgress("2024-01-01", "str"),
      word("stranger", 2.4, "Extremely Rare")
    );
    p = lockInResult(p);
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

describe("lockInResult", () => {
  it("does nothing if no words have been accepted yet", () => {
    const p = newProgress("2024-01-01", "str");
    expect(lockInResult(p)).toBe(p);
  });

  it("locks in a qualifying result without updating the streak again", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange", 3.2, "Rare"));
    const streakBeforeLockIn = loadStreak().currentStreak;
    const locked = lockInResult(p);
    expect(locked.completed).toBe(true);
    expect(locked.won).toBe(true);
    expect(locked.acceptedWords).toHaveLength(1);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().currentStreak).toBe(streakBeforeLockIn);
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("is a no-op once already completed", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange", 3.2, "Rare"));
    const locked = lockInResult(p);
    expect(lockInResult(locked)).toBe(locked);
  });

  it("counts an archived Rare win without advancing the streak", () => {
    let p = newProgress("2023-06-01", "str");
    p = recordAcceptedWord(p, word("strange", 3.2, "Rare"));
    const locked = lockInResult(p);
    expect(locked.completed).toBe(true);
    expect(loadStreak()).toMatchObject({
      currentStreak: 0,
      totalCompleted: 1,
      crushedIt: 1,
      elite: 0,
    });
  });

  it("counts an archived Extremely Rare win as Elite without advancing the streak", () => {
    let p = newProgress("2023-06-01", "str");
    p = recordAcceptedWord(p, word("stranger", 2.4, "Extremely Rare"));
    lockInResult(p);
    expect(loadStreak()).toMatchObject({
      currentStreak: 0,
      totalCompleted: 1,
      crushedIt: 1,
      elite: 1,
    });
  });
});

describe("streak continuation", () => {
  function complete(date: string) {
    setToday(date);
    let p = newProgress(date, "str");
    p = recordAcceptedWord(p, word(`w-${date}`, 3.2, "Rare"));
    return lockInResult(p);
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
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange", 3.2, "Rare"));
    const locked = lockInResult(p);
    // Re-completing (shouldn't normally happen, but guard against double count)
    lockInResult(locked);
    expect(loadStreak().totalCompleted).toBe(1);
  });

  it("does not let completing an old puzzle out of order corrupt an existing streak", () => {
    complete("2024-01-01");
    complete("2024-01-02");
    expect(loadStreak().currentStreak).toBe(2);

    // Go back and (belatedly) finish a much older, previously-missed puzzle.
    setToday("2024-01-02"); // "today" stays where the streak left off
    let old = newProgress("2023-11-01", "str");
    old = recordAcceptedWord(old, word("old-word", 3.2, "Rare"));
    lockInResult(old);

    const streak = loadStreak();
    expect(streak.currentStreak).toBe(2); // unchanged
    expect(streak.totalCompleted).toBe(3); // the archive win still counts toward the score
    expect(streak.crushedIt).toBe(3);
  });
});
