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
import { boardsOpen } from "./game/leaderboard";
import { navigate } from "./routes";
import { beginSession, endSessionSegment, resumeSession } from "./game/sessionTime";

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
    lockIn,
    resetAnswers,
  } = useDailyPuzzle();
  const [showInstructions, setShowInstructions] = useState(false);
  const [showWordRules, setShowWordRules] = useState(false);
  // Read once on mount rather than on every render: this flips exactly once, in
  // openLeaderboard, and reading storage during a render would be the only
  // thing here that did.
  //
  // Whether there is a leaderboard to point at yet. Read once at mount, so it
  // settles on a refresh and at no other time -- the same rule the puzzle's own
  // date follows.
  const [leaderboardOpen] = useState(boardsOpen);
  //
  // Held back with it. Until the boards open the leaderboard is a page naming a
  // day it is not yet, which is not the news a badge is for -- and a badge is
  // spent the first time it is followed, so aiming it at a waiting room would
  // use it up before there was anything to announce.
  const [leaderboardIsNew, setLeaderboardIsNew] = useState(
    () => leaderboardOpen && !hasSeen("leaderboard")
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

  function openLeaderboard(from: "header" | "results") {
    trackLeaderboardOpened(from);
    // Going there is meeting it, from either entry point -- the badge's whole job
    // is to say "there is something here you haven't seen", and once the player
    // has seen it there is nothing left to say. Marked before navigating so the
    // badge is already retired when the back button brings them here again.
    //
    // Only once there is something to meet, though. Players are expected on this
    // page before the boards go live -- that visit is what gets their history
    // counted -- so retiring the badge for it would mean the people who came
    // early are exactly the ones never told the boards had opened.
    if (leaderboardOpen) {
      markSeen("leaderboard");
      setLeaderboardIsNew(false);
    }
    navigate("leaderboard");
  }

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
        <div className="app__header-actions">
          {/* Not in the header until there is a board behind it. An earlier
              version hid it until the leaderboard had *data*, which deadlocked
              the cold start -- finds only appear once players join, and joining
              was only reachable through here. A date does not deadlock: it
              arrives whether or not the game is busy, and the history a player
              brings with them when they finally do join is imported from this
              browser either way (see backfillHistory), so nothing is lost by
              their not having come earlier. "See the leaderboard" under a
              finished puzzle stays available throughout for anyone curious. */}
          {leaderboardOpen && (
            <button
              type="button"
              className="app__icon-button app__icon-button--badged"
              onClick={() => openLeaderboard("header")}
              aria-label={leaderboardIsNew ? "Leaderboard (new)" : "Leaderboard"}
              title="Leaderboard"
            >
              <span aria-hidden="true">🏆</span>
              {/* aria-hidden because the button's own label already carries the
                  "(new)" -- a screen reader should hear one thing, not two. */}
              {leaderboardIsNew && (
                <span className="app__icon-badge" aria-hidden="true">
                  new
                </span>
              )}
            </button>
          )}
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
        <DropDisplay drop={drop} date={date} isToday={isToday} completed={progress.completed} />
        <GuessLog
          acceptedWords={progress.acceptedWords}
          completed={progress.completed}
          streak={streak}
          date={date}
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
            totalRarity={totalRarityScore(progress.acceptedWords, date)}
            topRarity={topRarityScore(progress.acceptedWords, date)}
            date={date}
          />
        )}

        {progress.completed && (
          <ResultsPanel
            date={date}
            drop={drop}
            words={progress.acceptedWords}
            streak={streak}
            onLeaderboard={() => openLeaderboard("results")}
          />
        )}
      </main>

      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
      <WordRulesModal open={showWordRules} onClose={() => setShowWordRules(false)} />
    </div>
  );
}
