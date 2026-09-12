import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

const PIECES = 28;
const DURATION_MS = 1800;

/**
 * The small celebration for a first Rare-or-better word.
 *
 * Purely decorative, and hidden from assistive technology entirely: the word
 * was already announced as accepted with its tier, and a screen reader has
 * nothing to gain from being told about falling rectangles.
 *
 * Drawn as plain views on the native driver rather than pulled in as a confetti
 * library. It is twenty-eight rectangles for under two seconds, once a day at
 * most -- a dependency for that would be a dependency to keep updated, audit
 * and ship for the rest of the app's life.
 */
export function ConfettiBurst() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));

  // The rarity ladder's own dots, so the celebration is in the game's colours
  // rather than a generic party palette.
  const colors = useMemo(
    () => [
      theme.rarity.Rare.dot,
      theme.rarity['Extremely Rare'].dot,
      theme.rarity.Elusive.dot,
      theme.rarity.Mythic.dot,
      theme.bestWordAccent,
    ],
    [theme],
  );

  /*
   * Rolled once, when the burst mounts, and never again.
   *
   * Held in state rather than memoised because the randomness is the point and
   * a memo is a cache, not a guarantee: React is free to discard one and
   * recompute, which here would teleport every piece sideways mid-fall. A lazy
   * state initialiser is the thing that actually runs exactly once.
   *
   * That it therefore ignores a later `width` or theme change is correct, not a
   * limitation -- the burst lasts under two seconds, and a rotation halfway
   * through it should not restart the animation.
   */
  const [pieces] = useState(() =>
    Array.from({ length: PIECES }, (_, index) => ({
      left: Math.random() * width,
      drift: (Math.random() - 0.5) * 120,
      delay: Math.random() * 250,
      size: 6 + Math.random() * 6,
      spin: Math.random() * 4 - 2,
      color: colors[index % colors.length],
    })),
  );

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((piece, index) => {
        // Each piece's own slice of the shared clock, so one animated value
        // drives all of them and the whole burst stays on the native driver.
        const start = piece.delay / DURATION_MS;
        const range = [0, start, 1];

        return (
          <Animated.View
            key={index}
            style={[
              styles.piece,
              {
                left: piece.left,
                width: piece.size,
                height: piece.size * 1.6,
                backgroundColor: piece.color,
                opacity: progress.interpolate({
                  inputRange: [0, start, 0.75, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: range,
                      outputRange: [-40, -40, 900],
                    }),
                  },
                  {
                    translateX: progress.interpolate({
                      inputRange: range,
                      outputRange: [0, 0, piece.drift],
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: range,
                      outputRange: ['0deg', '0deg', `${piece.spin * 360}deg`],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    top: 0,
    borderRadius: 1,
  },
});
