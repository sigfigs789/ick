import { useEffect, useRef, useState } from "react";
import { DropDisplay } from "./components/DropDisplay";
import { GuessLog } from "./components/GuessLog";
import { SubmitForm } from "./components/SubmitForm";
import { LockInButton } from "./components/LockInButton";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { WordRulesModal } from "./components/WordRulesModal";
import { SoundToggle } from "./components/SoundToggle";
import { PuzzleNav } from "./components/PuzzleNav";
import { ConfettiBurst } from "./components/ConfettiBurst";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { isWinningRarity } from "./game/rank";
import { topRarityScore, totalRarityScore } from "./game/dictionary";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { trackCampaignArrival } from "./analytics";

export default function App() {
  const {
    date,
    puzzleNumber,
    isToday,
    canGoToPrevious,
    canGoToNext,
    goToPrevious,
    goToNext,
    drop,
    progress,
    streak,
    feedback,
    submitWord,
    lockIn,
    resetAnswers,
  } = useDailyPuzzle();
  const [showInstructions, setShowInstructions] = useState(false);
  const [showWordRules, setShowWordRules] = useState(false);
  const [prefill, setPrefill] = useState<{ word: string; token: number } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const sound = useSound();

  // The share links identify their origin with utm_source. Track only the
  // known campaign sources so arbitrary query strings never create events.
  useEffect(() => {
    const source = new URLSearchParams(window.location.search).get("utm_source");
    if (source === "share" || source === "twitter" || source === "reddit") {
      trackCampaignArrival(source);
    }
  }, []);

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

  const hasWinningWord = progress.acceptedWords.some((word) => isWinningRarity(word.rarity));
  // Celebrate the first qualifying word only, never a puzzle restored
  // from storage that already contains one.
  const hadWinningWord = useRef(hasWinningWord);
  useEffect(() => {
    if (hasWinningWord && !hadWinningWord.current) {
      hadWinningWord.current = true;
      sound.complete();
      setShowConfetti(true);
      const timeout = window.setTimeout(() => setShowConfetti(false), 1800);
      return () => window.clearTimeout(timeout);
    }
    hadWinningWord.current = hasWinningWord;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWinningWord]);

  return (
    <div className="app">
      {showConfetti && <ConfettiBurst />}
      <header className="app__header">
        <SoundToggle enabled={sound.enabled} onToggle={sound.toggle} />
        <div className="app__header-titles">
          <h1>WordInk</h1>
          <PuzzleNav
            date={date}
            puzzleNumber={puzzleNumber}
            canGoToPrevious={canGoToPrevious}
            canGoToNext={canGoToNext}
            onPrevious={goToPrevious}
            onNext={goToNext}
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

      <Analytics />
      <SpeedInsights />
      <main>
        <DropDisplay drop={drop} date={date} isToday={isToday} completed={progress.completed} />
        <GuessLog
          acceptedWords={progress.acceptedWords}
          onSelectWord={(word) => setPrefill({ word, token: Date.now() })}
          completed={progress.completed}
          streak={streak}
        />

        {!progress.completed && (
          <SubmitForm
            drop={drop}
            disabled={progress.completed}
            feedback={feedback}
            prefill={prefill}
            onSubmit={submitWord}
          />
        )}
        <FeedbackRegion feedback={feedback} onWordRules={() => setShowWordRules(true)} />

        {import.meta.env.DEV && (
          <button type="button" className="dev-reset-button" onClick={resetAnswers}>
            Reset answers
          </button>
        )}

        {!progress.completed && !isToday && (
          <p className="archive-note">
            You're playing an old puzzle — this is just for fun and won't affect your streak.
          </p>
        )}

        {!progress.completed && progress.acceptedWords.length > 0 && (
          <LockInButton onLockIn={lockIn} />
        )}

        {!progress.completed && (
          <StreakDisplay
            streak={streak}
            totalRarity={totalRarityScore(progress.acceptedWords)}
            topRarity={topRarityScore(progress.acceptedWords)}
          />
        )}

        {progress.completed && (
          <ResultsPanel
            date={date}
            drop={drop}
            words={progress.acceptedWords}
            streak={streak}
          />
        )}
      </main>

      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
      <WordRulesModal open={showWordRules} onClose={() => setShowWordRules(false)} />
    </div>
  );
}
