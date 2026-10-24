import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { topRarityScore, totalRarityScore } from '../../../src/game/dictionary';
import { isWinningRarity } from '../../../src/game/rank';
import { beginSession, endSessionSegment, resumeSession } from '../../../src/game/sessionTime';
import { useDailyPuzzle } from '../../../src/hooks/useDailyPuzzle';
import { ConfettiBurst } from '../components/ConfettiBurst';
import { DropDisplay } from '../components/DropDisplay';
import { FeedbackRegion } from '../components/FeedbackRegion';
import { GuessLog } from '../components/GuessLog';
import { PuzzleNav } from '../components/PuzzleNav';
import { ResultsPanel } from '../components/ResultsPanel';
import { StreakDisplay } from '../components/StreakDisplay';
import { SubmitForm } from '../components/SubmitForm';
import { WordRulesSheet } from '../components/WordRulesSheet';
import { signalAccept, signalCelebrate, signalReject } from '../host/feedback';
import { useAppState } from '../hooks/useAppState';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  onLeaderboard: () => void;
}

/**
 * The puzzle.
 *
 * Everything about how the game *works* comes from `useDailyPuzzle`, which is
 * the website's own hook, imported rather than reimplemented -- the drop, the
 * validation, the live lookup, the retry, the scoring, the archive navigation
 * and the leaderboard write are all decided there. This file is the arrangement
 * of it on a phone and nothing else, which is the only way the two front-ends
 * can be guaranteed to play the same game.
 */
export function PlayScreen({ onLeaderboard }: Props) {
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

  const [showWordRules, setShowWordRules] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  /*
   * The session clock.
   *
   * The website hangs this off `visibilitychange` and `pagehide`; the app's
   * equivalent is AppState, and the mapping is exact -- backgrounding is the
   * hide, foregrounding is the return. There is no reliable "closed" moment on
   * either platform, so every background is treated as a possible end and
   * reported, and coming back resumes the same session rather than starting a
   * new one.
   *
   * Nothing leaves the device: reporting is off in this build (see
   * src/host/install.ts), so the clock runs and its report goes nowhere. It is
   * kept running anyway because the shared hook marks it on every guess, and a
   * clock that is started but never ended is the kind of half-state that comes
   * back as a bug later.
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

  // Answer every submission in the channel a phone has. See src/host/feedback.ts
  // for why this is haptics rather than the website's synthesised chime.
  const lastFeedbackKey = useRef<number | null>(null);
  useEffect(() => {
    if (!feedback || feedback.key === lastFeedbackKey.current) return;
    lastFeedbackKey.current = feedback.key;
    if (feedback.kind === 'accepted' && feedback.rarity) signalAccept(feedback.rarity);
    else if (feedback.kind === 'rejected') signalReject();
  }, [feedback]);

  // Celebrate the first qualifying word only -- never a puzzle restored from
  // storage that already contains one.
  const hasWinningWord = progress.acceptedWords.some((word) => isWinningRarity(word.rarity));
  const hadWinningWord = useRef(hasWinningWord);
  useEffect(() => {
    if (hasWinningWord && !hadWinningWord.current) {
      hadWinningWord.current = true;
      signalCelebrate();
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 1800);
      return () => clearTimeout(timer);
    }
    hadWinningWord.current = hasWinningWord;
  }, [hasWinningWord]);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // iOS lifts the whole view; Android's window already resizes for the
      // keyboard, and doing both leaves the input floating above a gap.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
      >
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
            loading={wordDataLoading}
            onSubmit={(word) => void submitWord(word)}
          />
        )}

        <FeedbackRegion
          feedback={feedback}
          note={liveNote}
          onWordRules={() => setShowWordRules(true)}
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
            topRarity={topRarityScore(progress.acceptedWords, date)}
            date={date}
          />
        )}

        {progress.acceptedWords.length > 0 && (
          <ResultsPanel
            date={date}
            drop={drop}
            words={progress.acceptedWords}
            streak={streak}
            isToday={isToday}
            onLeaderboard={onLeaderboard}
          />
        )}
      </ScrollView>

      {/* Over the scroll view rather than inside it, so the pieces fall across
          the whole screen instead of down a scrolling column. */}
      {showConfetti && <ConfettiBurst />}

      <WordRulesSheet open={showWordRules} onClose={() => setShowWordRules(false)} />
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
    gap: space.lg,
  },
  archiveNote: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
