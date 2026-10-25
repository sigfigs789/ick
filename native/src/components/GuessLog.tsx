import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { isNewBest } from '../../../src/game/celebration';
import { maxGuessesFor } from '../../../src/game/constants';
import { baseFormSubstitution, totalRarityScore } from '../../../src/game/dictionary';
import { bestWord } from '../../../src/game/rank';
import type { AcceptedWord, StreakState } from '../../../src/game/types';
import { useWordDataLoaded } from '../../../src/hooks/useWordDataLoaded';
import { signalTap } from '../host/feedback';
import { useTheme } from '../theme/useTheme';
import { CommonFormSheet } from './CommonFormSheet';
import { RarityBadge } from './RarityBadge';
import { StreakDisplay } from './StreakDisplay';

interface Props {
  acceptedWords: AcceptedWord[];
  completed?: boolean;
  streak?: StreakState;
  /** The puzzle's date, so scores use the system in effect that day. */
  date?: string;
  /** Whether `date` is today's puzzle, for the finished streak's today state and lazy weekend pie. */
  isToday?: boolean;
  /** The retry is unspent and there is a word to spend it on. */
  canRetry?: boolean;
  /** The retry is unspent, whether or not there is yet anything to spend it on. */
  retryOffered?: boolean;
  /** It has been spent, on a puzzle that offered one. */
  retrySpent?: boolean;
  /** Drop a banked word and hand its guess back. */
  onRetry?: (word: string) => void;
  /** Sits in the header beside the count: the play screen's Share. */
  headerAction?: ReactNode;
}

/** How long a just-scored word keeps its "fresh" flourishes, in ms. */
const FRESH_MS = 2600;
/** How long the word that has just landed stays lit, in ms. */
const LANDED_MS = 1600;
/** The gold the website's new-best flourish wears, the same in both themes. */
const NEW_BEST_GOLD = '#ffd54a';
const NEW_BEST_INK = '#3d2c00';
/** The website's --ease-standard. */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Every word banked on this puzzle, the rarest one crowned: the website's
 * play screen guess log (src/components/GuessLog.tsx, the `newUi` layout).
 *
 * The other mode's copy controls are left out: the app plays one game and has
 * no switch to name another.
 */
