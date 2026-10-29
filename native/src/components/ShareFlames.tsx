import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { flameLevel, type FlameTier } from '../../../src/game/shareFlames';
import type { Theme } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useReduceMotion } from './ConfettiBurst';

/**
 * The tongues along the top edge, one per entry, spread across the button's
 * whole width whatever it is: each one's share of the tier's flame height, a
 * ragged pattern rather than a smooth one so the edge reads as fire, not a
 * crown. The website's own pattern.
 */
const HEIGHTS = [
  0.5, 0.8, 0.6, 0.95, 0.7, 1, 0.65, 0.85, 0.55, 0.9, 1, 0.7, 0.95, 0.6, 0.85, 1, 0.65, 0.9, 0.6, 0.8, 0.5,
];

/** How tall the flames burn at each level, Elusive to Legend: 1rem, 1.35rem, 1.8rem. */
const FLAME_HEIGHT = [16, 21.6, 28.8];
/** How far the flames sink into the button's top edge (0.2rem). */
const OVERLAP = 3.2;
/** A drop's height over its width: a circle with a point a half-diagonal above its centre. */
const DROP_ASPECT = 0.5 + Math.SQRT1_2;

/** A tier's fire, worked out from the website's custom properties (`.share-flames--*`). */
interface FlameColors {
  /** The tier's colour: the top of the fill, the band and the tongues. */
  flame: string;
  /** The hottest part: the foot of the fill and each tongue's heart. */
  core: string;
  /** Between the two, at the foot of the fill's gradient. */
  mid: string;
  /** A tongue's tip, fading out. */
  tip: string;
  /** The glow around the button and the edge of the flames, as `#rrggbb`. */
  halo: string;
  /** The label. */
  text: string;
  textShadow?: string;
}

/** `#rrggbb` as its channels. */
function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** CSS `color-mix(in srgb, a share, b)`, for two `#rrggbb` colours. */
function mix(a: string, share: number, b: string): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const at = (x: number, y: number) => Math.round(x * share + y * (1 - share));
  return `rgb(${at(ar, br)}, ${at(ag, bg)}, ${at(ab, bb)})`;
}

/** A `#rrggbb` colour at `alpha`. */
function fade(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function flameColors(theme: Theme, tier: FlameTier): FlameColors {
  if (tier === 'Legend') {
    // Legend burns white, like its dot, with its badge's black for a halo and
    // its label: the halo carries it on a light page and the white on a dark one.
    const { dot, bg } = theme.rarity.Legend;
    const flame = mix(dot, 0.9, bg);
    return { flame, core: dot, mid: mix(dot, 0.97, bg), tip: fade(dot, 0.8), halo: bg, text: bg };
  }
  const flame = theme.rarity[tier].dot;
  const core = tier === 'Elusive' ? '#fff6c2' : '#ffc04d';
  return {
    flame,
    core,
    mid: mix(flame, 0.7, core),
    tip: fade(flame, 0.8),
    halo: flame,
    text: tier === 'Elusive' ? '#3b2400' : '#ffffff',
    textShadow: tier === 'Mythic' ? 'rgba(80, 0, 0, 0.55)' : undefined,
  };
}

/**
 * A burning Share button's own fill and label: the whole fill turns to fire,
 * hottest at the bottom and the tier's colour at the top, with a glow around
 * it in the same colour. The website's glow breathes and its heat swells; a
 * shadow and a gradient cannot be animated off the JS thread here, so both
 * hold at their middle.
 */
export function shareFlamesStyle(theme: Theme, tier: FlameTier): { button: ViewStyle; text: TextStyle } {
  const { flame, core, mid, halo, text, textShadow } = flameColors(theme, tier);
  return {
    button: {
      backgroundColor: flame,
      experimental_backgroundImage: `radial-gradient(110% 80% at 50% 115%, ${core}, transparent 75%), linear-gradient(to top, ${mid}, ${flame})`,
      boxShadow: `0 0 11px ${fade(halo, 0.7)}`,
    },
    text: {
      color: text,
      ...(textShadow && { textShadowColor: textShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }),
    },
  };
}

/**
 * The flames along a burning Share button's top edge -- a port of the
 * website's ShareFlames: a low band the button's whole width for the tongues to
 * rise out of, and a row of tongues across it in the tier's colour, flickering
 * on staggered timings. They burn taller each tier up, from a low lick at
 * Elusive to a blaze at Legend.
 *
 * The website cuts each tongue from a box with a clip path; React Native has
 * none, so a tongue here is a square with three round corners turned to point
 * its sharp one up, stretched to the tongue's height. Drawn as the button's
 * first child, so it sits over the fill and under the label.
 *
 * Decoration only, so hidden from readers; still for a phone that asked for
 * less motion.
 */
export function ShareFlames({ tier }: { tier: FlameTier }) {
  const theme = useTheme();
  const reduced = useReduceMotion();
  const colors = flameColors(theme, tier);
  const height = FLAME_HEIGHT[flameLevel(tier) - 1];
  const [width, setWidth] = useState(0);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.band, { top: OVERLAP - height, height }]}
    >
      <View
        style={[
          styles.base,
          {
            height: height * 0.35,
            borderTopLeftRadius: height,
            borderTopRightRadius: height,
            backgroundColor: colors.flame,
            boxShadow: `0 0 2.4px ${colors.halo}`,
          },
        ]}
      />
      {width > 0 &&
        HEIGHTS.map((tall, i) => {
          // Spread from edge to edge, the end tongues kept inside the button.
          const w = Math.min(Math.max(height * (0.35 + tall * 0.5), width * 0.065), width * 0.2);
          const x = i / (HEIGHTS.length - 1);
          return (
            <Tongue
              key={i}
              left={x * (width - w)}
              width={w}
              height={tall * height}
              durationMs={600 + tall * 500}
              phaseMs={i * 370}
              still={reduced}
              colors={colors}
            />
          );
        })}
    </View>
  );
}

