import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { rollingValue } from '../../../src/game/celebration';
import { formatRarityScore, formatScore, rarityScore } from '../../../src/game/dictionary';
import type { Rarity } from '../../../src/game/types';
import { rarityPalette, useTheme } from '../theme/useTheme';
import { useReduceMotion } from './ConfettiBurst';

/**
 * The tier name is spelled out beside the colour, never instead of it.
 *
 * The same reasoning as the website's badge: a player reading in greyscale, or
 * one who cannot separate the purple from the blue, gets the identical
 * information a sighted player does. The dot reinforces the colour; it is not a
 * second channel carrying meaning of its own.
 */
const RARITY_TAG: Record<Rarity, string> = {
  Quotidian: 'QUOTIDIAN',
  Common: 'COMMON',
  Uncommon: 'UNCOMMON',
  Rare: 'RARE',
  'Extremely Rare': 'EXTREMELY RARE',
  Elusive: 'ELUSIVE',
  Mythic: 'MYTHIC',
  Legend: 'LEGEND',
};

/**
 * The halo around the dot from Extremely Rare up, as the website's
 * `box-shadow: 0 0 0 3px` -- the rarer the tier, the stronger the ring. The
 * frozen orange Legend takes Legend's.
 */
const DOT_RING: Partial<Record<Rarity, number>> = {
  'Extremely Rare': 0.25,
  Elusive: 0.28,
  Mythic: 0.28,
  Legend: 0.32,
};

/** How long a score takes to roll up to its value (the website's ROLL_MS). */
const ROLL_MS = 750;

/** `#rrggbb` at `alpha`, for the website's `color-mix(... transparent)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
  rarity: Rarity;
  /** Measured Zipf frequency, shown as the rarity score the game plays on. */
  zipf?: number;
  /** The puzzle's date, so both the score and the palette match the day it was played. */
  date?: string;
  /**
   * Just scored: the badge pops in, its number rolls up to the score, and an
   * Elusive gets one pass of the sheen that Mythic and Legend keep for good.
   */
  fresh?: boolean;
}

export function RarityBadge({ rarity, zipf, date, fresh = false }: Props) {
  const theme = useTheme();
  const reduced = useReduceMotion();
  const palette = rarityPalette(theme, rarity, date);
  const ring = DOT_RING[rarity];

  // The website's badge-pop: in from 40%, overshooting to 118%, then settling.
  const [pop] = useState(() => new Animated.Value(fresh ? 0 : 1));
  useEffect(() => {
    if (!fresh) return;
    const run = Animated.timing(pop, {
      toValue: 1,
      duration: 600,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [fresh, pop]);

  // Mythic and up shimmer for good; an Elusive only once, as it is scored, so a
  // log full of 9s does not shimmer and a looping sheen stays the mark of the
  // top of the ladder.
  const sheen = rarity === 'Mythic' || rarity === 'Legend' ? 'loop' : rarity === 'Elusive' && fresh ? 'once' : null;

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: palette.bg },
        fresh && {
          opacity: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
          transform: [
            {
              scale: pop.interpolate({
                inputRange: [0, 0.6, 1],
                outputRange: [0.4, 1.18, 1],
              }),
            },
          ],
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        zipf === undefined ? rarity : `${rarity}, score ${formatRarityScore(zipf, date)}`
      }
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: palette.dot },
          ring !== undefined && { boxShadow: `0 0 0 3px ${withAlpha(palette.dot, ring)}` },
        ]}
      />
      <Text style={[styles.tag, { color: palette.fg }]}>{RARITY_TAG[rarity]}</Text>
      {zipf !== undefined && (
        <Text style={[styles.score, { color: palette.fg }]}>
          {'· '}
          {fresh && !reduced ? (
            <RollingScore zipf={zipf} date={date} />
          ) : (
            formatRarityScore(zipf, date)
          )}
        </Text>
      )}
      {sheen && !reduced && <Sheen loop={sheen === 'loop'} />}
    </Animated.View>
  );
}

/** The score rolling up to its value over ROLL_MS: the slot-reel count. */
function RollingScore({ zipf, date }: { zipf: number; date: string | undefined }) {
  const target = rarityScore(zipf, date);
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = Date.now();
    const step = () => {
      const progress = (Date.now() - start) / ROLL_MS;
      setValue(rollingValue(target, progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{formatScore(value, date)}</>;
}

/**
 * The website's badge sheen: a soft white band sweeping across the pill, 3.2s a
 * pass with the sweep in its first 40%, starting 0.6s in. Clipped by the badge.
 */
function Sheen({ loop }: { loop: boolean }) {
  const [width, setWidth] = useState(0);
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const pass = Animated.sequence([
      Animated.timing(sweep, {
        toValue: 1,
        duration: 3200 * 0.4,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(3200 * 0.6),
      Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]);
    const run = Animated.sequence([
      Animated.delay(600),
      loop
        ? Animated.loop(pass)
        : Animated.timing(sweep, {
            toValue: 1,
            duration: 3200 * 0.4,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
    ]);
    run.start();
    return () => run.stop();
  }, [loop, sweep]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.sheen,
          {
            transform: [
              {
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-1.2 * width, 1.2 * width],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const REM = 16;

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 0.35 * REM,
    paddingTop: 0.32 * REM,
    paddingBottom: 0.32 * REM,
    paddingRight: 0.6 * REM,
    paddingLeft: 0.5 * REM,
    borderRadius: 999,
    overflow: 'hidden',
  },
  dot: {
    width: 0.5 * REM,
    height: 0.5 * REM,
    borderRadius: 999,
  },
  tag: {
    fontSize: 0.68 * REM,
    fontWeight: '800',
    letterSpacing: 0.68 * REM * 0.04,
  },
  score: {
    fontSize: 0.68 * REM,
    fontWeight: '700',
    letterSpacing: 0.68 * REM * 0.04,
    opacity: 0.7,
    fontVariant: ['tabular-nums'],
  },
  sheen: {
    experimental_backgroundImage:
      'linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.55) 50%, transparent 65%)',
  },
});