export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
  isToday = false,
  canRetry = false,
  retryOffered = false,
  retrySpent = false,
  onRetry,
  headerAction,
}: Props) {
  const theme = useTheme();
  const best = bestWord(acceptedWords);
  const maxGuesses = maxGuessesFor(date);
  // The common-form notes below are worked out from the deferred scoring data,
  // so they wait for it rather than name a base the reviewed folds overrule.
  const wordDataLoaded = useWordDataLoaded(date);

  /*
   * Armed by the retry button, and spent by tapping a word.
   *
   * Two taps rather than a retry control on every row, exactly as on the
   * website: the log is four cards on a phone, already carrying a crown and a
   * badge, and a third control per row would crowd the one thing a card
   * exists to show.
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

  /*
   * The word that has just landed, lit for a moment so the eye finds it under
   * the input -- and "fresh" for a little longer: its badge pops in with its
   * score rolling up, and if it beat the day's earlier best it says so. Only a
   * word added while the log is on screen, not the words a puzzle loads with
   * or a puzzle switch.
   */
  const [landed, setLanded] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ word: string; newBest: boolean } | null>(null);
  const seen = useRef({ date, count: acceptedWords.length });
  useEffect(() => {
    const before = seen.current;
    seen.current = { date, count: acceptedWords.length };
    if (before.date !== date || acceptedWords.length <= before.count) return;
    const word = acceptedWords[acceptedWords.length - 1].word;
    setFresh({ word, newBest: isNewBest(acceptedWords) });
    setLanded(word);
    const landedTimer = setTimeout(() => setLanded((w) => (w === word ? null : w)), LANDED_MS);
    const freshTimer = setTimeout(
      () => setFresh((f) => (f?.word === word ? null : f)),
      FRESH_MS
    );
    return () => {
      clearTimeout(landedTimer);
      clearTimeout(freshTimer);
    };
  }, [acceptedWords, date]);

  return (
    <View
      style={completed ? styles.sectionCompleted : styles.section}
      accessibilityLabel="Your guesses"
    >
      {/* Kept on a finished puzzle too: the Share beside the count is how the
          share panel is reached, and a finished puzzle is the likeliest
          moment to want it. No mode named: the app plays one game. */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.fg }]} accessibilityRole="header">
          Guesses
        </Text>
        <Text style={[styles.count, { color: theme.fgMuted }]}>
          {acceptedWords.length} of {maxGuesses} guesses
        </Text>
        {headerAction}
      </View>

      {acceptedWords.length === 0 ? (
        // What an empty slot is for is saying what will fill it.
        <Text
          style={[
            styles.empty,
            { borderColor: theme.border, backgroundColor: theme.bgInset, color: theme.fgMuted },
          ]}
        >
          No words yet — aim for the rarest word you can find.
        </Text>
      ) : (
        <View style={styles.list}>
          {acceptedWords.map((w, index) => {
            const isBest = best !== undefined && w.word === best.word;
            /*
             * Shown for every word scored as another form, whatever it cost --
             * the website's rule. "Common form", not "base word": the fold takes
             * the most common word in the family, which is often a sibling or a
             * longer form rather than a base -- calling a plural the base word
             * of its own singular reads as the very bug this is meant to explain.
             */
            const baseNote = wordDataLoaded ? baseFormSubstitution(w.word, date) : undefined;
            const isFresh = fresh?.word === w.word;
            return (
              <Entry
                key={w.word}
                word={w}
                index={index}
                date={date}
                isBest={isBest}
                picking={picking}
                landed={landed === w.word}
                fresh={isFresh}
                newBest={isFresh && fresh?.newBest === true}
                baseNote={baseNote?.base}
                onRetry={() => {
                  setArming(false);
                  onRetry?.(w.word);
                }}
                onExplain={(base) => {
                  signalTap();
                  setExplaining({ word: w.word, base });
                }}
              />
            );
          })}
        </View>
      )}

      {/* Under the log rather than over it: the retry is about the words above
          it, and on a finished puzzle it is the only thing left to do. Shown
          from the moment the puzzle opens -- greyed out -- rather than
          appearing out of nowhere once a first guess lands. */}
      {(retryOffered || retrySpent) && (
        <View
          style={[
            styles.retry,
            picking && [
              styles.retryPicking,
              { borderColor: theme.accent, backgroundColor: theme.bgInset },
            ],
          ]}
        >
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
                hitSlop={6}
                style={styles.retryCancel}
              >
                {({ pressed }) => (
                  <Text
                    style={[styles.retryCancelText, { color: pressed ? theme.fg : theme.fgMuted }]}
                  >
                    Never mind
                  </Text>
                )}
              </Pressable>
            </>
          ) : retryOffered ? (
            // The limit is in the label itself -- "1 word", not "a word".
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
                  borderColor: !canRetry ? theme.border : pressed ? theme.accent : theme.borderStrong,
                  backgroundColor: pressed && canRetry ? theme.bgInset : 'transparent',
                },
              ]}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.retryButtonText,
                    { color: !canRetry ? theme.fgFaint : pressed ? theme.fg : theme.fgMuted },
                  ]}
                >
                  ↺ Retry 1 word
                </Text>
              )}
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
        <StreakDisplay
          streak={streak}
          totalRarity={totalRarityScore(acceptedWords, date)}
          date={date}
          isToday={isToday}
          hideEmpty
          hasWords={acceptedWords.length > 0}
          style={styles.trackers}
        />
      )}
    </View>
  );
}

