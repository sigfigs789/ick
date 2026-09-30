import { useCallback, useEffect, useRef, useState } from "react";
import { DropDisplay } from "./components/DropDisplay";
import { GuessLog } from "./components/GuessLog";
import { DEV_TOOLS } from "./dev/devTools";
import { SubmitForm } from "./components/SubmitForm";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { WordRulesModal } from "./components/WordRulesModal";
import { PuzzleNav } from "./components/PuzzleNav";
import { ConfettiBurst } from "./components/ConfettiBurst";
import { PerfectMonthCelebration } from "./components/PerfectMonthCelebration";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { useForceUpdate } from "./hooks/useForceUpdate";
import { isWinningRarity } from "./game/rank";
import { completedWholeMonth } from "./game/perfectMonth";
import { topRarityScore, totalRarityScore } from "./game/dictionary";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import {
  campaignSourceFromSearch,
  trackRedditArrival,
  trackShareArrival,
  trackTwitterArrival,
  trackLeaderboardOpened,
  trackSessionTime,
  trackVisit,
  isReporting,
} from "./analytics";
import { recordVisit } from "./game/visits";
import { sharedModeFromSearch } from "./game/onboarding";
import { navigate } from "./routes";
import {
  beginSession,
  endSessionSegment,
  resumeSession,
} from "./game/sessionTime";

