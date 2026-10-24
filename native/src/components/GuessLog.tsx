import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { maxGuessesFor } from '../../../src/game/constants';
import {
  baseFormSubstitution,
  formatRarityScore,
  topRarityScore,
  totalRarityScore,
} from '../../../src/game/dictionary';
import { bestWord } from '../../../src/game/rank';
import { raritySymbol } from '../../../src/game/share';
import type { AcceptedWord, StreakState } from '../../../src/game/types';
import { signalTap } from '../host/feedback';
import { copyText } from '../host/share';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useWordDataLoaded } from '../../../src/hooks/useWordDataLoaded';
import { CommonFormSheet } from './CommonFormSheet';
import { RarityBadge } from './RarityBadge';
import { StreakDisplay } from './StreakDisplay';

/**
 * The clipboard form of a logged word: "<tier square> <word> (<score>)".
 * Borrows the share palette so a pasted word matches the shared result.
 */
function copyTextForWord(word: AcceptedWord, date?: string): string {
  const score = word.zipf !== undefined ? ` (${formatRarityScore(word.zipf, date)})` : '';
  return `${raritySymbol(word.rarity, date)} ${word.word}${score}`;
}

interface Props {
  acceptedWords: AcceptedWord[];
  completed?: boolean;
  streak?: StreakState;
  /** The puzzle's date, so scores use the system in effect that day. */
  date?: string;
  /** The retry is unspent and there is a word to spend it on. */
  canRetry?: boolean;
  /** The retry is unspent, whether or not there is yet anything to spend it on. */
  retryOffered?: boolean;
  /** It has been spent, on a puzzle that offered one. */
  retrySpent?: boolean;
  /** Drop a banked word and hand its guess back. */
  onRetry?: (word: string) => void;
}