/** The website's `share-flames-flicker`: swaying and stretching from its base. */
const FLICKER = {
  scaleX: [1, 0.9, 1.05, 0.95, 1],
  scaleY: [1, 1.15, 0.88, 1.08, 1],
  skewX: ['0deg', '-5deg', '4deg', '-2deg', '0deg'],
};

/** Two cycles of a keyframe list, so a loop can start part-way through one. */
function twice<T>(frames: T[]): T[] {
  return [...frames, ...frames.slice(1)];
}

/** Input steps for `twice`: 0 to 2 in quarters. */
const TWICE_INPUT = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function Tongue({
  left,
  width,
  height,
  durationMs,
  phaseMs,
  still,
  colors,
}: {
  left: number;
  width: number;
  height: number;
  durationMs: number;
  /** How far into its cycle it starts, so neighbours never move in step. */
  phaseMs: number;
  still: boolean;
  colors: FlameColors;
}) {
  const [phase] = useState(() => (phaseMs % durationMs) / durationMs);
  const [t] = useState(() => new Animated.Value(phase));
  useEffect(() => {
    if (still) return;
    const run = Animated.loop(
      Animated.timing(t, { toValue: phase + 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    run.start();
    return () => run.stop();
  }, [t, phase, durationMs, still]);
  const at = (frames: number[]) => t.interpolate({ inputRange: TWICE_INPUT, outputRange: twice(frames) });
  const skew = t.interpolate({ inputRange: TWICE_INPUT, outputRange: twice(FLICKER.skewX) });
  return (
    <Animated.View
      style={[
        styles.tongue,
        {
          left,
          width,
          height,
          transform: still
            ? []
            : [{ scaleX: at(FLICKER.scaleX) }, { scaleY: at(FLICKER.scaleY) }, { skewX: skew }],
        },
      ]}
    >
      <Drop width={width} height={height} color={colors.flame} tip={colors.tip} halo={colors.halo} />
      {/* The hot core: a smaller, lighter tongue low in the middle. */}
      <View style={[styles.core, { left: width * 0.3, width: width * 0.4, height: height * 0.55 }]}>
        <Drop width={width * 0.4} height={height * 0.55} color={colors.core} />
      </View>
    </Animated.View>
  );
}

/**
 * A teardrop pointing up, `width` by `height`, sitting on its box's bottom
 * edge: a square with three round corners, turned so the sharp one is on top,
 * then stretched from its base to the height asked for.
 */
function Drop({
  width,
  height,
  color,
  tip,
  halo,
}: {
  width: number;
  height: number;
  color: string;
  /** Fades the drop out towards its point. */
  tip?: string;
  /** A soft edge in this colour. */
  halo?: string;
}) {
  const natural = width * DROP_ASPECT;
  return (
    <View
      style={[
        styles.drop,
        { width, height: natural, transform: [{ scaleY: height / natural }] },
      ]}
    >
      <View
        style={[
          styles.square,
          {
            width,
            height: width,
            borderRadius: width / 2,
            backgroundColor: color,
          },
          // The point is the square's top-left corner, so "up" is 315deg once turned.
          tip !== undefined && { experimental_backgroundImage: `linear-gradient(315deg, ${tip}, ${color} 65%)` },
          halo !== undefined && { boxShadow: `0 0 2.4px ${halo}` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /* .share-flames: the fire along the top edge. */
  band: {
    position: 'absolute',
    left: 2.4,
    right: 2.4,
  },
  /* .share-flames::before: the band the tongues rise out of. */
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tongue: {
    position: 'absolute',
    bottom: 0,
    transformOrigin: 'bottom',
  },
  core: {
    position: 'absolute',
    bottom: 0,
  },
  drop: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    transformOrigin: 'bottom',
  },
  square: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    borderTopLeftRadius: 0,
    transform: [{ rotate: '45deg' }],
  },
});
