import { useEffect, useRef, useState } from "react";
import { FragmentDisplay } from "./components/FragmentDisplay";
import { GuessLog } from "./components/GuessLog";
import { SubmitForm } from "./components/SubmitForm";
import { LockInButton } from "./components/LockInButton";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { SoundToggle } from "./components/SoundToggle";
import { PuzzleNav } from "./components/PuzzleNav";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";

export default function App() {
  const {
    date,
    puzzleNumber,
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
  } = useDailyPuzzle();
  const [showInstructions, setShowInstructions] = useState(false);
  const [prefill, setPrefill] = useState<{ word: string; token: number } | null>(null);
  const sound = useSound();

  // Clear any pending prefill when the viewed puzzle changes so a stale
  // click-to-reuse value from a different day's log can't leak in.
  useEffect(() => {
    setPrefill(null);
  }, [date]);

  // Play a chime/buzz on every submission, pitched by rarity when accepted.
  useEffect(() => {
    if (!feedback) return;
    if (feedback.kind === "accepted" && feedback.rarity) {
      sound.accept(feedback.rarity);
    } else if (feedback.kind === "rejected") {
      sound.reject();
    }
    // sound.accept/reject are stable across the enabled toggle's own
    // re-renders; only new feedback events should trigger playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  // Play the completion fanfare only on the transition into "completed",
  // not on mount when reopening an already-finished puzzle.
  const wasCompleted = useRef(progress.completed);
  useEffect(() => {
    if (progress.completed && !wasCompleted.current) {
      sound.complete();
    }
    wasCompleted.current = progress.completed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.completed]);

  return (
    <div className="app">
      <header className="app__header">
        <SoundToggle enabled={sound.enabled} onToggle={sound.toggle} />
        <div className="app__header-titles">
          <h1>Ick</h1>
          <PuzzleNav
            date={date}
            puzzleNumber={puzzleNumber}
            isToday={isToday}
            canGoToPrevious={canGoToPrevious}
            canGoToNext={canGoToNext}
            onPrevious={goToPrevious}
            onNext={goToNext}
            onToday={goToToday}
          />
        </div>
        <button
          type="button"
          className="app__icon-button"
          onClick={() => setShowInstructions(true)}
          aria-label="How to play"
        >
          ?
        </button>
      </header>

      <main>
        <FragmentDisplay fragment={fragment} />
        <GuessLog
          acceptedWords={progress.acceptedWords}
          onSelectWord={(word) => setPrefill({ word, token: Date.now() })}
        />

        {!progress.completed && (
          <SubmitForm
            fragment={fragment}
            disabled={progress.completed}
            feedback={feedback}
            prefill={prefill}
            onSubmit={submitWord}
          />
        )}
        <FeedbackRegion feedback={feedback} />

        {!progress.completed && !isToday && (
          <p className="archive-note">
            You're playing an old puzzle — this is just for fun and won't affect your streak.
          </p>
        )}

        {!progress.completed && progress.acceptedWords.length > 0 && (
          <LockInButton onLockIn={lockIn} />
        )}

        {!progress.completed && <StreakDisplay streak={streak} />}

        {progress.completed && (
          <ResultsPanel fragment={fragment} words={progress.acceptedWords} streak={streak} />
        )}
      </main>

      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
    </div>
  );
}
