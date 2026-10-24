import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { revealGatedFor } from '../../../src/game/constants';
import { formatDateLabel } from '../../../src/game/date';
import {
  definitionFor,
  formatRarityScore,
  learnableWordForDrop,
} from '../../../src/game/dictionary';
import { useWordDataLoaded } from '../../../src/hooks/useWordDataLoaded';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { rarityPalette, useTheme } from '../theme/useTheme';
import { PUZZLE_NAV_LABEL_WIDTH, PUZZLE_NAV_ROW_HEIGHT, PuzzleNavSlot } from './PuzzleNav';
import { Sheet } from './Sheet';

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
  /** Once the puzzle is done, the day's word drops in under the letters. */
  completed?: boolean;
  /**
   * The puzzle's retry is still unspent, which is what keeps the word behind a
   * button: a finished puzzle re-opens when a word is retried, so handing the
   * best word over first would turn the mulligan into a lookup.
   */
  retryOffered?: boolean;
  /** Spend the retry to see the word. */
  onReveal?: () => void;
  /**
   * The word of the day section at all, button or word. The website hides it
   * from one arm of an experiment (see src/game/wordOfDay.ts); the app is
   * always the shown arm, so this defaults on and the play screen need not
   * pass it.
   */
  wordOfDay?: boolean;
}