/** One banked word's card. */
function Entry({
  word: w,
  index,
  date,
  isBest,
  picking,
  landed,
  fresh,
  newBest,
  baseNote,
  onRetry,
  onExplain,
}: {
  word: AcceptedWord;
  index: number;
  date?: string;
  isBest: boolean;
  picking: boolean;
  landed: boolean;
  fresh: boolean;
  newBest: boolean;
  baseNote?: string;
  onRetry: () => void;
  onExplain: (base: string) => void;
}) {
  const theme = useTheme();

  // slot-fill: every card arrives a little small and faint, overshoots, settles.
  const [arrive] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(arrive, {
      toValue: 1,
      duration: 380,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    }).start();
  }, [arrive]);
  const scale = arrive.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.92, 1.02, 1] });
  const opacity = arrive.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1, 1] });

  // The halo a landing or a new best lights, held then faded (entry-landed,
  // entry-new-best): blue for any word just in, gold for one that beat the best.
  const [halo] = useState(() => new Animated.Value(0));
  const glowing = landed || newBest;
  useEffect(() => {
    if (!glowing) return;
    halo.setValue(1);
    const duration = newBest ? 1800 : LANDED_MS;
    const run = Animated.sequence([
      Animated.delay(duration * (newBest ? 0.45 : 0.4)),
      Animated.timing(halo, {
        toValue: 0,
        duration: duration * (newBest ? 0.55 : 0.6),
        easing: EASE_STANDARD,
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [glowing, newBest, halo]);

  // The crown hops when its word has just taken the crown.
  const [hop] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!newBest) return;
    hop.setValue(0);
    Animated.timing(hop, {
      toValue: 1,
      duration: 700,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [newBest, hop]);
  const hopStyle = {
    transform: [
      { translateY: hop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, -8, 0] }) },
      { scale: hop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.35, 1] }) },
      {
        rotate: hop.interpolate({
          inputRange: [0, 0.4, 1],
          outputRange: ['0deg', '-12deg', '0deg'],
        }),
      },
    ],
  };

  const borderColor = picking ? theme.accent : isBest ? theme.bestWordAccent : theme.borderStrong;

  const row = (pressed: boolean) => (
    <View style={[styles.entryRow, pressed && { backgroundColor: theme.bgInset }]}>
      {isBest && (
        <Animated.Text
          style={[styles.crown, newBest && !picking && hopStyle]}
          accessibilityLabel={picking ? undefined : 'Best word'}
        >
          👑
        </Animated.Text>
      )}
      <Text style={[styles.word, { color: theme.fg }]} numberOfLines={1}>
        {w.word}
      </Text>
      {picking ? (
        <Text style={[styles.retryHint, { color: theme.fgMuted }]}>Retry</Text>
      ) : (
        newBest && <NewBestPill />
      )}
      <View style={styles.spacer} />
      <View style={styles.meta}>
        <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} fresh={fresh && !picking} />
      </View>
    </View>
  );

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <View
        style={[
          styles.entry,
          {
            borderColor,
            borderStyle: picking ? 'dashed' : 'solid',
            backgroundColor: theme.cardBg,
          },
          // The crowned card's gold halo, in place of a tinted fill.
          isBest && !picking && {
            shadowColor: theme.bestWordAccent,
            shadowOpacity: 0.35,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      >
        {/* The card is a button only while the retry is armed, when tapping it
            drops that word. The rest of the time it is plain text. */}
        {picking ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={`Retry "${w.word}" (${w.rarity}, guess ${index + 1}) — clear it and try again`}
          >
            {({ pressed }) => row(pressed)}
          </Pressable>
        ) : (
          row(false)
        )}
        {/* Hidden while the retry is armed: the whole card is the thing you
            tap then, and a live control inside it is a hole in that target. */}
        {baseNote && !picking && (
          <View style={styles.baseNote}>
            <Text style={[styles.baseNoteText, { color: theme.fgMuted }]}>
              Scored as its common form, “{baseNote}”
            </Text>
            <Pressable
              onPress={() => onExplain(baseNote)}
              accessibilityRole="button"
              accessibilityLabel={`Why “${w.word}” was scored as its common form “${baseNote}”`}
              hitSlop={8}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.baseNoteText,
                    styles.baseNoteInfo,
                    { color: pressed ? theme.fg : theme.fgMuted },
                  ]}
                >
                  More info
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
      {/* The halo, over the card's edge rather than in it, so lighting it
          never moves the card's contents. */}
      {glowing && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              opacity: halo,
              borderColor: newBest ? NEW_BEST_GOLD : theme.focusRing,
              shadowColor: newBest ? NEW_BEST_GOLD : theme.focusRing,
            },
          ]}
        />
      )}
    </Animated.View>
  );
}

