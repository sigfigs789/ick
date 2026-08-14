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
    score: rarityScore(word.zipf, date),
    total_score: totalScore,
    rarity: word.rarity,
    streak_days: streakDays,
  });
}

/** Record rejected submissions so the word list can be reviewed over time. */
export function trackRejectedAnswer(date: string, drop: string, rawWord: string) {
  track("answer_rejected", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: rawWord.trim().toLowerCase(),
  });
}

/** Record the specific rejection feedback shown to a player. */
export function trackRejectionMessage(date: string, reason: RejectionReason) {
  track("rejection_message_shown", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
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
    best_score: best ? rarityScore(best.zipf, progress.date) : 0,
    best_rarity: best?.rarity ?? "None",
    best_word: best?.word ?? "None",
    won: progress.won ?? false,
    completion_method: completionMethod,
    streak_days: streak.currentStreak,
  });
}

/** Record a successful copy from the standard Share button. */
export function trackResultCopied() {
  track("result_copied");
}

/** Record a click on the X share button. */
export function trackResultSharedOnX() {
  track("result_shared_on_x");
}

/** Record visitors who arrive through an X share link. */
export function trackTwitterArrival() {
  track("arrived_from_twitter");
}

/** Record visitors who arrive through a copied Share link. */
export function trackShareArrival() {
  track("arrived_from_share");
}

/** Convert compact share-link codes into analytics campaign sources. */
export function campaignSourceFromSearch(search: string): "share" | "twitter" | null {
  const code = new URLSearchParams(search).get("s");
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  return null;
}
