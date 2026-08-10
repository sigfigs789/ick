import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDays, todayDateString } from "./date";
import { MAX_GUESSES } from "./constants";
import type { AcceptedWord, DailyProgress, StreakState } from "./types";

const PROGRESS_PREFIX = "ink:progress:";
const STREAK_KEY = "ink:streak";

// Same shape and rules as the web version's storage.ts, ported to
// AsyncStorage (which is async, unlike localStorage) -- every function
// here returns a Promise where its web counterpart was synchronous.

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadProgress(date: string): Promise<DailyProgress | null> {
  return safeParse<DailyProgress>(await AsyncStorage.getItem(PROGRESS_PREFIX + date));
}

async function saveProgress(progress: DailyProgress): Promise<void> {
  await AsyncStorage.setItem(PROGRESS_PREFIX + progress.date, JSON.stringify(progress));
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

export async function loadOrCreateProgress(date: string, drop: string): Promise<DailyProgress> {
  const existing = await loadProgress(date);
  if (existing && existing.drop === drop) return existing;
  return newProgress(date, drop);
}

export async function loadStreak(): Promise<StreakState> {
  return (
    safeParse<StreakState>(await AsyncStorage.getItem(STREAK_KEY)) ?? {
      currentStreak: 0,
      longestStreak: 0,
      totalCompleted: 0,
    }
  );
}

async function saveStreak(streak: StreakState): Promise<void> {
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

/**
 * Records an accepted word for the day. Once `MAX_GUESSES` distinct words
 * have been accepted the puzzle auto-completes; before that, the player can
 * keep guessing or call `lockInResult` to stop early and bank their best
 * word so far -- "one official completion per puzzle" either way. The
 * streak only moves if `progress.date` is the real calendar date *right
 * now* (see `updateStreakOnCompletion`) -- completing a past puzzle you
 * browsed back to via the archive is always just practice.
 */
export async function recordAcceptedWord(
  progress: DailyProgress,
  word: AcceptedWord
): Promise<DailyProgress> {
  if (progress.completed) return progress; // no further official changes once complete
  const acceptedWords = [...progress.acceptedWords, word];
  const justCompleted = acceptedWords.length >= MAX_GUESSES;

  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    completed: justCompleted,
    completedAt: justCompleted ? new Date().toISOString() : progress.completedAt,
  };
  await saveProgress(updated);

  if (justCompleted) {
    await updateStreakOnCompletion(progress.date);
  }

  return updated;
}

export async function recordRejectedAttempt(
  progress: DailyProgress,
  rawWord: string
): Promise<DailyProgress> {
  const updated: DailyProgress = {
    ...progress,
    rejectedAttempts: [...progress.rejectedAttempts, rawWord],
  };
  await saveProgress(updated);
  return updated;
}

/**
 * Player-initiated early finish: bank whatever's been accepted so far as
 * the official result, without using all `MAX_GUESSES` attempts. No-op if
 * there's nothing accepted yet or the day is already complete.
 */
export async function lockInResult(progress: DailyProgress): Promise<DailyProgress> {
  if (progress.completed || progress.acceptedWords.length === 0) return progress;

  const updated: DailyProgress = {
    ...progress,
    completed: true,
    completedAt: new Date().toISOString(),
  };
  await saveProgress(updated);
  await updateStreakOnCompletion(progress.date);
  return updated;
}

/** Only a puzzle completed on its own real calendar date moves the streak. */
async function updateStreakOnCompletion(date: string): Promise<void> {
  if (date !== todayDateString()) return;

  const streak = await loadStreak();
  if (streak.lastCompletedDate === date) return; // already counted

  const yesterday = addDays(date, -1);
  const continuesStreak = streak.lastCompletedDate === yesterday;
  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  const updated: StreakState = {
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastCompletedDate: date,
    totalCompleted: streak.totalCompleted + 1,
  };
  await saveStreak(updated);
}