/** "New best!", popping in beside the word and fading after a moment. */
function NewBestPill() {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: FRESH_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [t]);
  // new-best-in: 0 -> 15% overshoot -> 25..85% at rest -> gone.
  const scale = t.interpolate({
    inputRange: [0, 0.15, 0.25, 0.85, 1],
    outputRange: [0, 1.2, 1, 1, 0.9],
  });
  const rotate = t.interpolate({
    inputRange: [0, 0.15, 0.25, 1],
    outputRange: ['-12deg', '4deg', '0deg', '0deg'],
  });
  const opacity = t.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  });
  return (
    <Animated.View style={[styles.newBest, { opacity, transform: [{ scale }, { rotate }] }]}>
      <Text style={styles.newBestText}>NEW BEST!</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* .guess-log: 1.5rem under it, 0.5rem once the puzzle is finished. */
  section: {
    marginBottom: 24,
  },
  sectionCompleted: {
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 9.6,
  },
  title: {
    fontSize: 15.2,
    fontWeight: '800',
  },
  // With only four guesses a day the count carries real weight: the heading's
  // size and weight, in the muted ink.
  count: {
    marginLeft: 'auto',
    fontSize: 15.2,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    paddingVertical: 14.4,
    paddingHorizontal: 17.6,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    overflow: 'hidden',
    fontSize: 14.4,
  },
  list: {
    gap: 8.8,
  },
  entry: {
    borderWidth: 2,
    borderRadius: 12,
  },
  /* The card's top row: crown, word, retry hint or "New best!", then the badge
     pushed right. */
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54.4,
    paddingVertical: 6.4,
    paddingLeft: 14.4,
    paddingRight: 8,
    borderRadius: 10,
  },
  crown: {
    marginRight: 8,
    fontSize: 16,
    lineHeight: 20,
  },
  word: {
    flexShrink: 1,
    fontSize: 18.4,
    fontWeight: '700',
    letterSpacing: 0.18,
    textTransform: 'lowercase',
  },
  retryHint: {
    marginLeft: 8,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.23,
    textTransform: 'uppercase',
  },
  spacer: {
    flex: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 9.6,
  },
  /* Quiet enough to read as a footnote to the word rather than a warning: the
     score is correct, this only says which word it was measured from. The
     same left indent as the word above. */
  baseNote: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 5.6,
    rowGap: 1.6,
    marginTop: -4,
    paddingHorizontal: 14.4,
    paddingBottom: 8,
  },
  baseNoteText: {
    fontSize: 11.5,
    lineHeight: 13.8,
  },
  baseNoteInfo: {
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  halo: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 15,
    borderWidth: 3,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  newBest: {
    marginLeft: 8,
    paddingVertical: 2.4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: NEW_BEST_GOLD,
  },
  newBestText: {
    color: NEW_BEST_INK,
    fontSize: 10.9,
    fontWeight: '900',
    letterSpacing: 0.44,
  },
  /* Retry: a quiet outline button -- the filled treatment on this screen
     belongs to Play and Share, the two things a player is meant to be doing. */
  retry: {
    marginTop: 11.2,
    alignItems: 'center',
  },
  retryPicking: {
    marginTop: 13.6,
    paddingVertical: 12,
    paddingHorizontal: 14.4,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  retryPrompt: {
    fontSize: 13.1,
    lineHeight: 18.4,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 35.2,
    justifyContent: 'center',
    paddingVertical: 7.2,
    paddingHorizontal: 14.4,
    borderWidth: 2,
    borderRadius: 10.4,
  },
  retryButtonText: {
    fontSize: 13.1,
    fontWeight: '700',
    letterSpacing: 0.26,
  },
  retryCancel: {
    marginTop: 8.8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  retryCancelText: {
    fontSize: 12.8,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  retrySpent: {
    fontSize: 12.8,
  },
  /* .guess-log__completion-trackers: no top padding, 0.75rem above. */
  trackers: {
    paddingTop: 0,
    marginTop: 12,
    marginBottom: 10.4,
  },
});
