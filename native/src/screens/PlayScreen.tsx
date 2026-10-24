import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { totalRarityScore } from '../../../src/game/dictionary';
import { isWinningRarity } from '../../../src/game/rank';
import { celebrationFor } from '../../../src/game/celebration';
import { completedWholeMonth } from '../../../src/game/perfectMonth';
import { welcomeBack } from '../../../src/game/streakFreeze';
import { dismissWelcomeBack, welcomeBackDismissedOn } from '../../../src/game/storage';
import {
  averageImprovement,
  improvementCelebrationDue,
  markImprovementCelebrated,
  type Improvement,
} from '../../../src/game/improvement';
import { checkStreakClimb, type StreakClimb } from '../../../src/game/streakClimb';
import type { Rarity } from '../../../src/game/types';
import { beginSession, endSessionSegment, resumeSession } from '../../../src/game/sessionTime';
import { useDailyPuzzle } from '../../../src/hooks/useDailyPuzzle';
import { ComeBackCard } from '../components/ComeBackCard';
import { ConfettiBurst, CONFETTI_MS, GRAND_CONFETTI_MS } from '../components/ConfettiBurst';
import { DropDisplay } from '../components/DropDisplay';
import { FeedbackRegion } from '../components/FeedbackRegion';
import { GuessLog } from '../components/GuessLog';
import { ImprovementCelebration } from '../components/ImprovementCelebration';
import { JackpotStamp } from '../components/JackpotStamp';
import { PerfectMonthCelebration } from '../components/PerfectMonthCelebration';
import { PuzzleNav } from '../components/PuzzleNav';
import { QuickShareButton } from '../components/QuickShareButton';
import { ResultsPanel } from '../components/ResultsPanel';
import { StreakClimbCelebration } from '../components/StreakClimbCelebration';
import { StreakDisplay } from '../components/StreakDisplay';
import { SubmitForm } from '../components/SubmitForm';
import { WelcomeBackCard } from '../components/WelcomeBackCard';
import { WordRulesSheet } from '../components/WordRulesSheet';
import { YesterdaysBest } from '../components/YesterdaysBest';
import {
  signalAccept,
  signalCelebrate,
  signalJackpot,
  signalReject,
  signalRising,
} from '../host/feedback';
import { useAppState } from '../hooks/useAppState';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  /** Whether a sheet over the whole app (How to play) is up, which pauses the idle hint. */
  covered?: boolean;
}

/**
 * How long after a finish the streak board is read: long enough for the
 * finishing word's write to land. The website's figure (src/App.tsx).
 */
const STREAK_CHECK_DELAY_MS = 1500;

/**
 * The puzzle.
 *
 * Everything about how the game *works* comes from `useDailyPuzzle`, which is
 * the website's own hook, imported rather than reimplemented -- the drop, the
 * validation, the live lookup, the retry, the scoring, the archive navigation
 * and the leaderboard write are all decided there. This file is the arrangement
 * of it on a phone and nothing else, and the arrangement is the website's v2
 * play screen (src/App.tsx), in the same order: the drop between the arrows,
 * the input under it, the guesses, the streak, tomorrow's goal, the share panel
 * on request, and yesterday's best as a footnote.
 */
