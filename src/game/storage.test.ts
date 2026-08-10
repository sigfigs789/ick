import { beforeEach, describe, expect, it } from "vitest";
import { MAX_GUESSES } from "./constants";
import {
  loadOrCreateProgress,
  loadProgress,
  loadStreak,
  lockInResult,
  newProgress,
  recordAcceptedWord,
  recordRejectedAttempt,
} from "./storage";
import type { AcceptedWord } from "./types";

function word(w: string, zipf = 5): AcceptedWord {
  return { word: w, rarity: "Common", zipf };
}

beforeEach(() => {
  localStorage.clear();
});

describe("newProgress / loadOrCreateProgress", () => {
  it("creates fresh, incomplete progress", () => {
    const p = newProgress("2024-01-01", "str");
    expect(p).toMatchObject({
      date: "2024-01-01",
      fragment: "str",
      acceptedWords: [],
      rejectedAttempts: [],
      completed: false,
    });
  });

  it("loads existing progress for the same fragment instead of recreating it", () => {
    recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    const loaded = loadOrCreateProgress("2024-01-01", "str");
    expect(loaded.acceptedWords).toEqual([word("strange")]);
  });

  it("discards stale progress if the day's fragment has since changed", () => {
    recordAcceptedWord(newProgress("2024-01-01", "str"), word("strange"));
    const loaded = loadOrCreateProgress("2024-01-01", "ou");
    expect(loaded.acceptedWords).toEqual([]);
    expect(loaded.fragment).toBe("ou");
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

  it("auto-completes on the MAX_GUESSES-th word and updates the streak", () => {
    let p = newProgress("2024-01-01", "str");
    for (let i = 0; i < MAX_GUESSES; i++) {
      p = recordAcceptedWord(p, word(`word${i}`));
    }
    expect(p.completed).toBe(true);
    expect(p.acceptedWords).toHaveLength(MAX_GUESSES);
    expect(loadStreak().currentStreak).toBe(1);
    expect(loadStreak().totalCompleted).toBe(1);
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

  it("marks the puzzle complete early and updates the streak", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange"));
    const locked = lockInResult(p);
    expect(locked.completed).toBe(true);
    expect(locked.acceptedWords).toHaveLength(1);
    expect(loadStreak().currentStreak).toBe(1);
  });

  it("is a no-op once already completed", () => {
    let p = newProgress("2024-01-01", "str");
    p = recordAcceptedWord(p, word("strange"));
    const locked = lockInResult(p);
    expect(lockInResult(locked)).toBe(locked);
  });
});

describe("streak continuation", () => {
  function complete(date: string) {
    let p = newProgress(date, "str");
    p = recordAcceptedWord(p, word(`w-${date}`));
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
    p = recordAcceptedWord(p, word("strange"));
    const locked = lockInResult(p);
    // Re-completing (shouldn't normally happen, but guard against double count)
    lockInResult(locked);
    expect(loadStreak().totalCompleted).toBe(1);
  });
});
