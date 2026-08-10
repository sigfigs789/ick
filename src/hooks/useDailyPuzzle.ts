import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { fragmentForDate } from "../game/fragment";
import { puzzleNumber } from "../game/share";
import fragmentData from "../data/fragments.json";
import {
  loadOrCreateProgress,
  loadStreak,
  lockInResult,
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

export function useDailyPuzzle() {
  const today = useMemo(() => todayDateString(), []);
  const [viewedDate, setViewedDate] = useState(today);
  const fragment = useMemo(() => fragmentForDate(viewedDate), [viewedDate]);
  const isToday = viewedDate === today;
  const canGoToPrevious = viewedDate > fragmentData.epoch;
  const canGoToNext = viewedDate < today;

  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadOrCreateProgress(viewedDate, fragment)
  );
  const [streak, setStreak] = useState<StreakState>(() => loadStreak());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useRef(0);

  // Reload whenever the viewed puzzle changes (browsing the archive) --
  // each date's progress is saved independently (see storage.ts), so
  // switching back to a puzzle you'd already started resumes it.
  useEffect(() => {
    setProgress(loadOrCreateProgress(viewedDate, fragment));
    setFeedback(null);
  }, [viewedDate, fragment]);

  const submitWord = useCallback(
    (raw: string) => {
      const result = evaluateSubmission(raw, fragment, progress.acceptedWords);
      feedbackKey.current += 1;

      if (!result.ok || !result.word) {
        const message = REJECTION_MESSAGES[result.reason ?? "not-a-word"];
        setProgress((p) => recordRejectedAttempt(p, raw.trim()));
        setFeedback({ kind: "rejected", message, key: feedbackKey.current });
        return result;
      }

      const updated = recordAcceptedWord(progress, result.word);
      setProgress(updated);
      if (updated.completed) setStreak(loadStreak());
      setFeedback({
        kind: "accepted",
        message: `"${result.word.word}" accepted — ${result.word.rarity}.`,
        rarity: result.word.rarity,
        key: feedbackKey.current,
      });
      return result;
    },
    [fragment, progress]
  );

  /** Player-initiated early finish: bank the best word(s) so far instead of using all 6 guesses. */
  const lockIn = useCallback(() => {
    const updated = lockInResult(progress);
    setProgress(updated);
    if (updated.completed) setStreak(loadStreak());
  }, [progress]);

  const goToPrevious = useCallback(() => {
    setViewedDate((d) => (d > fragmentData.epoch ? addDays(d, -1) : d));
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
    fragment,
    progress,
    streak,
    feedback,
    submitWord,
    lockIn,
  };
}
