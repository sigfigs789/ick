import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Rarity } from '../../../src/game/types';
import { rarityPalette, useTheme } from '../theme/useTheme';
import { useReduceMotion } from './ConfettiBurst';
import { withAlpha } from './RarityBadge';

/** The stamp's whole life, slam to fade -- the website's `jackpot-stamp`. */
const STAMP_MS = 2400;
/** The gold flash behind it, which is over well before the stamp is. */
const FLASH_MS = 1100;

/**
 * The tier stamped across the screen for a Mythic or Legend: the screen
 * flashes gold, and the tier slams in tilted, settles, then lifts away and
 * fades -- over the grand confetti (see `.jackpot` in the website's index.css).
 *
 * Decoration only, and hidden from assistive technology: the feedback line has
 * already announced the word and its tier. Under Reduce Motion it is not drawn,
 * as the website's global rule cuts it to nothing.
 *
 * Mount it beside `<ConfettiBurst grand />` and unmount both together, as the
 * website does after GRAND_CONFETTI_MS.
 */
export function JackpotStamp({ rarity, date }: { rarity: Rarity; date?: string }) {
  const theme = useTheme();
  const reduced = useReduceMotion();
  const { width } = useWindowDimensions();
  const palette = rarityPalette(theme, rarity, date);
  const [stamp] = useState(() => new Animated.Value(0));
  const [flash] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const run = Animated.parallel([
      Animated.timing(stamp, {
        toValue: 1,
        duration: STAMP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(flash, {
        toValue: 1,
        duration: FLASH_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [stamp, flash]);

  if (reduced) return null;

  // The website's clamp(2.2rem, 11vw, 3.6rem).
  const fontSize = Math.min(57.6, Math.max(35.2, width * 0.11));
  // Its keyframes, as fractions of the stamp's 2.4 seconds.
  const keys = [0, 0.12, 0.2, 0.28, 0.75, 1];

  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.flash,
          {
            opacity: flash.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.stamp,
          {
            backgroundColor: palette.bg,
            boxShadow: `0 0 0 4px ${withAlpha(palette.fg, 0.3)}, 0 0 48px ${withAlpha(palette.fg, 0.45)}`,
            opacity: stamp.interpolate({ inputRange: keys, outputRange: [0, 1, 1, 1, 1, 0] }),
            transform: [
              {
                translateY: stamp.interpolate({
                  inputRange: keys,
                  outputRange: [0, 0, 0, 0, 0, -24],
                }),
              },
              {
                scale: stamp.interpolate({
                  inputRange: keys,
                  outputRange: [2.6, 0.92, 1.06, 1, 1, 1.15],
                }),
              },
              {
                rotate: stamp.interpolate({
                  inputRange: keys,
                  outputRange: ['-14deg', '-6deg', '-6deg', '-6deg', '-6deg', '-6deg'],
                }),
              },
            ],
          },
        ]}
      >
        <Text
          style={[
            styles.stampText,
            { fontSize, letterSpacing: fontSize * 0.04, color: palette.fg },
          ]}
        >
          {rarity}!
        </Text>
      </Animated.View>
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
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 21,
    elevation: 21,
  },
  flash: {
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 45%, rgba(255, 213, 74, 0.55), transparent 65%)',
  },
  stamp: {
    paddingVertical: 8,
    paddingHorizontal: 22.4,
    borderRadius: 16,
  },
  stampText: {
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});
