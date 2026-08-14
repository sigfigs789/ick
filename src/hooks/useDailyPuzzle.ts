import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { puzzleNumber } from "../game/share";
import dropData from "../data/drops.json";
import {
  loadOrCreateProgress,
  loadStreak,
  lockInResult,
  recordAcceptedWord,
  recordRejectedAttempt,
  resetProgress,
} from "../game/storage";
import { evaluateSubmission, REJECTION_MESSAGES } from "../game/submit";
import { totalRarityScore } from "../game/dictionary";
import type { DailyProgress, Rarity, StreakState } from "../game/types";
import { trackAcceptedAnswer, trackPuzzleCompleted, trackRejectedAnswer, trackRejectionMessage } from "../analytics";

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
  const drop = useMemo(() => dropForDate(viewedDate), [viewedDate]);
  const isToday = viewedDate === today;
  const canGoToPrevious = viewedDate > dropData.epoch;
  const canGoToNext = viewedDate < today;

  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadOrCreateProgress(viewedDate, drop)
  );
  const [streak, setStreak] = useState<StreakState>(() => loadStreak());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useRef(0);

  // Reload whenever the viewed puzzle changes (browsing the archive) --
  // each date's progress is saved independently (see storage.ts), so
  // switching back to a puzzle you'd already started resumes it.
  useEffect(() => {
    setProgress(loadOrCreateProgress(viewedDate, drop));
    setFeedback(null);
  }, [viewedDate, drop]);

  const submitWord = useCallback(
    (raw: string) => {
      const result = evaluateSubmission(raw, drop, progress.acceptedWords);
      feedbackKey.current += 1;

      if (!result.ok || !result.word) {
        const reason = result.reason ?? "not-a-word";
        const message = REJECTION_MESSAGES[reason];
        setProgress((p) => recordRejectedAttempt(p, raw.trim()));
        trackRejectedAnswer(viewedDate, drop, raw);
        trackRejectionMessage(viewedDate, reason);
        setFeedback({ kind: "rejected", message, key: feedbackKey.current });
        return result;
      }

      const updated = recordAcceptedWord(progress, result.word);
      setProgress(updated);
      const updatedStreak = loadStreak();
      setStreak(updatedStreak);
      trackAcceptedAnswer(
        viewedDate,
        result.word,
        updated.acceptedWords.length,
        totalRarityScore(updated.acceptedWords),
        updatedStreak.currentStreak
      );
      if (updated.completed) {
        trackPuzzleCompleted(updated, "all_answers", updatedStreak);
      }
      setFeedback({
        kind: "accepted",
        message: `"${result.word.word}" accepted — ${result.word.rarity}.`,
        rarity: result.word.rarity,
        key: feedbackKey.current,
      });
      return result;
    },
    [drop, progress, viewedDate]
  );

  /** Player-initiated early finish: bank the best word(s) so far instead of using all 6 guesses. */
  const lockIn = useCallback(() => {
    const updated = lockInResult(progress);
    setProgress(updated);
    const updatedStreak = loadStreak();
    if (updated.won) setStreak(updatedStreak);
    if (updated.completed && !progress.completed) {
      trackPuzzleCompleted(updated, "locked_in", updatedStreak);
    }
  }, [progress]);

  const resetAnswers = useCallback(() => {
    setProgress(resetProgress(viewedDate, drop));
    setFeedback(null);
  }, [viewedDate, drop]);

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
    feedback,
    submitWord,
    lockIn,
    resetAnswers,
  };
}
