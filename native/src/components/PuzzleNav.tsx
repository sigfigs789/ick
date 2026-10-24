import { createContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateLabel } from '../../../src/game/date';
import { signalTap } from '../host/feedback';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { StepNav } from './StepNav';

interface Props {
  date: string;
  puzzleNumber: number;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /**
   * What sits between the arrows. The game puts the drop itself there, which
   * already names the day; without it, the puzzle number and date stand in.
   */
  children?: ReactNode;
}

/** The width of the slot between the arrows, the website's 7rem column. */
export const PUZZLE_NAV_LABEL_WIDTH = 112;
/** The height of the arrows' row, the website's 2rem arrow. */
export const PUZZLE_NAV_ROW_HEIGHT = 32;

/**
 * Whether a component is drawn between the arrows. The website lays the drop
 * out on the nav's own grid with `display: contents` -- its label in the
 * middle column of the arrows' row, its tiles on a row of their own underneath.
 * React Native has no such thing, so the drop draws itself as usual and reads
 * this to fit its label to the arrows' row (see DropDisplay).
 */
export const PuzzleNavSlot = createContext(false);

/**
 * Which puzzle you are on, and the way back to the ones you missed.
 *
 * Without children the arrows are `StepNav`, shared with the boards and the
 * finds feed. With them -- the play screen, which puts the drop there -- the
 * arrows read as quiet links on the drop's label row rather than buttons: on
 * today's puzzle Previous is the only one live, and it leads into the archive,
 * which is not where most players are headed. A dead arrow is hidden rather
 * than greyed, as the website hides it.
 */
export function PuzzleNav({
  date,
  puzzleNumber,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
  children,
}: Props) {
  if (children === undefined || children === null) {
    return (
      <StepNav
        label={`Puzzle #${puzzleNumber} · ${formatDateLabel(date)}`}
        unit="puzzle"
        canGoBack={canGoToPrevious}
        canGoForward={canGoToNext}
        onBack={onPrevious}
        onForward={onNext}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <PuzzleNavSlot.Provider value>{children}</PuzzleNavSlot.Provider>
      {/* Over the drop's label row: an arrow either side of the middle slot,
          each hugging it. `box-none` so the slot itself stays tappable. */}
      <View style={styles.arrows} pointerEvents="box-none">
        <View style={[styles.side, styles.sideStart]} pointerEvents="box-none">
          <QuietArrow
            text="Previous"
            glyph="‹"
            glyphFirst
            disabled={!canGoToPrevious}
            onPress={onPrevious}
            accessibilityLabel="Previous puzzle"
          />
        </View>
        <View style={styles.middle} pointerEvents="none" />
        <View style={[styles.side, styles.sideEnd]} pointerEvents="box-none">
          <QuietArrow
            text="Next"
            glyph="›"
            disabled={!canGoToNext}
            onPress={onNext}
            accessibilityLabel="Next puzzle"
          />
        </View>
      </View>
    </View>
  );
}

function QuietArrow({
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
  // Hidden, not removed, so the label between them never shifts sideways.
  if (disabled) return <View style={styles.arrow} accessibilityElementsHidden />;
  return (
    <Pressable
      onPress={() => {
        signalTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={space.xs}
      style={({ pressed }) => [
        styles.arrow,
        pressed && { backgroundColor: theme.bgInset, transform: [{ scale: 0.96 }] },
      ]}
    >
      {({ pressed }) => (
        <>
          {glyphFirst && (
            <Text style={[styles.arrowText, { color: pressed ? theme.fg : theme.fgMuted }]}>
              {glyph}
            </Text>
          )}
          <Text style={[styles.arrowText, { color: pressed ? theme.fg : theme.fgMuted }]}>
            {text}
          </Text>
          {!glyphFirst && (
            <Text style={[styles.arrowText, { color: pressed ? theme.fg : theme.fgMuted }]}>
              {glyph}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* .puzzle-nav--drop: 1.75rem under it. */
  wrap: {
    marginBottom: 28,
  },
  arrows: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PUZZLE_NAV_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  side: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  sideStart: {
    justifyContent: 'flex-end',
  },
  sideEnd: {
    justifyContent: 'flex-start',
  },
  middle: {
    width: PUZZLE_NAV_LABEL_WIDTH,
  },
  /* .puzzle-nav__arrow, with the drop row's transparent border and fill. */
  arrow: {
    minHeight: PUZZLE_NAV_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  arrowText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
