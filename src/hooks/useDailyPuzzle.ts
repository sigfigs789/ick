import { useCallback, useMemo, useRef, useState } from "react";
import { MAX_GUESSES } from "../game/constants";
import { todayDateString } from "../game/date";
import { fragmentForDate, randomFragment } from "../game/fragment";
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

export function useDailyPuzzle() {
  const date = useMemo(() => todayDateString(), []);
  const officialFragment = useMemo(() => fragmentForDate(date), [date]);

  // Dev-only escape hatch (see rerollDev below): when set, gameplay uses
  // this fragment and an in-memory-only progress instead of the real
  // day's puzzle, so testing never reads or writes real daily/streak data.
  const [devFragment, setDevFragment] = useState<string | null>(null);
  const fragment = devFragment ?? officialFragment;
  const isDevPuzzle = devFragment !== null;

  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadOrCreateProgress(date, officialFragment)
  );
  const [streak, setStreak] = useState<StreakState>(() => loadStreak());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useRef(0);

  const submitWord = useCallback(
    (raw: string) => {
      const result = evaluateSubmission(raw, fragment, progress.acceptedWords);
      feedbackKey.current += 1;

      if (!result.ok || !result.word) {
        const message = REJECTION_MESSAGES[result.reason ?? "not-a-word"];
        setProgress((p) =>
          isDevPuzzle
            ? { ...p, rejectedAttempts: [...p.rejectedAttempts, raw.trim()] }
            : recordRejectedAttempt(p, raw.trim())
        );
        setFeedback({ kind: "rejected", message, key: feedbackKey.current });
        return result;
      }

      if (isDevPuzzle) {
        setProgress((p) => {
          const acceptedWords = [...p.acceptedWords, result.word!];
          return { ...p, acceptedWords, completed: acceptedWords.length >= MAX_GUESSES };
        });
      } else {
        const updated = recordAcceptedWord(progress, result.word);
        setProgress(updated);
        if (updated.completed) setStreak(loadStreak());
      }
      setFeedback({
        kind: "accepted",
        message: `"${result.word.word}" accepted — ${result.word.rarity}.`,
        rarity: result.word.rarity,
        key: feedbackKey.current,
      });
      return result;
    },
    [fragment, progress, isDevPuzzle]
  );

  /** Player-initiated early finish: bank the best word(s) so far instead of using all 6 guesses. */
  const lockIn = useCallback(() => {
    if (isDevPuzzle) {
      setProgress((p) =>
        p.completed || p.acceptedWords.length === 0
          ? p
          : { ...p, completed: true, completedAt: new Date().toISOString() }
      );
      return;
    }
    const updated = lockInResult(progress);
    setProgress(updated);
    if (updated.completed) setStreak(loadStreak());
  }, [progress, isDevPuzzle]);

  /** Dev-only: swap in a random fragment and a fresh, unsaved puzzle to test against. */
  const rerollDev = useCallback(() => {
    const next = randomFragment(fragment);
    setDevFragment(next);
    setProgress(newProgress(date, next));
    setFeedback(null);
  }, [fragment, date]);

  return {
    date,
    fragment,
    progress,
    streak,
    feedback,
    submitWord,
    lockIn,
    isDevPuzzle,
    rerollDev,
  };
}
