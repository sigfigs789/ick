import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateLabel } from '../../../src/game/date';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  date: string;
  puzzleNumber: number;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Which puzzle you are on, and the way back to the ones you missed. */
export function PuzzleNav({
  date,
  puzzleNumber,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
}: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Arrow
        label="Previous"
        glyph="‹"
        glyphFirst
        disabled={!canGoToPrevious}
        onPress={onPrevious}
        accessibilityLabel="Previous puzzle"
      />
      <Text style={[styles.label, { color: theme.fgMuted }]} accessibilityLiveRegion="polite">
        Puzzle #{puzzleNumber} · {formatDateLabel(date)}
      </Text>
      <Arrow
        label="Next"
        glyph="›"
        disabled={!canGoToNext}
        onPress={onNext}
        accessibilityLabel="Next puzzle"
      />
    </View>
  );
}

function Arrow({
  label,
  glyph,
  glyphFirst = false,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  glyph: string;
  glyphFirst?: boolean;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const color = disabled ? theme.fgFaint : theme.fg;

  return (
    <Pressable
      onPress={() => {
        signalTap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      // A phone target, not a mouse target: the visible chevron is small, so
      // the touchable is grown past it rather than the glyph being padded up to
      // a size that would crowd the date between them.
      hitSlop={space.sm}
      style={({ pressed }) => [
        styles.arrow,
        { opacity: pressed && !disabled ? 0.5 : 1 },
      ]}
    >
      {glyphFirst && <Text style={[styles.glyph, { color }]}>{glyph}</Text>}
      <Text style={[styles.arrowLabel, { color }]}>{label}</Text>
      {!glyphFirst && <Text style={[styles.glyph, { color }]}>{glyph}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  arrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  arrowLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  glyph: {
    fontSize: 17,
    lineHeight: 19,
    fontWeight: '600',
  },
  label: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
});
