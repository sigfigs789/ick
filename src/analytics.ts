import { track } from "@vercel/analytics";
import { rarityScore } from "./game/dictionary";
import { bestWord } from "./game/rank";
import { puzzleNumber } from "./game/share";
import type { AcceptedWord, DailyProgress, RejectionReason, StreakState } from "./game/types";

/**
 * Send game activity to Vercel without player-identifying information.
 */
export function trackAcceptedAnswer(
  date: string,
  word: AcceptedWord,
  answerCount: number,
  totalScore: number,
  streakDays: number
) {
  track("answer_accepted", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    answer_count: answerCount,
    word: word.word,
    score: rarityScore(word.zipf),
    total_score: totalScore,
    rarity: word.rarity,
    streak_days: streakDays,
  });
}

/** Record rejected submissions so the word list can be reviewed over time. */
export function trackRejectedAnswer(date: string, drop: string, rawWord: string, reason: RejectionReason) {
  track("answer_rejected", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: rawWord.trim().toLowerCase(),
    rejection_reason: reason,
  });
}

/** Record player suggestions for future curated-list reviews. */
export function trackWordSuggestion(rawWord: string) {
  track("word_suggested", { word: rawWord.trim().toLowerCase() });
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

/** Record visitors who arrive through a campaign-tagged share link. */
export function trackCampaignArrival(source: string) {
  track("campaign_arrival", { source });
}

/** Convert compact share-link codes into analytics campaign sources. */
export function campaignSourceFromSearch(search: string): "share" | "twitter" | null {
  const code = new URLSearchParams(search).get("s");
  if (code === "sh") return "share";
  if (code === "tw") return "twitter";
  return null;
}
