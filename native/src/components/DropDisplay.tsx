import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { revealGatedFor } from '../../../src/game/constants';
import { formatDateLabel } from '../../../src/game/date';
import {
  definitionFor,
  formatRarityScore,
  learnableWordForDrop,
} from '../../../src/game/dictionary';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { rarityPalette, useTheme } from '../theme/useTheme';
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
}

/** The day's letters, and -- once it is over -- the word they were hiding. */
export function DropDisplay({
  drop,
  date,
  isToday = true,
  completed = false,
  retryOffered = false,
  onReveal,
}: Props) {
  const theme = useTheme();

  // A full dictionary scan, so it is memoised against the drop rather than
  // re-run whenever an unrelated piece of the screen changes.
  const reveal = useMemo(() => learnableWordForDrop(drop, date), [drop, date]);
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
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.fgMuted }]}>
        {!isToday && date ? `${formatDateLabel(date)}'s drop` : "Today's drop"}
      </Text>

      <View
        style={styles.letters}
        accessibilityRole="text"
        // Spelled out, because a screen reader handed "STR" as one string says
        // "stir". The letters are the puzzle; they have to arrive as letters.
        accessibilityLabel={`The drop is ${drop.toUpperCase().split('').join(', ')}`}
      >
        {drop.split('').map((character, index) => (
          <View
            key={index}
            style={[styles.tile, { backgroundColor: theme.accent }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={[styles.tileText, { color: theme.accentFg }]}>
              {character.toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      {reveal && (
        <Text style={[styles.ceiling, { color: theme.fgFaint }]}>Best possible score: 10.0</Text>
      )}

      {completed && reveal && hidden && (
        <View style={styles.reveal}>
          <Pressable
            onPress={() => {
              signalTap();
              setConfirmingReveal(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.revealButton,
              { borderColor: theme.borderStrong, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.revealButtonText, { color: theme.fg }]}>Word of the day</Text>
          </Pressable>
          {/* The cost is stated before the button is pressed as well as inside
              the confirmation: deciding whether to tap should not require
              tapping to find out what it costs. */}
          <Text style={[styles.revealCost, { color: theme.fgFaint }]}>Uses your retry</Text>

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

      {completed && reveal && !hidden && palette && (
        <View style={styles.reveal}>
          <Pressable
            onPress={definition ? () => setDefinitionOpen((open) => !open) : undefined}
            disabled={!definition}
            accessibilityRole={definition ? 'button' : 'text'}
            accessibilityState={definition ? { expanded: definitionOpen } : undefined}
            accessibilityLabel={`Word of the day: ${reveal.word}, ${reveal.rarity}, score ${formatRarityScore(reveal.zipf, date)}`}
            style={({ pressed }) => [styles.wordRow, { opacity: pressed ? 0.6 : 1 }]}
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
          {definition && definitionOpen && (
            <Text style={[styles.definition, { color: theme.fgMuted }]}>{definition}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  letters: {
    flexDirection: 'row',
    gap: space.sm,
  },
  tile: {
    minWidth: 54,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 2,
  },
  ceiling: {
    fontSize: 12,
    fontWeight: '600',
  },
  reveal: {
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
  revealButton: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  revealButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  revealCost: {
    fontSize: 11,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  word: {
    fontSize: 22,
    fontWeight: '800',
  },
  wordScore: {
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  caret: {
    fontSize: 12,
  },
  definition: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: space.lg,
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
