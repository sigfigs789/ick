import { addDays, todayDateString } from "./date";
import { MAX_GUESSES } from "./constants";
import { rarityScore } from "./dictionary";
import { isEliteRarity, isWinningRarity } from "./rank";
import type { AcceptedWord, DailyProgress, StreakState } from "./types";

const PROGRESS_PREFIX = "ick:progress:";
const STREAK_KEY = "ick:streak";
const EMPTY_STREAK: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompleted: 0,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadProgress(date: string): DailyProgress | null {
  return safeParse<DailyProgress>(localStorage.getItem(PROGRESS_PREFIX + date));
}

function saveProgress(progress: DailyProgress): void {
  localStorage.setItem(PROGRESS_PREFIX + progress.date, JSON.stringify(progress));
}

export function newProgress(date: string, drop: string): DailyProgress {
  return {
    date,
    drop,
    acceptedWords: [],
    rejectedAttempts: [],
    completed: false,
  };
}

export function loadOrCreateProgress(date: string, drop: string): DailyProgress {
  const existing = loadProgress(date);
  if (existing && existing.drop === drop) return existing;
  return newProgress(date, drop);
}

export function loadStreak(): StreakState {
  return { ...EMPTY_STREAK, ...safeParse<StreakState>(localStorage.getItem(STREAK_KEY)) };
}

function saveStreak(streak: StreakState): void {
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

/**
 * A Rare or Extremely Rare word qualifies the player to lock in and is added
 * to the lifetime rarity score immediately. Reaching `MAX_GUESSES` ends the
 * puzzle, winning only if a qualifying word was found.
 */
export function recordAcceptedWord(progress: DailyProgress, word: AcceptedWord): DailyProgress {
  if (progress.completed) return progress; // no further official changes once complete
  const acceptedWords = [...progress.acceptedWords, word];
  const justCompleted = acceptedWords.length >= MAX_GUESSES;
  const won = acceptedWords.some((acceptedWord) => isWinningRarity(acceptedWord.rarity));

  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    completed: justCompleted,
    won: justCompleted ? won : progress.won,
    completedAt: justCompleted ? new Date().toISOString() : progress.completedAt,
  };
  saveProgress(updated);

  updateHighScore(word.zipf);

  if (isWinningRarity(word.rarity)) updateRarityScore(word.rarity);

  if (justCompleted && won) {
    updateStreakOnCompletion(progress.date);
  }

  return updated;
}

export function recordRejectedAttempt(progress: DailyProgress, rawWord: string): DailyProgress {
  const updated: DailyProgress = {
    ...progress,
    rejectedAttempts: [...progress.rejectedAttempts, rawWord],
  };
  saveProgress(updated);
  return updated;
}

/**
 * Player-initiated early finish. It wins only when a Rare-or-better word
 * is already present; otherwise it records a loss without changing streaks.
 */
export function lockInResult(progress: DailyProgress): DailyProgress {
  if (progress.completed || progress.acceptedWords.length === 0) return progress;

  const updated: DailyProgress = {
    ...progress,
    completed: true,
    won: progress.acceptedWords.some((word) => isWinningRarity(word.rarity)),
    completedAt: new Date().toISOString(),
  };
  saveProgress(updated);
  if (updated.won) {
    updateStreakOnCompletion(progress.date);
  }
  return updated;
}

/**
 * Count every winning puzzle toward the completion total. Only a puzzle
 * completed on its own real calendar date can change the daily streak.
 */
function updateStreakOnCompletion(date: string): void {
  const streak = loadStreak();

  if (date !== todayDateString()) {
    saveStreak({
      ...streak,
      totalCompleted: streak.totalCompleted + 1,
    });
    return;
  }

  if (streak.lastCompletedDate === date) return; // already counted

  const yesterday = addDays(date, -1);
  const continuesStreak = streak.lastCompletedDate === yesterday;
  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  const updated: StreakState = {
    ...streak,
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastCompletedDate: date,
    totalCompleted: streak.totalCompleted + 1,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
  };
  saveStreak(updated);
}

/** Rarity scores apply to every qualifying word, including archive puzzles. */
function updateRarityScore(rarity: AcceptedWord["rarity"]): void {
  const streak = loadStreak();
  saveStreak({
    ...streak,
    crushedIt: streak.crushedIt + 1,
    elite: streak.elite + (isEliteRarity(rarity) ? 1 : 0),
  });
}

/** Keep the player's all-time best rarity score, including archive play. */
function updateHighScore(zipf: number): void {
  const streak = loadStreak();
  const score = rarityScore(zipf);
  if (score <= streak.highScore) return;
  saveStreak({ ...streak, highScore: score });
}
