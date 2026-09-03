import { useEffect, useRef, useState } from "react";
import { DropDisplay } from "./components/DropDisplay";
import { GuessLog } from "./components/GuessLog";
import { SubmitForm } from "./components/SubmitForm";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { WordRulesModal } from "./components/WordRulesModal";
import { PuzzleNav } from "./components/PuzzleNav";
import { ConfettiBurst } from "./components/ConfettiBurst";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { useForceUpdate } from "./hooks/useForceUpdate";
import { isWinningRarity } from "./game/rank";
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
} from "./analytics";
import { recordVisit } from "./game/visits";
import { hasSeen, markSeen } from "./game/whatsNew";
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
    resetAnswers,
  } = useDailyPuzzle();
  // A first-timer who never taps "?" never learns that rarer scores higher --
  // which is the whole game -- so the rules open themselves once, and only
  // once. Read on mount for the same reason as the badge below.
  const [showInstructions, setShowInstructions] = useState(
    () => !hasSeen("instructions"),
  );
  const [showWordRules, setShowWordRules] = useState(false);
  // Read once on mount rather than on every render: this flips exactly once, in
  // openLeaderboard, and reading storage during a render would be the only
  // thing here that did.
  const [leaderboardIsNew, setLeaderboardIsNew] = useState(
    () => !hasSeen("leaderboard"),
  );
  const [showConfetti, setShowConfetti] = useState(false);
  const sound = useSound();

  // The compact share-link code identifies its origin without exposing a
  // long UTM parameter in the result text.
  useEffect(() => {
    const source = campaignSourceFromSearch(window.location.search);
    if (source === "twitter") trackTwitterArrival();
    if (source === "share") trackShareArrival();
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
    // sound.accept/reject are stable across the enabled toggle's own
    // re-renders; only new feedback events should trigger playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  function closeInstructions() {
    // Opened by hand or opened for them, either way they have now met the
    // rules: retire the auto-open for good.
    markSeen("instructions");
    setShowInstructions(false);
  }

  function openLeaderboard(from: "header" | "results") {
    trackLeaderboardOpened(from);
    // Going there is meeting it, from either entry point -- the badge's whole job
    // is to say "there is something here you haven't seen", and once the player
    // has seen it there is nothing left to say. Marked before navigating so the
    // badge is already retired when the back button brings them here again.
    markSeen("leaderboard");
    setLeaderboardIsNew(false);
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

  return (
    <div className="app">
      {showConfetti && <ConfettiBurst />}
      <header className="app__header">
        {/* The wordmark carries the beta chip rather than a banner: the game
            really is changing under players week to week, and a permanent
            label sets that expectation once, in the one place every screen
            shows, without spending a row of the puzzle to say it. Title on
            the chip so the curious get the reason; the h1 text stays
            "WordInk" for screen readers and page semantics. */}
        <h1>
          WordInk
          <span
            className="app__beta"
            title="Still being built — rules and scoring may change."
          >
            beta
          </span>
        </h1>
        <div className="app__header-actions">
          {/* Always here. Earlier versions withheld the trophy until the
              leaderboard had data -- which deadlocked the cold start, since
              finds only appear once players join and joining was only reachable
              through here -- and then until a fixed opening date, which is the
              same waiting room on a timer. The page stands on its own from day
              one: the finds feed is there from the first word, and the history a
              player brings when they join is imported from this browser
              (see backfillHistory), so arriving early costs nothing. */}
          <button
            type="button"
            className="app__icon-button app__icon-button--badged"
            onClick={() => openLeaderboard("header")}
            aria-label={leaderboardIsNew ? "Leaderboard (new)" : "Leaderboard"}
            title="Leaderboard"
          >
            <span aria-hidden="true">🏆</span>
            {/* Both aria-hidden because the button's own label already carries
                the "(new)" -- a screen reader should hear one thing, not two.
                The dot marks the trophy; the callout says what is behind it,
                because a badge nobody can decode is not an announcement.

                Held back until the how-to-play sheet has been met: on a first
                visit that sheet is open over this header, and a callout
                pointing at a trophy the player cannot reach yet is noise
                arriving before the game itself. showInstructions is false
                exactly when the sheet has been seen and closed. */}
            {leaderboardIsNew && (
              <>
                <span className="app__icon-badge" aria-hidden="true" />
                {!showInstructions && (
                  <span className="app__icon-callout" aria-hidden="true">
                    New leaderboard
                  </span>
                )}
              </>
            )}
          </button>
          <button
            type="button"
            className="app__icon-button"
            onClick={() => setShowInstructions(true)}
            aria-label="How to play"
          >
            ?
          </button>
        </div>
      </header>

      <Analytics />
      <SpeedInsights />
      <main>
        {/* Below the header rather than inside it: which puzzle you are on is
            part of the puzzle, not part of the app's identity, and the header
            reads as one clean bar once it holds only the wordmark and the two
            things you can go do. */}
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
          onWordRules={() => setShowWordRules(true)}
        />

        {import.meta.env.DEV && (
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
            onLeaderboard={() => openLeaderboard("results")}
          />
        )}
      </main>

      <InstructionsModal
        open={showInstructions}
        onClose={closeInstructions}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
      />
      <WordRulesModal
        open={showWordRules}
        onClose={() => setShowWordRules(false)}
      />
    </div>
  );
}
