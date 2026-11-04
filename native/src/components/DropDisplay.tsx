import { useContext, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { formatDateLabel } from '../../../src/game/date';
import { useTheme } from '../theme/useTheme';
import { PUZZLE_NAV_LABEL_WIDTH, PUZZLE_NAV_ROW_HEIGHT, PuzzleNavSlot } from './PuzzleNav';

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
}

/** The day's letters. */
export function DropDisplay({ drop, date, isToday = true }: Props) {
  const theme = useTheme();
  // Between PuzzleNav's arrows, the label sits on their row (see PuzzleNav).
  const inNav = useContext(PuzzleNavSlot);

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
});
