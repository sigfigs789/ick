import { track } from "@vercel/analytics";
import { describe, expect, it, vi } from "vitest";
import { trackAcceptedAnswer, trackPuzzleCompleted, trackRejectedAnswer, trackResultShared, trackWordSuggestion } from "./analytics";
import { puzzleNumber } from "./game/share";
import type { DailyProgress, StreakState } from "./game/types";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

describe("trackRejectedAnswer", () => {
  it("records the normalized word and rejection reason", () => {
    trackRejectedAnswer("2026-08-12", "AR", "  BaNANA  ", "not-a-word");

    expect(track).toHaveBeenCalledWith("answer_rejected", {
      puzzle_date: "2026-08-12",
      puzzle_number: puzzleNumber("2026-08-12"),
      drop: "ar",
      word: "banana",
      rejection_reason: "not-a-word",
    });
  });
});

describe("remaining game analytics", () => {
  const streak: StreakState = {
    currentStreak: 3,
    longestStreak: 3,
    totalCompleted: 3,
    crushedIt: 2,
    elite: 1,
    highScore: 7,
  };

  it("tracks accepted answers with their score and current streak", () => {
    trackAcceptedAnswer("2026-08-12", { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 }, 2, 14.8, 3);

    expect(track).toHaveBeenCalledWith("answer_accepted", expect.objectContaining({
      answer_count: 2,
      word: "aardvark",
      total_score: 14.8,
      rarity: "Extremely Rare",
      streak_days: 3,
    }));
  });

  it("tracks completion using the rarest accepted word", () => {
    const progress: DailyProgress = {
      date: "2026-08-12",
      drop: "ar",
      acceptedWords: [
        { word: "market", rarity: "Common", zipf: 4.6 },
        { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
      ],
      rejectedAttempts: [],
      completed: true,
      won: true,
    };
    trackPuzzleCompleted(progress, "locked_in", streak);

    expect(track).toHaveBeenCalledWith("puzzle_completed", expect.objectContaining({
      answer_count: 2,
      best_word: "aardvark",
      best_rarity: "Extremely Rare",
      won: true,
      completion_method: "locked_in",
      streak_days: 3,
    }));
  });

  it("tracks a shared text result without answer content", () => {
    trackResultShared("2026-08-12", 3);

    expect(track).toHaveBeenCalledWith("result_shared", {
      puzzle_date: "2026-08-12",
      puzzle_number: puzzleNumber("2026-08-12"),
      share_format: "text",
      streak_days: 3,
    });
  });
});

describe("trackWordSuggestion", () => {
  it("records a normalized suggested word", () => {
    trackWordSuggestion("  GastroEnterology ");

    expect(track).toHaveBeenCalledWith("word_suggested", { word: "gastroenterology" });
  });
});
