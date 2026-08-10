import { track } from "@vercel/analytics";
import { rarityScore } from "./game/dictionary";
import { bestWord } from "./game/rank";
import { puzzleNumber } from "./game/share";
import type { AcceptedWord, DailyProgress, StreakState } from "./game/types";

/**
 * Send aggregate game activity to Vercel without including submitted words
 * or any player-identifying information.
 */
export function trackAcceptedAnswer(
  date: string,
  word: AcceptedWord,
  answerCount: number,
  streakDays: number
) {
  track("answer_accepted", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    answer_count: answerCount,
    word: word.word,
    score: rarityScore(word.zipf),
    rarity: word.rarity,
    streak_days: streakDays,
  });
}

export function trackPuzzleCompleted(
  progress: DailyProgress,
  completionMethod: "locked_in" | "all_answers",
  streak: StreakState
) {
  const best = bestWord(progress.acceptedWords);
  track("puzzle_completed", {
    puzzle_date: progress.date,
    puzzle_number: puzzleNumber(progress.date),
    answer_count: progress.acceptedWords.length,
    best_score: best ? rarityScore(best.zipf) : 0,
    best_rarity: best?.rarity ?? "None",
    best_word: best?.word ?? "None",
    won: progress.won ?? false,
    completion_method: completionMethod,
    streak_days: streak.currentStreak,
  });
}

export function trackResultShared(date: string, streakDays: number) {
  track("result_shared", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    share_format: "text",
    streak_days: streakDays,
  });
}
