import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { DropDisplay } from "./components/DropDisplay";
import { GuessLog } from "./components/GuessLog";
import { DEV_TOOLS } from "./dev/devTools";
import { SubmitForm } from "./components/SubmitForm";
import { FeedbackRegion } from "./components/FeedbackRegion";
import { StreakDisplay } from "./components/StreakDisplay";
import { ResultsPanel } from "./components/ResultsPanel";
import { WordRulesModal } from "./components/WordRulesModal";
import { PuzzleNav } from "./components/PuzzleNav";
import { FoldedLiveNotice } from "./components/FoldedLiveNotice";
import { ConfettiBurst } from "./components/ConfettiBurst";
import { JackpotStamp } from "./components/JackpotStamp";
import { PerfectMonthCelebration } from "./components/PerfectMonthCelebration";
import { ImprovementCelebration } from "./components/ImprovementCelebration";
import { StreakClimbCelebration } from "./components/StreakClimbCelebration";
import { NewBestCelebration } from "./components/NewBestCelebration";
import { QuickShareButton } from "./components/QuickShareButton";
import { YesterdaysBest } from "./components/YesterdaysBest";
import { ComeBackCard } from "./components/ComeBackCard";
import { BestWordNewsCard } from "./components/BestWordNewsCard";
import { WelcomeBackCard } from "./components/WelcomeBackCard";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { useWordOfDay } from "./hooks/useWordOfDay";
import { useYesterdaysBest, type ResolvedBest } from "./hooks/useYesterdaysBest";
import { useForceUpdate } from "./hooks/useForceUpdate";
import { isWinningRarity } from "./game/rank";
import { celebrationFor } from "./game/celebration";
import type { Rarity } from "./game/types";
import { completedWholeMonth } from "./game/perfectMonth";
import { welcomeBack } from "./game/streakFreeze";
import { beatBestToday } from "./game/newBest";
import { claimHeaderCelebration, type HeaderCelebrationGroup } from "./game/headerCelebrations";
import { assignHeaderCelebrationsArm, forcedHeaderCelebrationsVariant } from "./game/headerCelebrationsTest";
import { dismissWelcomeBack, welcomeBackDismissedOn } from "./game/storage";
import {
  averageImprovement,
  improvementCelebrationDue,
  markImprovementCelebrated,
  type Improvement,
} from "./game/improvement";
import { checkStreakClimb, type StreakClimb } from "./game/streakClimb";
import { totalRarityScore } from "./game/dictionary";
import { addDays } from "./game/date";
import { loadPlayerId } from "./game/player";
import {
  bestWordNewsFor,
  bestWordNewsShown,
  daysPlayed,
  markBestWordNewsShown,
  type BestWordNewsKind,
} from "./game/bestWordNews";
import {
  campaignSourceFromSearch,
  isReporting,
  trackHeaderCelebrationsAssigned,
  trackRedditArrival,
  trackShareArrival,
  trackTwitterArrival,
  trackSessionTime,
  trackVisit,
  watchFirstInteraction,
} from "./analytics";
import { recordVisit } from "./game/visits";
import { sharedModeFromSearch } from "./game/onboarding";
import {
  beginSession,
  endSessionSegment,
  resumeSession,
} from "./game/sessionTime";

/**
 * How long after a finish the streak board is read: long enough for the
 * finishing word's write to land (see game/leaderboard.ts, submitScore).
 */
const STREAK_CHECK_DELAY_MS = 1500;

/**
 * Whether a header celebration due now may show: its group has not had its
 * card today (see game/headerCelebrations.ts), and the player is in the arm of
 * the test that sees them (see game/headerCelebrationsTest.ts). The arm is
 * drawn here, the first time a card is due. A host that reports nothing has
 * nobody to measure a draw, so it always shows the cards and never draws.
 */