export default function App() {
  useForceUpdate();
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
    liveNote,
    checking,
    submitWord,
    canRetry,
    retryOffered,
    retrySpent,
    retryAnswer,
    revealAnswer,
    resetAnswers,
  } = useDailyPuzzle();
  const [showWordRules, setShowWordRules] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showPerfectMonth, setShowPerfectMonth] = useState(false);
  const endPerfectMonth = useCallback(() => setShowPerfectMonth(false), []);
  const sound = useSound();

  // The compact share-link code identifies its origin without exposing a
  // long UTM parameter in the result text.
  useEffect(() => {
    const source = campaignSourceFromSearch(window.location.search);
    const sharedMode = sharedModeFromSearch(window.location.search);
    if (source === "twitter") trackTwitterArrival(sharedMode);
    if (source === "share") trackShareArrival(sharedMode);
    if (source === "reddit") trackRedditArrival();

    // Count and report this open once per session (a reload does not recount),
    // recording whether the player is new or returning and where they came from.
    const visit = recordVisit(window.location.search);
    if (visit) trackVisit(visit);
  }, []);

  // Measure how long this session lasts, and how much of it comes after the
  // first guess. There is no reliable "tab closed" event, so every hide is
  // treated as a possible end and reported; coming back resumes the same
  // session rather than starting a new one (see game/sessionTime).
  useEffect(() => {
    beginSession();

    const report = () => {
      const ended = endSessionSegment();
      if (ended) trackSessionTime(ended);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") report();
      else resumeSession();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // pagehide covers the desktop close and back/forward-cache cases, where
    // visibilitychange is not guaranteed to arrive first.
    window.addEventListener("pagehide", report);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", report);
    };
  }, []);

  // Play a chime/buzz on every submission, pitched by rarity when accepted.
  useEffect(() => {
    if (!feedback) return;
    if (feedback.kind === "accepted" && feedback.rarity) {
      sound.accept(feedback.rarity);
    } else if (feedback.kind === "rejected") {
      sound.reject();
    }
    // sound.accept/reject are stable; only new feedback events should
    // trigger playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  function openLeaderboard() {
    trackLeaderboardOpened("results");
    // Nothing to retire here: the badge on the header's Leaderboards tab is
    // retired by arriving on the page, from whichever door (see AppHeader).
    navigate("leaderboard");
  }

  const hasWinningWord = progress.acceptedWords.some((word) =>
    isWinningRarity(word.rarity),
  );
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

  // A month played without a day missed (see game/perfectMonth.ts), celebrated
  // on the word that finishes it. Remembered by date rather than as a flag, so
  // stepping back through the archive and forward to today again does not
  // throw a second party -- and a reload after the fact, which mounts already
  // perfect, throws none.
  const perfectMonth = isToday && completedWholeMonth(streak, date);
  const celebratedMonth = useRef(perfectMonth ? date : null);
  useEffect(() => {
    if (!perfectMonth || celebratedMonth.current === date) return;
    celebratedMonth.current = date;
    // The month banks on the day's first word, so the only chime it could
    // clash with is that same word being Rare -- which has just played one.
    if (!hasWinningWord) sound.complete();
    setShowPerfectMonth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfectMonth, date]);

  return (
    <>
      {showPerfectMonth ? (
        <PerfectMonthCelebration
          date={date}
          days={Number(date.slice(8, 10))}
          onDone={endPerfectMonth}
        />
      ) : (
        showConfetti && <ConfettiBurst />
      )}

      {/* Not mounted where reporting is off: inside a Reddit post both scripts
          are blocked by the frame's content policy, and neither should be
          reaching a third party from there in any case. See analytics.ts. */}
      {isReporting() && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
      <main>
        {/* Below the header rather than inside it: which puzzle you are on is
            part of the puzzle, not part of the app's identity -- and the header
            belongs to all three pages now (see src/components/AppHeader.tsx),
            so nothing about one puzzle could live in it even if it wanted to. */}
        <PuzzleNav
          date={date}
          puzzleNumber={puzzleNumber}
          canGoToPrevious={canGoToPrevious}
          canGoToNext={canGoToNext}
          onPrevious={goToPrevious}
          onNext={goToNext}
        />
        <DropDisplay
          drop={drop}
          date={date}
          isToday={isToday}
          completed={progress.completed}
          retryOffered={retryOffered}
          onReveal={revealAnswer}
        />
        <GuessLog
          acceptedWords={progress.acceptedWords}
          completed={progress.completed}
          streak={streak}
          date={date}
          canRetry={canRetry}
          retryOffered={retryOffered}
          retrySpent={retrySpent}
          onRetry={retryAnswer}
        />

        {!progress.completed && (
          <SubmitForm
            drop={drop}
            disabled={progress.completed}
            feedback={feedback}
            checking={checking}
            onSubmit={submitWord}
          />
        )}
        <FeedbackRegion
          feedback={feedback}
          note={liveNote}
          reserveSpace={!progress.completed}
          onWordRules={() => setShowWordRules(true)}
        />

        {DEV_TOOLS && (
          <button
            type="button"
            className="dev-reset-button"
            onClick={resetAnswers}
          >
            Reset answers
          </button>
        )}

        {!progress.completed && !isToday && (
          <p className="archive-note">
            You're playing an old puzzle — this is just for fun and won't affect
            your streak.
          </p>
        )}

        {!progress.completed && (
          <StreakDisplay
            streak={streak}
            totalRarity={totalRarityScore(progress.acceptedWords, date)}
            topRarity={topRarityScore(progress.acceptedWords, date)}
            date={date}
          />
        )}

        {/* From the first banked word, not from the end of the puzzle.
            Sharing used to be the reward for pressing "I'm done guessing",
            which was the only way to reach this panel short of spending every
            guess -- so a player sitting on the best word they will find all
            week had to declare the day over to post it, and the declaration
            was irreversible. Nothing was ever at stake in it: the streak, the
            tier counters and the leaderboard all bank on the accepted word
            itself (see game/storage.ts), so the button gated a text box and
            nothing else.

            The panel reads the live word list, so a share taken now and a
            share taken three words later are both current. */}
        {progress.acceptedWords.length > 0 && (
          <ResultsPanel
            date={date}
            drop={drop}
            words={progress.acceptedWords}
            streak={streak}
            isToday={isToday}
            mode={progress.mode}
            onLeaderboard={openLeaderboard}
          />
        )}
      </main>

      <WordRulesModal
        open={showWordRules}
        date={date}
        onClose={() => setShowWordRules(false)}
      />
    </>
  );
}
