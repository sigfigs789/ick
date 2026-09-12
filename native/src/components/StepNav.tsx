import { Pressable, StyleSheet, Text, View } from 'react-native';
import { signalTap } from '../host/feedback';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  /** What the reader is looking at: a puzzle, a date, a week, a month. */
  label: string;
  /**
   * The thing a press moves by, for the screen reader: "puzzle", "day",
   * "week", "month".
   *
   * The visible text stays "Previous" and "Next" on every screen, because
   * three of these appear under a row of tabs on a phone's width and the unit
   * is already named by the label between them. A screen reader gets no such
   * spatial hint, so it gets the unit.
   */
  unit: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/**
 * Back, forward, and what you are looking at.
 *
 * One control for the puzzle, the three boards and the finds feed. They were
 * going to be four near-identical rows -- the same arrows, the same disabled
 * rules, the same hit targets -- and the differences between them are a label
 * and a noun.
 *
 * Forward stays visible rather than disappearing at the present edge. A reader
 * who has stepped back needs to see that forward exists before they can want
 * it, which a control that only appears once you are already in the past
 * cannot do.
 */
export function StepNav({ label, unit, canGoBack, canGoForward, onBack, onForward }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Arrow
        text="Previous"
        glyph="‹"
        glyphFirst
        disabled={!canGoBack}
        onPress={onBack}
        accessibilityLabel={`Previous ${unit}`}
      />
      <Text style={[styles.label, { color: theme.fgMuted }]} accessibilityLiveRegion="polite">
        {label}
      </Text>
      <Arrow
        text="Next"
        glyph="›"
        disabled={!canGoForward}
        onPress={onForward}
        accessibilityLabel={`Next ${unit}`}
      />
    </View>
  );
}

function Arrow({
  text,
  glyph,
  glyphFirst = false,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  text: string;
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
      // A phone target, not a mouse target: the visible chevron is small, so the
      // touchable is grown past it rather than the glyph being padded up to a
      // size that would crowd the label between them.
      hitSlop={space.sm}
      style={({ pressed }) => [styles.arrow, { opacity: pressed && !disabled ? 0.5 : 1 }]}
    >
      {glyphFirst && <Text style={[styles.glyph, { color }]}>{glyph}</Text>}
      <Text style={[styles.arrowText, { color }]}>{text}</Text>
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
  arrowText: {
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
