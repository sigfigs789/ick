import { MAX_GUESSES } from "./constants";
import type { AcceptedWord, DailyProgress, StreakState } from "./types";

const PROGRESS_PREFIX = "ick:progress:";
const STREAK_KEY = "ick:streak";

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

export function newProgress(date: string, fragment: string): DailyProgress {
  return {
    date,
    fragment,
    acceptedWords: [],
    rejectedAttempts: [],
    completed: false,
  };
}

export function loadOrCreateProgress(date: string, fragment: string): DailyProgress {
  const existing = loadProgress(date);
  if (existing && existing.fragment === fragment) return existing;
  return newProgress(date, fragment);
}

export function loadStreak(): StreakState {
  return (
    safeParse<StreakState>(localStorage.getItem(STREAK_KEY)) ?? {
      currentStreak: 0,
      longestStreak: 0,
      totalCompleted: 0,
    }
  );
}

function saveStreak(streak: StreakState): void {
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

function previousDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Records an accepted word for the day. Once `MAX_GUESSES` distinct words
 * have been accepted the puzzle auto-completes (and the streak updates);
 * before that, the player can keep guessing or call `lockInResult` to stop
 * early and bank their best word so far -- "one official completion per
 * puzzle" either way.
 */
export function recordAcceptedWord(progress: DailyProgress, word: AcceptedWord): DailyProgress {
  if (progress.completed) return progress; // no further official changes once complete
  const acceptedWords = [...progress.acceptedWords, word];
  const justCompleted = acceptedWords.length >= MAX_GUESSES;

  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    completed: justCompleted,
    completedAt: justCompleted ? new Date().toISOString() : progress.completedAt,
  };
  saveProgress(updated);

  if (justCompleted) {
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
 * Player-initiated early finish: bank whatever's been accepted so far as
 * the official result, without using all `MAX_GUESSES` attempts. No-op if
 * there's nothing accepted yet or the day is already complete.
 */
export function lockInResult(progress: DailyProgress): DailyProgress {
  if (progress.completed || progress.acceptedWords.length === 0) return progress;

  const updated: DailyProgress = {
    ...progress,
    completed: true,
    completedAt: new Date().toISOString(),
  };
  saveProgress(updated);
  updateStreakOnCompletion(progress.date);
  return updated;
}

function updateStreakOnCompletion(date: string): void {
  const streak = loadStreak();
  if (streak.lastCompletedDate === date) return; // already counted

  const yesterday = previousDateString(date);
  const continuesStreak = streak.lastCompletedDate === yesterday;
  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  const updated: StreakState = {
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastCompletedDate: date,
    totalCompleted: streak.totalCompleted + 1,
  };
  saveStreak(updated);
}
