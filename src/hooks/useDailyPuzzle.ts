import { useCallback, useMemo, useState } from "react";
import { todayDateString } from "../game/date";
import { fragmentForDate } from "../game/fragment";
import {
  loadOrCreateProgress,
  loadStreak,
  recordAcceptedWord,
  recordRejectedAttempt,
} from "../game/storage";
import { evaluateSubmission, REJECTION_MESSAGES } from "../game/submit";
import type { DailyProgress, StreakState } from "../game/types";

export interface Feedback {
  kind: "accepted" | "rejected";
  message: string;
  /** Bumped on every feedback event so screen readers re-announce repeats. */
  key: number;
}

export function useDailyPuzzle() {
  const date = useMemo(() => todayDateString(), []);
  const fragment = useMemo(() => fragmentForDate(date), [date]);

  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadOrCreateProgress(date, fragment)
  );
  const [streak, setStreak] = useState<StreakState>(() => loadStreak());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useMemo(() => ({ current: 0 }), []);

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
      setFeedback({
        kind: "accepted",
        message: `"${result.word.word}" accepted — ${result.word.rarity}.`,
        key: feedbackKey.current,
      });
      if (updated.completed) {
        setStreak(loadStreak());
      }
      return result;
    },
    [fragment, progress, feedbackKey]
  );

  return { date, fragment, progress, streak, feedback, submitWord };
}
