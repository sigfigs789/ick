import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { puzzleNumber } from "../game/share";
import dropData from "../data/drops.json";
import {
  loadOrCreateProgress,
  loadStreak,
  lockInResult,
  newProgress,
  recordAcceptedWord,
  recordRejectedAttempt,
} from "../game/storage";
import { evaluateSubmission, REJECTION_MESSAGES } from "../game/submit";
import type { DailyProgress, Rarity, StreakState } from "../game/types";

export interface Feedback {
  kind: "accepted" | "rejected";
  message: string;
  rarity?: Rarity;
  /** Bumped on every feedback event so screen readers re-announce repeats. */
  key: number;
}

/**
 * Same game logic as the web app's useDailyPuzzle, adapted for
 * AsyncStorage's async API -- `progress`/`streak` start out as a
 * synchronous placeholder (`isLoading: true`) and are replaced once the
 * real persisted state loads, instead of being available synchronously on
 * first render like localStorage.
 */
export function useDailyPuzzle() {
  const today = useMemo(() => todayDateString(), []);
  const [viewedDate, setViewedDate] = useState(today);
  const drop = useMemo(() => dropForDate(viewedDate), [viewedDate]);
  const isToday = viewedDate === today;
  const canGoToPrevious = viewedDate > dropData.epoch;
  const canGoToNext = viewedDate < today;

  const [progress, setProgress] = useState<DailyProgress>(() => newProgress(viewedDate, drop));
  const [streak, setStreak] = useState<StreakState>({
    currentStreak: 0,
    longestStreak: 0,
    totalCompleted: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useRef(0);

  // Reload whenever the viewed puzzle changes (browsing the archive) --
  // each date's progress is saved independently (see storage.ts), so
  // switching back to a puzzle you'd already started resumes it.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([loadOrCreateProgress(viewedDate, drop), loadStreak()]).then(
      ([loadedProgress, loadedStreak]) => {
        if (cancelled) return;
        setProgress(loadedProgress);
        setStreak(loadedStreak);
        setFeedback(null);
        setIsLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [viewedDate, drop]);

  const submitWord = useCallback(
    async (raw: string) => {
      const result = evaluateSubmission(raw, drop, progress.acceptedWords);
      feedbackKey.current += 1;

      if (!result.ok || !result.word) {
        const message = REJECTION_MESSAGES[result.reason ?? "not-a-word"];
        const updated = await recordRejectedAttempt(progress, raw.trim());
        setProgress(updated);
        setFeedback({ kind: "rejected", message, key: feedbackKey.current });
        return result;
      }

      const updated = await recordAcceptedWord(progress, result.word);
      setProgress(updated);
      if (updated.completed) setStreak(await loadStreak());
      setFeedback({
        kind: "accepted",
        message: `"${result.word.word}" accepted — ${result.word.rarity}.`,
        rarity: result.word.rarity,
        key: feedbackKey.current,
      });
      return result;
    },
    [drop, progress]
  );

  /** Player-initiated early finish: bank the best word(s) so far instead of using all 6 guesses. */
  const lockIn = useCallback(async () => {
    const updated = await lockInResult(progress);
    setProgress(updated);
    if (updated.completed) setStreak(await loadStreak());
  }, [progress]);

  const goToPrevious = useCallback(() => {
    setViewedDate((d) => (d > dropData.epoch ? addDays(d, -1) : d));
  }, []);

  const goToNext = useCallback(() => {
    setViewedDate((d) => (d < today ? addDays(d, 1) : d));
  }, [today]);

  const goToToday = useCallback(() => setViewedDate(today), [today]);

  return {
    date: viewedDate,
    puzzleNumber: puzzleNumber(viewedDate),
    isToday,
    canGoToPrevious,
    canGoToNext,
    goToPrevious,
    goToNext,
    goToToday,
    drop,
    progress,
    streak,
    isLoading,
    feedback,
    submitWord,
    lockIn,
  };
}