function showHeaderCelebration(group: HeaderCelebrationGroup, date: string): boolean {
  if (!claimHeaderCelebration(group, date)) return false;
  const forced = forcedHeaderCelebrationsVariant();
  if (forced || !isReporting()) return forced !== "hidden";
  const drawn = assignHeaderCelebrationsArm();
  if (!drawn) return true;
  if (drawn.fresh) trackHeaderCelebrationsAssigned(drawn.variant, date);
  return drawn.variant === "shown";
}

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
    wordDataLoading,
    submitWord,
    canRetry,
    retryOffered,
    retrySpent,
    retryAnswer,
    otherMode,
    crossMode,
    copying,
    copyToOtherMode,
    revealAnswer,
    resetAnswers,
    mode,
    modeChosen,
    foldNotices,
    dismissFoldNotices,
  } = useDailyPuzzle();
  // Which of the two games this is, when the switch decides it at all. Carried
  // as a class on the column, so the cards and the input wear the mode as the
  // header's switch does (see index.css).
  const playMode = modeChosen ? mode : undefined;
  const [showWordRules, setShowWordRules] = useState(false);
  // The celebration for the word just accepted, keyed by its feedback so two
  // good words in a row each get their own burst rather than sharing one.
  const [burst, setBurst] = useState<{ key: number; grand: boolean; rarity: Rarity } | null>(
    null,
  );
  const [showPerfectMonth, setShowPerfectMonth] = useState(false);
  const endPerfectMonth = useCallback(() => setShowPerfectMonth(false), []);
  const [newBest, setNewBest] = useState<{ days: number; best: number } | null>(null);
  const endNewBest = useCallback(() => setNewBest(null), []);
  const [improvement, setImprovement] = useState<Improvement | null>(null);
  const endImprovement = useCallback(() => setImprovement(null), []);
  const [climb, setClimb] = useState<StreakClimb | null>(null);
  const endClimb = useCallback(() => setClimb(null), []);
  const sound = useSound();
  // Half of players never see the word of the day; the draw is the first
  // finished puzzle, where it would first appear (see game/wordOfDay.ts).
  const wordOfDayShown = useWordOfDay(progress.completed, date);
  // The share panel stays out of the way until the Share beside the guess
  // count is pressed, which opens it and scrolls to it. Each press bumps the
  // count, so a second press scrolls back to it again. A new puzzle starts
  // closed.
  const [shareRequests, setShareRequests] = useState(0);
  useEffect(() => setShareRequests(0), [date]);
  // A player back after their streak ended (see game/streakFreeze.ts), greeted
  // on today's puzzle until its first word or until the card is closed --
  // closed for that day, so a reload does not bring it back.
  const [welcomeDismissedOn, setWelcomeDismissedOn] = useState(welcomeBackDismissedOn);
  const welcome =
    isToday && progress.acceptedWords.length === 0 && welcomeDismissedOn !== date
      ? welcomeBack(streak, date)
      : null;
  const closeWelcome = () => {
    dismissWelcomeBack(date);
    setWelcomeDismissedOn(date);
  };

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
    // And whether the visit goes on to press anything at all, once per session.
    return watchFirstInteraction();
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

  // Play a chime/buzz on every submission, pitched by rarity when accepted --
  // and celebrate every Rare-or-better word, louder the rarer it is (see
  // game/celebration.ts). Only a fresh verdict does this, never a puzzle
  // restored from storage.
  useEffect(() => {
    if (!feedback) return;
    if (feedback.kind === "accepted" && feedback.rarity) {
      sound.accept(feedback.rarity);
      const celebration = celebrationFor(feedback.rarity);
      if (celebration === "grand") sound.jackpot();
      if (celebration !== "none") {
        setBurst({ key: feedback.key, grand: celebration === "grand", rarity: feedback.rarity });
      }
    } else if (feedback.kind === "rejected") {
      sound.reject();
    }
    // sound.accept/reject are stable; only new feedback events should
    // trigger playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  // Each burst clears itself once its pieces have fallen.
  useEffect(() => {
    if (!burst) return;
    const timeout = window.setTimeout(() => setBurst(null), burst.grand ? 2800 : 1800);
    return () => window.clearTimeout(timeout);
  }, [burst]);

  const hasWinningWord = progress.acceptedWords.some((word) =>
    isWinningRarity(word.rarity),
  );
  // The completion chime, for the day's first qualifying word only -- never a
  // puzzle restored from storage that already contains one. The confetti now
  // comes with every good word (above), but this chime stays a once-a-day
  // milestone. A first winning word that is already a jackpot has its own
  // fanfare instead.
  const hadWinningWord = useRef(hasWinningWord);
  useEffect(() => {
    const jackpot = progress.acceptedWords.some((word) => celebrationFor(word.rarity) === "grand");
    if (hasWinningWord && !hadWinningWord.current && !jackpot) sound.complete();
    hadWinningWord.current = hasWinningWord;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWinningWord]);

  // A month played without a day missed (see game/perfectMonth.ts), celebrated
  // on the word that finishes it. Remembered by date rather than as a flag, so
  // stepping back through the archive and forward to today again does not
  // throw a second party -- and a reload after the fact, which mounts already
  // perfect, throws none. One of the news header celebrations (see
  // game/headerCelebrations.ts): yesterday's best word, shown as the site
  // opened, keeps it away.
  const perfectMonth = isToday && completedWholeMonth(streak, date);
  const celebratedMonth = useRef(perfectMonth ? date : null);
  useEffect(() => {
    if (!perfectMonth || celebratedMonth.current === date) return;
    celebratedMonth.current = date;
    if (!showHeaderCelebration("news", date)) return;
    // The month banks on the day's first word, so the only chime it could
    // clash with is that same word being Rare -- which has just played one.
    if (!hasWinningWord) sound.complete();
    setShowPerfectMonth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfectMonth, date]);

  // The streak going past the player's longest before it (see game/newBest.ts),
  // celebrated on the submission that takes it there. Only that one day of the
  // streak passes it, and remembered by date as the perfect month is, so a
  // reload that day, which mounts already past it, throws no second party.
  // It leads the streak header celebrations, so it keeps the day's climb away.
  const beatBest = isToday ? beatBestToday(streak, date) : null;
  const celebratedBest = useRef(beatBest !== null ? date : null);
  useEffect(() => {
    if (beatBest === null || celebratedBest.current === date) return;
    celebratedBest.current = date;
    if (!showHeaderCelebration("streak", date)) return;
    setNewBest({ days: streak.currentStreak, best: beatBest });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatBest, date]);
  // Its chime when the card actually shows, which is after a perfect month's.
  const newBestShown = !showPerfectMonth && newBest !== null;
  useEffect(() => {
    if (newBestShown) sound.rising();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newBestShown]);

  // The player's average on the way up (see game/improvement.ts), celebrated
  // when today's puzzle is finished -- the day's total is final then, so it is
  // the first moment the average it joins means anything. Only on the finish
  // itself, as the Rare burst above is only on the word: a puzzle that mounts
  // already finished, by reload or by stepping back from the archive, throws
  // none. The record of the last celebration keeps it to one a week, and it
  // shows only if no other news header celebration had today.
  const finishedToday = isToday && progress.completed;
  const wasFinished = useRef({ date, finished: finishedToday });
  useEffect(() => {
    const before = wasFinished.current;
    wasFinished.current = { date, finished: finishedToday };
    if (!finishedToday || before.date !== date || before.finished) return;
    const rise = improvementCelebrationDue(date) && averageImprovement(date, progress.mode);
    if (rise && showHeaderCelebration("news", date)) {
      markImprovementCelebrated(date);
      sound.rising();
      setImprovement(rise);
    }
    // And a climb up the streak board (see game/streakClimb.ts), read from the
    // server after a moment so the finishing word's write has landed. It waits
    // its turn behind the cards above, as they wait behind each other, and
    // gives way to a longest streak yet, the other streak header celebration.
    let cancelled = false;
    const check = window.setTimeout(() => {
      void checkStreakClimb(date).then((found) => {
        if (found && !cancelled && showHeaderCelebration("streak", date)) setClimb(found);
      });
    }, STREAK_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedToday, date]);
  // Its chime when the card actually shows, which is after any card ahead of it.
  const climbShown = !showPerfectMonth && !newBest && !improvement && climb !== null;
  useEffect(() => {
    if (climbShown) sound.rising();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climbShown]);

  // Yesterday's best word, announced as the site opens (see
  // game/bestWordNews.ts): its finder is celebrated, and a player with a few
  // days behind them is told who found it -- but only when nothing else is
  // up, since it is somebody else's news. Decided once per mount, on the
  // answer's arrival, and once a day for good. It leads the news header
  // celebrations, so it keeps the day's perfect month and rising average away.
  const yesterdaysBest = useYesterdaysBest(isToday ? addDays(date, -1) : undefined);
  const [bestNews, setBestNews] = useState<{
    kind: BestWordNewsKind;
    resolved: ResolvedBest;
  } | null>(null);
  const endBestNews = useCallback(() => setBestNews(null), []);
  const bestNewsDecided = useRef(false);
  useEffect(() => {
    if (!yesterdaysBest || bestNewsDecided.current) return;
    bestNewsDecided.current = true;
    if (bestWordNewsShown(yesterdaysBest.day)) return;
    const kind = bestWordNewsFor(yesterdaysBest.finderIds, loadPlayerId(), daysPlayed());
    if (!kind) return;
    const busy = showPerfectMonth || improvement || climb || burst || welcome;
    if (kind === "other" && busy) return;
    if (!showHeaderCelebration("news", date)) return;
    markBestWordNewsShown(yesterdaysBest.day);
    setBestNews({ kind, resolved: yesterdaysBest });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided on arrival only
  }, [yesterdaysBest]);

  const guessEntry = (
    <>
      {!progress.completed && (
        <SubmitForm
          drop={drop}
          disabled={progress.completed}
          feedback={feedback}
          checking={checking}
          loading={wordDataLoading}
          onSubmit={submitWord}
          date={date}
          mode={playMode}
          acceptedWords={progress.acceptedWords}
          submitLabel="Play"
        />
      )}
      <FeedbackRegion
        feedback={feedback}
        note={liveNote}
        reserveSpace={!progress.completed}
        onWordRules={() => setShowWordRules(true)}
        settledNote={false}
        visibleMs={feedback?.kind === "accepted" ? 4000 : 8000}
      />
    </>
  );

  return (
    <>
      {showPerfectMonth ? (
        <PerfectMonthCelebration
          date={date}
          days={Number(date.slice(8, 10))}
          onDone={endPerfectMonth}
        />
      ) : newBest ? (
        // After the perfect month's card too, as both bank on the day's first
        // submission.
        <NewBestCelebration days={newBest.days} best={newBest.best} onDone={endNewBest} />
      ) : improvement ? (
        // After the perfect month's card, if both land on one finish.
        <ImprovementCelebration improvement={improvement} onDone={endImprovement} />
      ) : climb ? (
        <StreakClimbCelebration climb={climb} onDone={endClimb} />
      ) : bestNews ? (
        <BestWordNewsCard
          kind={bestNews.kind}
          resolved={bestNews.resolved}
          onDone={endBestNews}
        />
      ) : (
        burst && (
          <Fragment key={burst.key}>
            <ConfettiBurst grand={burst.grand} />
            {burst.grand && <JackpotStamp rarity={burst.rarity} date={date} />}
          </Fragment>
        )
      )}

      <main className={playMode ? `play play--${playMode}` : undefined}>
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
        >
          {/* Between the arrows, in place of the puzzle number and date: the
              drop's own label already names the day it belongs to. */}
          <DropDisplay
            drop={drop}
            date={date}
            isToday={isToday}
            completed={progress.completed}
            retryOffered={retryOffered}
            onReveal={revealAnswer}
            wordOfDay={wordOfDayShown}
          />
        </PuzzleNav>
        {/* Over the words it is about: a fold rejected live on this puzzle
            moved one of them (see game/liveFoldRescore.ts). */}
        <FoldedLiveNotice
          date={date}
          notices={foldNotices}
          onDismiss={dismissFoldNotices}
        />
        {/* The input sits straight under the drop, so it stays where it is
            as words land below it rather than being pushed down the page by
            each one. */}
        {welcome && (
          <WelcomeBackCard
            welcome={welcome}
            onDismiss={closeWelcome}
          />
        )}
        {guessEntry}
        <GuessLog
          acceptedWords={progress.acceptedWords}
          completed={progress.completed}
          streak={streak}
          date={date}
          canRetry={canRetry}
          retryOffered={retryOffered}
          retrySpent={retrySpent}
          onRetry={retryAnswer}
          otherMode={otherMode}
          crossMode={crossMode}
          copying={copying}
          onCopyToOtherMode={copyToOtherMode}
          newUi
          headerAction={
            progress.acceptedWords.length > 0 ? (
              <QuickShareButton
                date={date}
                drop={drop}
                words={progress.acceptedWords}
                streak={streak}
                isToday={isToday}
                mode={progress.mode}
                onShared={() => setShareRequests((n) => n + 1)}
              />
            ) : undefined
          }
        />

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
            date={date}
            isToday={isToday}
            hideEmpty
            hasWords={progress.acceptedWords.length > 0}
          />
        )}

        {/* Once today's word is banked -- which is when the streak counts the
            day, whether or not the puzzle is locked in -- say what coming
            back tomorrow is worth (see game/comeBack.ts). Straight under the
            streak it talks about (in the guess log on a finished puzzle), so
            the two read as one block rather than a second card restating it.
            Below the guesses, so it never sits between a player and the
            guesses they have left. */}
        {isToday && progress.acceptedWords.length > 0 && <ComeBackCard streak={streak} date={date} />}

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
        {/* Only once asked for by the Share beside the guess count, which
            stays on a finished puzzle too. */}
        {progress.acceptedWords.length > 0 && shareRequests > 0 && (
          <ResultsPanel
            date={date}
            drop={drop}
            words={progress.acceptedWords}
            streak={streak}
            isToday={isToday}
            mode={progress.mode}
            collapsible
            scrollSignal={shareRequests}
          />
        )}

        {/* Last on the page, as a footnote: it is about other players'
            yesterday, so it stays out from between the player's guesses and
            their own streak and total. Under the guesses rather than under the
            drop: it arrives with a request, and anything landing above the
            input would push the input down the page as it did. On every
            puzzle, archived ones too: it reports the day before the one being
            played, by its date when that isn't yesterday. */}
        <YesterdaysBest date={date} isToday={isToday} />
      </main>

      {/* Dev only, and pinned beside the dev date bar rather than in the
          column, so a dev screenshot of the board matches production. */}
      {DEV_TOOLS && (
        <button
          type="button"
          className="dev-reset-button"
          onClick={resetAnswers}
        >
          Reset answers
        </button>
      )}

      <WordRulesModal
        open={showWordRules}
        date={date}
        onClose={() => setShowWordRules(false)}
      />
    </>
  );
}
