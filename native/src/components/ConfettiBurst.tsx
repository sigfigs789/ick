import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

/** The website's root font size, which its rem lengths are measured against. */
const REM = 16;

/** CSS's `ease-out`, which the website's falling pieces use. */
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
/** The rising burst's launch: fast off the floor, slowing to a hang at the top. */
const EASE_RISE = Easing.bezier(0.15, 0.8, 0.35, 1);

/**
 * How long each burst's pieces take to clear the screen, last piece included,
 * so a caller can unmount it once it is over (the website clears its burst
 * after 1800 ms, or 2800 ms for a grand one).
 */
export const CONFETTI_MS = 1800;
export const GRAND_CONFETTI_MS = 2800;
export const RISING_CONFETTI_MS = 2900;

/**
 * Whether the player has asked the system for less motion.
 *
 * Starts at `false` and corrects itself a moment later, the way the website's
 * own rule does nothing until the media query has answered. A phone that will
 * not say is treated as one that never asked.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

interface Piece {
  left: number;
  color: string;
  delay: number;
  duration: number;
  easing: (value: number) => number;
  /** Where the piece ends up, relative to where it starts. */
  dx: number;
  dy: number;
  spin: number;
  rising: boolean;
}

/**
 * The website's three bursts, piece for piece (see `.confetti` in index.css).
 *
 * - The plain burst, for a Rare-or-better word: 24 pieces across the top in a
 *   rainbow, fanning out as they fall.
 * - `grand`, for a Mythic or Legend and the perfect month: twice the pieces,
 *   packed twice as close, falling slower, and every other one gold -- so it
 *   reads as a different occasion rather than the same one again.
 * - `rising`, for the improving average and the streak-board climb: it goes up,
 *   like the average did. Greens and golds launched from the bottom edge, a
 *   third of them on each of three heights so the spray is ragged rather than a
 *   straight line.
 *
 * Laid out deterministically by index, as the website's are, rather than
 * rolled at random: the spread is the design, and a random one sometimes
 * bunched every piece on one side.
 */
function layout(width: number, height: number, grand: boolean, rising: boolean): Piece[] {
  const vw = width / 100;
  const vh = height / 100;
  if (rising) {
    return Array.from({ length: 48 }, (_, index) => {
      // nth-child is counted from one, so the website's 3n is index 2, 5, 8...
      const lane = index % 3 === 2 ? 'low' : index % 3 === 0 ? 'mid' : 'high';
      const dx =
        lane === 'high'
          ? (index - 24) * 0.5 * vw
          : lane === 'mid'
            ? (24 - index) * 0.6 * vw
            : (index - 24) * 0.8 * vw;
      const dy = lane === 'high' ? -88 * vh : lane === 'mid' ? -70 * vh : -52 * vh;
      const spin = lane === 'high' ? -540 : lane === 'mid' ? 480 : -600;
      return {
        left: (index + 1) * 0.02 * width,
        color: lane === 'low' ? 'hsl(44, 92%, 54%)' : `hsl(${95 + index * 1.5}, 68%, 46%)`,
        delay: index * 14,
        duration: 2200,
        easing: EASE_RISE,
        dx,
        dy,
        spin,
        rising: true,
      };
    });
  }
  if (grand) {
    return Array.from({ length: 48 }, (_, index) => ({
      left: (index + 1) * 0.02 * width,
      // The website's :nth-child(odd), counted from one: index 0, 2, 4...
      color:
        index % 2 === 0
          ? `hsl(${38 + index * 0.4}, 92%, 54%)`
          : `hsl(${(index * 29) % 360}, 78%, 56%)`,
      delay: index * 22,
      duration: 2600,
      easing: EASE_OUT,
      dx: (index - 24) * 0.9 * vw,
      dy: 108 * vh,
      spin: 720,
      rising: false,
    }));
  }
  return Array.from({ length: 24 }, (_, index) => ({
    left: (index + 1) * 0.04 * width,
    color: `hsl(${(index * 29) % 360}, 78%, 56%)`,
    delay: index * 18,
    duration: 1600,
    easing: EASE_OUT,
    dx: (index - 12) * 1.8 * vw,
    dy: 108 * vh,
    spin: 540,
    rising: false,
  }));
}

/**
 * Confetti over the whole screen: the plain burst, the `grand` one, or the
 * `rising` one (see `layout` for which is which).
 *
 * Purely decorative, and hidden from assistive technology entirely: whatever it
 * celebrates has already been announced, and a screen reader has nothing to
 * gain from being told about falling rectangles. Under Reduce Motion it is not
 * drawn at all, as the website's global rule cuts it to nothing.
 *
 * Drawn as plain views on the native driver rather than pulled in as a confetti
 * library. It is a few dozen rectangles for under three seconds -- a dependency
 * for that would be a dependency to keep updated, audit and ship for the rest
 * of the app's life.
 */
export function ConfettiBurst({
  grand = false,
  rising = false,
}: {
  grand?: boolean;
  rising?: boolean;
}) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  /*
   * Laid out once, when the burst mounts. A lazy state initialiser rather than
   * a memo, because a memo is a cache React may discard: a rotation halfway
   * through should not restart the animation or teleport its pieces.
   */
  const [pieces] = useState(() => layout(width, height, grand, rising));
  const [progress] = useState(() => pieces.map(() => new Animated.Value(0)));

  useEffect(() => {
    const run = Animated.parallel(
      pieces.map((piece, index) =>
        Animated.timing(progress[index], {
          toValue: 1,
          delay: piece.delay,
          duration: piece.duration,
          easing: piece.easing,
          useNativeDriver: true,
        }),
      ),
    );
    run.start();
    return () => run.stop();
  }, [pieces, progress]);

  if (reduced) return null;

  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((piece, index) => {
        const value = progress[index];
        return (
          <Animated.View
            key={index}
            style={[
              styles.piece,
              piece.rising ? styles.fromBottom : styles.fromTop,
              {
                left: piece.left,
                backgroundColor: piece.color,
                // The falling pieces fade the whole way down; the rising ones
                // hold until near the top of their arc (70% of the way in).
                opacity: value.interpolate({
                  inputRange: piece.rising ? [0, 0.93, 1] : [0, 1],
                  outputRange: piece.rising ? [1, 1, 0] : [1, 0],
                }),
                transform: [
                  {
                    translateX: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, piece.dx],
                    }),
                  },
                  {
                    translateY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, piece.dy],
                    }),
                  },
                  {
                    rotate: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', `${piece.spin}deg`],
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
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    zIndex: 20,
    elevation: 20,
  },
  piece: {
    position: 'absolute',
    width: 0.55 * REM,
    height: 0.8 * REM,
  },
  // Just off the edge the piece flies in from, as the website's -1.2rem is.
  fromTop: {
    top: -1.2 * REM,
  },
  fromBottom: {
    bottom: -1.2 * REM,
  },
});