/** The day's letters, and -- once it is over -- the word they were hiding. */
export function DropDisplay({
  drop,
  date,
  isToday = true,
  completed = false,
  retryOffered = false,
  onReveal,
  wordOfDay = true,
}: Props) {
  const theme = useTheme();
  // Between PuzzleNav's arrows, the label sits on their row (see PuzzleNav).
  const inNav = useContext(PuzzleNavSlot);

  // A full dictionary scan, so it is memoised against the drop rather than
  // re-run whenever an unrelated piece of the screen changes. Not before the
  // deferred scoring data is in, which can change the pick.
  const wordDataLoaded = useWordDataLoaded(date);
  const reveal = useMemo(
    () => (wordDataLoaded ? learnableWordForDrop(drop, date) : undefined),
    [drop, date, wordDataLoaded],
  );
  const definition = reveal ? definitionFor(reveal.word) : undefined;

  // Open by default: the definition is the point of the reveal, so it is there
  // to read without asking. The toggle stays for anyone who wants it gone.
  const [definitionOpen, setDefinitionOpen] = useState(true);
  const [confirmingReveal, setConfirmingReveal] = useState(false);

  // The same two conditions the website applies, and both are facts about the
  // puzzle rather than the session: the date is where the reveal shipped, and
  // the unspent retry is its price.
  const hidden = revealGatedFor(date) && retryOffered && onReveal !== undefined;

  /*
   * A new puzzle starts fresh: its definition open the way the last one's was,
   * and nothing left waiting to be confirmed.
   *
   * Adjusted during render against the puzzle this state belongs to, rather
   * than reset from an effect. An effect would paint the old puzzle's state
   * for a frame first -- yesterday's caret, or worse, a confirmation sheet
   * still up over a puzzle it no longer applies to -- and only then correct
   * it. React re-runs this component immediately on such a set, before
   * committing anything, so the stale frame never exists.
   */
  const puzzleKey = `${drop}:${date ?? ''}:${hidden}`;
  const [lastPuzzleKey, setLastPuzzleKey] = useState(puzzleKey);
  if (lastPuzzleKey !== puzzleKey) {
    setLastPuzzleKey(puzzleKey);
    setDefinitionOpen(true);
    setConfirmingReveal(false);
  }

  const palette = reveal ? rarityPalette(theme, reveal.rarity, date) : undefined;

  return (
    <View style={inNav ? styles.wrapInNav : styles.wrap}>
      <View style={inNav ? styles.labelRowInNav : undefined}>
        <Text
          style={[styles.label, inNav && styles.labelInNav, { color: theme.fgFaint }]}
          numberOfLines={inNav ? 1 : undefined}
        >
          {!isToday && date ? `${formatDateLabel(date)}'s drop` : "Today's drop"}
        </Text>
      </View>

      <View
        style={[styles.letters, inNav && styles.lettersInNav]}
        accessibilityRole="text"
        // Spelled out, because a screen reader handed "STR" as one string says
        // "stir". The letters are the puzzle; they have to arrive as letters.
        accessibilityLabel={`The drop is ${drop.toUpperCase().split('').join(', ')}`}
      >
        {drop.split('').map((character, index) => (
          <Tile key={`${drop}:${index}`} character={character} />
        ))}
      </View>

      {wordOfDay && completed && reveal && hidden && (
        <View style={styles.reveal}>
          <Pressable
            onPress={() => {
              signalTap();
              setConfirmingReveal(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.revealButton,
              {
                borderColor: theme.border,
                backgroundColor: pressed ? theme.cardBg : theme.bgInset,
              },
            ]}
          >
            <Text style={[styles.revealButtonText, { color: theme.fg }]}>Word of the day</Text>
          </Pressable>
          {/* The cost is said in the sheet the button opens, before anything
              is spent, so the button needs no caption of its own. */}

          <Sheet
            open={confirmingReveal}
            title="Reveal today's word?"
            onClose={() => setConfirmingReveal(false)}
            compact
          >
            <Text style={[styles.confirmCopy, { color: theme.fgMuted }]}>
              Seeing the word uses up your retry — you won't be able to take a word back on
              this puzzle afterwards.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setConfirmingReveal(false)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.confirmCancel,
                  { borderColor: theme.borderStrong, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.confirmCancelText, { color: theme.fg }]}>Never mind</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirmingReveal(false);
                  onReveal?.();
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.confirmGo,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.confirmGoText, { color: theme.accentFg }]}>Reveal word</Text>
              </Pressable>
            </View>
          </Sheet>
        </View>
      )}

      {wordOfDay && completed && reveal && !hidden && palette && (
        <View style={styles.reveal}>
          <FadeDown delay={150}>
          <Pressable
            onPress={definition ? () => setDefinitionOpen((open) => !open) : undefined}
            disabled={!definition}
            accessibilityRole={definition ? 'button' : 'text'}
            accessibilityState={definition ? { expanded: definitionOpen } : undefined}
            accessibilityLabel={`Word of the day: ${reveal.word}, ${reveal.rarity}, score ${formatRarityScore(reveal.zipf, date)}`}
            style={({ pressed }) => [
              styles.wordRow,
              { backgroundColor: pressed && definition ? theme.bgInset : 'transparent' },
            ]}
          >
            <Text style={[styles.word, { color: theme.fg }]}>{reveal.word}</Text>
            {/* The score alone, wearing its tier's colours. The badge's tag and
                dot would cost more room than the reveal is worth, and the tier
                is named in the label above so nothing rests on the colour. */}
            <Text style={[styles.wordScore, { backgroundColor: palette.bg, color: palette.fg }]}>
              {formatRarityScore(reveal.zipf, date)}
            </Text>
            {definition && (
              <Text style={[styles.caret, { color: theme.fgFaint }]}>
                {definitionOpen ? '▴' : '▾'}
              </Text>
            )}
          </Pressable>
          </FadeDown>
          {definition && definitionOpen && (
            <FadeDown delay={300}>
              <Text style={[styles.definition, { color: theme.fgMuted }]}>{definition}</Text>
            </FadeDown>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * One letter of the drop. There from the first frame and settling into place
 * (the website's tile-settle), rather than fading up from nothing: a paused
 * animation must never leave the drop blank under its label.
 */
function Tile({ character }: { character: string }) {
  const theme = useTheme();
  const [scale] = useState(() => new Animated.Value(0.92));
  useEffect(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 420,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [scale]);
  return (
    <Animated.View
      style={[
        styles.tile,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.borderStrong,
          transform: [{ scale }],
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.tileText, { color: theme.fg }]}>{character.toUpperCase()}</Text>
    </Animated.View>
  );
}

/** The reveal's word and definition arrive dropping 6pt into place, as on the website. */
function FadeDown({ delay, children }: { delay: number; children: ReactNode }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [progress, delay]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* .drop-display: centred, 1.75rem under it. */
  wrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  /* Between PuzzleNav's arrows the nav carries the margin. */
  wrapInNav: {
    alignItems: 'center',
  },
  label: {
    marginBottom: 10,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  /* The middle column of the arrows' row: 7rem wide, one line, centred on
     the arrows. */
  labelRowInNav: {
    width: PUZZLE_NAV_LABEL_WIDTH,
    height: PUZZLE_NAV_ROW_HEIGHT,
    justifyContent: 'center',
  },
  labelInNav: {
    marginBottom: 0,
    textAlign: 'center',
  },
  letters: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  lettersInNav: {
    marginTop: 10,
  },
  /* .drop-display__letter: a 3.1rem card-coloured tile with a strong border. */
  tile: {
    width: 50,
    height: 50,
    borderWidth: 2,
    borderRadius: 10.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    fontSize: 29.6,
    fontWeight: '800',
  },
  reveal: {
    alignItems: 'center',
  },
  revealButton: {
    marginTop: 6.4,
    paddingHorizontal: 12.8,
    paddingVertical: 4.8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  revealButtonText: {
    fontSize: 14.4,
    fontWeight: '800',
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6.4,
    marginTop: 6.4,
    paddingVertical: 1.6,
    paddingHorizontal: 5.6,
    borderRadius: 6,
  },
  word: {
    fontSize: 15.2,
    fontWeight: '800',
    textTransform: 'lowercase',
  },
  wordScore: {
    fontSize: 12.8,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: 6.7,
    paddingVertical: 2,
  },
  caret: {
    fontSize: 11.2,
  },
  definition: {
    marginTop: 3.2,
    maxWidth: 448,
    fontSize: 13.1,
    lineHeight: 19,
    textAlign: 'left',
  },
  confirmCopy: {
    fontSize: 15,
    lineHeight: 22,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xs,
  },
  confirmCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  confirmGo: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  confirmGoText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