/** Every word banked today, rarest one crowned. */
export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
  canRetry = false,
  retryOffered = false,
  retrySpent = false,
  onRetry,
}: Props) {
  const theme = useTheme();
  const best = bestWord(acceptedWords);
  const maxGuesses = maxGuessesFor(date);
  // The common-form notes below are worked out from the deferred scoring data,
  // so they wait for it rather than name a base the reviewed folds overrule.
  const wordDataLoaded = useWordDataLoaded(date);

  const [copiedWord, setCopiedWord] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Armed by the retry button, and spent by tapping a word.
   *
   * Two taps rather than a retry control on every row, exactly as on the
   * website: the log is four cards on a phone, already carrying a crown, a copy
   * affordance and a badge, and a fourth control per row would crowd the one
   * thing a card exists to show.
   *
   * Derived rather than cleared by hand -- spending the retry flips `canRetry`,
   * and so does the day rolling over under an app left open overnight.
   */
  const [arming, setArming] = useState(false);
  const picking = arming && canRetry;

  /*
   * The word whose common-form note has its sheet open, or undefined. The word
   * rather than a boolean: the sheet leads with the pair it was opened from,
   * and a log can be carrying several notes at once.
   */
  const [explaining, setExplaining] = useState<{ word: string; base: string } | undefined>(
    undefined
  );

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  function copyWord(word: AcceptedWord) {
    void copyText(copyTextForWord(word, date));
    signalTap();
    setCopiedWord(word.word);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopiedWord((current) => (current === word.word ? null : current));
    }, 1500);
  }

  return (
    <View style={styles.section} accessibilityLabel="Your guesses">
      {!completed && (
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.fg }]} accessibilityRole="header">
            Guess log
          </Text>
          <Text style={[styles.count, { color: theme.fgMuted }]}>
            {acceptedWords.length} of {maxGuesses} guesses
          </Text>
        </View>
      )}

      {acceptedWords.length === 0 ? (
        <Text style={[styles.empty, { color: theme.fgMuted }]}>
          No words yet — every one you find lands here.
        </Text>
      ) : (
        <View style={styles.list}>
          {acceptedWords.map((word, index) => {
            const isBest = best !== undefined && word.word === best.word;
            const isCopied = copiedWord === word.word;
            /*
             * Shown for every word scored as another form, whatever it cost --
             * the website's rule (src/components/GuessLog.tsx). With two modes
             * one switch apart, the same word reads at two prices, and a
             * Standard score with no note beside it looks like a bug.
             *
             * "Common form", not "base word": the fold takes the most common
             * word in the family, which is often a sibling or a cousin rather
             * than a base -- calling a plural the base word of its own singular
             * reads as the very bug this is meant to explain.
             */
            const baseNote = wordDataLoaded ? baseFormSubstitution(word.word, date) : undefined;

            return (
              <Pressable
                key={word.word}
                onPress={() => {
                  if (picking) {
                    setArming(false);
                    onRetry?.(word.word);
                  } else {
                    copyWord(word);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  picking
                    ? `Retry "${word.word}" (${word.rarity}, guess ${index + 1}) — clear it and try again`
                    : isCopied
                      ? `Copied "${word.word}"`
                      : `Copy "${word.word}" (${word.rarity}${
                          baseNote ? `, scored as its common form "${baseNote.base}"` : ''
                        }, guess ${index + 1})`
                }
                style={({ pressed }) => [
                  styles.entry,
                  {
                    // A gold halo rather than a gold fill, which washed out a
                    // pale gold Elusive badge on it. iOS draws the halo;
                    // Android has no coloured shadow and keeps the border.
                    backgroundColor: theme.cardBg,
                    ...(isBest && {
                      shadowColor: theme.bestWordAccent,
                      shadowOpacity: 0.45,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                    }),
                    borderColor: picking
                      ? theme.focusRing
                      : isBest
                        ? theme.bestWordAccent
                        : theme.border,
                    borderWidth: picking || isBest ? 1.5 : StyleSheet.hairlineWidth,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={styles.entryTop}>
                  {isBest && <Text style={styles.crown}>👑</Text>}
                  <Text style={[styles.word, { color: theme.fg }]} numberOfLines={1}>
                    {word.word}
                  </Text>
                  <View style={styles.spacer} />
                  {picking ? (
                    <Text style={[styles.hint, { color: theme.focusRing }]}>Retry</Text>
                  ) : isCopied ? (
                    <Text style={[styles.hint, { color: theme.successFg }]}>Copied!</Text>
                  ) : (
                    <Text style={[styles.hint, { color: theme.fgFaint }]}>Copy</Text>
                  )}
                </View>

                <RarityBadge rarity={word.rarity} zipf={word.zipf} date={date} />

                {/* Hidden while the retry is armed: the whole card is the
                    thing you tap then, and a live control inside it is a hole
                    in that target. */}
                {baseNote && !picking && (
                  <View style={styles.baseNoteRow}>
                    {/* The sentence is already carried by the row's own label,
                        so it stays out of the reading order -- but the control
                        beside it must not, and it names its word itself. */}
                    <Text
                      style={[styles.baseNote, { color: theme.fgFaint }]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      Scored as its common form, “{baseNote.base}”
                    </Text>
                    <Pressable
                      onPress={() => {
                        signalTap();
                        setExplaining({ word: word.word, base: baseNote.base });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Why “${word.word}” was scored as its common form “${baseNote.base}”`}
                      hitSlop={space.sm}
                      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Text style={[styles.baseNoteInfo, { color: theme.fgMuted }]}>
                        More info
                      </Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Under the log rather than over it: the retry is about the words above
          it, and on a finished puzzle it is the only thing left to do. Shown
          from the moment the puzzle opens -- greyed out -- rather than
          appearing out of nowhere once a first guess lands. */}
      {(retryOffered || retrySpent) && (
        <View style={styles.retry}>
          {picking ? (
            <>
              <Text
                style={[styles.retryPrompt, { color: theme.fg }]}
                accessibilityLiveRegion="polite"
              >
                Select a word to clear and try again.
              </Text>
              <Pressable
                onPress={() => setArming(false)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retryCancel, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.retryCancelText, { color: theme.fgMuted }]}>Never mind</Text>
              </Pressable>
            </>
          ) : retryOffered ? (
            <Pressable
              onPress={() => {
                signalTap();
                setArming(true);
              }}
              disabled={!canRetry}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canRetry }}
              accessibilityHint={canRetry ? undefined : 'Guess a word first'}
              style={({ pressed }) => [
                styles.retryButton,
                {
                  borderColor: canRetry ? theme.borderStrong : theme.border,
                  opacity: !canRetry ? 0.45 : pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.retryButtonText, { color: theme.fg }]}>↺ Retry 1 word</Text>
            </Pressable>
          ) : (
            // Spent: nothing left to arm, but a returning player should see what
            // happened to it rather than find it silently missing.
            <Text style={[styles.retrySpent, { color: theme.fgFaint }]}>↺ Retry used</Text>
          )}
        </View>
      )}

      <CommonFormSheet
        word={explaining}
        date={date}
        onClose={() => setExplaining(undefined)}
      />

      {completed && streak && (
        <View style={styles.trackers}>
          <StreakDisplay
            streak={streak}
            totalRarity={totalRarityScore(acceptedWords, date)}
            topRarity={topRarityScore(acceptedWords, date)}
            date={date}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: space.lg,
  },
  list: {
    gap: space.sm,
  },
  entry: {
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  crown: {
    fontSize: 15,
  },
  word: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  spacer: {
    flex: 1,
  },
  hint: {
    fontSize: 11,
    fontWeight: '700',
  },
  /* The note and its "More info" on one line, wrapping to two on a long
     common form rather than pushing the control off the card. */
  baseNoteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  baseNote: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  baseNoteInfo: {
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  retry: {
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xs,
  },
  retryPrompt: {
    fontSize: 13,
    fontWeight: '700',
  },
  retryButton: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  retryCancel: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  retryCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  retrySpent: {
    fontSize: 13,
    fontWeight: '600',
  },
  trackers: {
    paddingTop: space.xs,
  },
});