export function PlayScreen({ covered = false }: Props) {
  const theme = useTheme();
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
    revealAnswer,
  } = useDailyPuzzle();

  const scrollRef = useRef<ScrollView>(null);
  const [showWordRules, setShowWordRules] = useState(false);
  // The celebration for the word just accepted, keyed by its feedback so two
  // good words in a row each get their own burst rather than sharing one.
  const [burst, setBurst] = useState<{ key: number; grand: boolean; rarity: Rarity } | null>(null);
  const [showPerfectMonth, setShowPerfectMonth] = useState(false);
  const endPerfectMonth = useCallback(() => setShowPerfectMonth(false), []);
  const [improvement, setImprovement] = useState<Improvement | null>(null);
  const endImprovement = useCallback(() => setImprovement(null), []);
  const [climb, setClimb] = useState<StreakClimb | null>(null);
  const endClimb = useCallback(() => setClimb(null), []);

  // The share panel stays out of the way until the Share beside the guess
  // count is pressed; each press bumps the count so a second press scrolls back
  // to it. A new puzzle starts closed.
  const [shareAsked, setShareAsked] = useState({ date, count: 0 });
  const shareRequests = shareAsked.date === date ? shareAsked.count : 0;

  // A player back after their streak ended, greeted on today's puzzle until
  // its first word or until the card is closed -- closed for that day.
  const [welcomeDismissedOn, setWelcomeDismissedOn] = useState(welcomeBackDismissedOn);
  const welcome =
    isToday && progress.acceptedWords.length === 0 && welcomeDismissedOn !== date
      ? welcomeBack(streak, date)
      : null;
  const closeWelcome = () => {
    dismissWelcomeBack(date);
    setWelcomeDismissedOn(date);
  };

  /*
   * The session clock.
   *
   * The website hangs this off `visibilitychange` and `pagehide`; the app's
   * equivalent is AppState. Nothing leaves the device -- reporting is off in
   * this build (see src/host/install.ts) -- but the shared hook marks the clock
   * on every guess, so it is kept running rather than left half-started.
   */
  useAppState({
    onForeground: resumeSession,
    onBackground: () => {
      endSessionSegment();
    },
  });

  useEffect(() => {
    beginSession();
  }, []);

  // Answer every submission in the channel a phone has, and celebrate every
  // Rare-or-better word, louder the rarer it is (see src/game/celebration.ts).
  // Only a fresh verdict does this, never a puzzle restored from storage.
  const lastFeedbackKey = useRef<number | null>(null);
  useEffect(() => {
    if (!feedback || feedback.key === lastFeedbackKey.current) return;
    lastFeedbackKey.current = feedback.key;
    if (feedback.kind === 'accepted' && feedback.rarity) {
      signalAccept(feedback.rarity);
      const celebration = celebrationFor(feedback.rarity);
      if (celebration === 'grand') signalJackpot();
      if (celebration !== 'none') {
        // A response to the verdict arriving, which is the event itself.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBurst({ key: feedback.key, grand: celebration === 'grand', rarity: feedback.rarity });
      }
    } else if (feedback.kind === 'rejected') {
      signalReject();
    }
  }, [feedback]);

  // Each burst clears itself once its pieces have fallen.
  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(null), burst.grand ? GRAND_CONFETTI_MS : CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [burst]);

  // The completion signal, for the day's first qualifying word only. A first
  // winning word that is already a jackpot has had its own.
  const hasWinningWord = progress.acceptedWords.some((word) => isWinningRarity(word.rarity));
  const hadWinningWord = useRef(hasWinningWord);
  useEffect(() => {
    const jackpot = progress.acceptedWords.some((word) => celebrationFor(word.rarity) === 'grand');
    if (hasWinningWord && !hadWinningWord.current && !jackpot) signalCelebrate();
    hadWinningWord.current = hasWinningWord;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWinningWord]);

  // A month played without a day missed, celebrated on the word that finishes
  // it -- remembered by date, so neither the archive nor a reload throws a
  // second party.
  const perfectMonth = isToday && completedWholeMonth(streak, date);
  const celebratedMonth = useRef(perfectMonth ? date : null);
  useEffect(() => {
    if (!perfectMonth || celebratedMonth.current === date) return;
    celebratedMonth.current = date;
    if (!hasWinningWord) signalCelebrate();
    setShowPerfectMonth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfectMonth, date]);

  // The player's average on the way up, and a climb up the streak board, both
  // read when today's puzzle is finished -- on the finish itself, never on a
  // puzzle that mounts already finished.
  const finishedToday = isToday && progress.completed;
  const wasFinished = useRef({ date, finished: finishedToday });
  useEffect(() => {
    const before = wasFinished.current;
    wasFinished.current = { date, finished: finishedToday };
    if (!finishedToday || before.date !== date || before.finished) return;
    const rise = improvementCelebrationDue(date) && averageImprovement(date, progress.mode);
    if (rise) {
      markImprovementCelebrated(date);
      signalRising();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the finish is the event
      setImprovement(rise);
    }
    let cancelled = false;
    const check = setTimeout(() => {
      void checkStreakClimb(date).then((found) => {
        if (found && !cancelled) setClimb(found);
      });
    }, STREAK_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedToday, date]);
  // Its signal when the card actually shows, which is after any card ahead of it.
  const climbShown = !showPerfectMonth && !improvement && climb !== null;
  useEffect(() => {
    if (climbShown) signalRising();
  }, [climbShown]);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // iOS lifts the whole view; Android's window already resizes for the
      // keyboard, and doing both leaves the input floating above a gap.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
      >
        {/* The drop between the arrows: the drop's own label already names
            the day it belongs to. */}
        <PuzzleNav
          date={date}
          puzzleNumber={puzzleNumber}
          canGoToPrevious={canGoToPrevious}
          canGoToNext={canGoToNext}
          onPrevious={goToPrevious}
          onNext={goToNext}
        >
          <DropDisplay
            drop={drop}
            date={date}
            isToday={isToday}
            completed={progress.completed}
            retryOffered={retryOffered}
            onReveal={revealAnswer}
            wordOfDay
          />
        </PuzzleNav>

        {welcome && <WelcomeBackCard welcome={welcome} onDismiss={closeWelcome} />}

        {/* The input straight under the drop, so it stays put as words land
            below it. */}
        {!progress.completed && (
          <SubmitForm
            drop={drop}
            disabled={progress.completed}
            feedback={feedback}
            checking={checking}
            loading={wordDataLoading}
            onSubmit={submitWord}
            date={date}
            acceptedWords={progress.acceptedWords}
            submitLabel="Play"
            covered={covered || showWordRules}
          />
        )}

        <FeedbackRegion
          feedback={feedback}
          note={liveNote}
          reserveSpace={!progress.completed}
          onWordRules={() => setShowWordRules(true)}
          settledNote={false}
          visibleMs={feedback?.kind === 'accepted' ? 4000 : 8000}
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
          headerAction={
            progress.acceptedWords.length > 0 ? (
              <QuickShareButton
                date={date}
                drop={drop}
                words={progress.acceptedWords}
                streak={streak}
                isToday={isToday}
                mode={progress.mode}
                onShared={() => setShareAsked({ date, count: shareRequests + 1 })}
              />
            ) : undefined
          }
        />

        {!progress.completed && !isToday && (
          <Text style={[styles.archiveNote, { color: theme.fgMuted }]}>
            You're playing an old puzzle — this is just for fun and won't affect your streak.
          </Text>
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

        {/* What coming back tomorrow is worth, once today's word is banked. */}
        {isToday && progress.acceptedWords.length > 0 && <ComeBackCard streak={streak} date={date} />}

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
            onScrollTo={(y) => scrollRef.current?.scrollTo({ y, animated: true })}
          />
        )}

        {/* Last, as a footnote: it is about other players' yesterday. */}
        <YesterdaysBest date={date} isToday={isToday} />
      </ScrollView>

      {/* Over the scroll view rather than inside it, so the pieces fall across
          the whole screen. One at a time, in the website's order. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {showPerfectMonth ? (
          <PerfectMonthCelebration date={date} days={Number(date.slice(8, 10))} onDone={endPerfectMonth} />
        ) : improvement ? (
          <ImprovementCelebration improvement={improvement} onDone={endImprovement} />
        ) : climb ? (
          <StreakClimbCelebration climb={climb} onDone={endClimb} />
        ) : (
          burst && (
            <Fragment key={burst.key}>
              <ConfettiBurst grand={burst.grand} />
              {burst.grand && <JackpotStamp rarity={burst.rarity} date={date} />}
            </Fragment>
          )
        )}
      </View>

      <WordRulesSheet open={showWordRules} date={date} onClose={() => setShowWordRules(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    padding: space.lg,
    paddingBottom: space.xxl * 2,
  },
  archiveNote: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: space.lg,
  },
});
