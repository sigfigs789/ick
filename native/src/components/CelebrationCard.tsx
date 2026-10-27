import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useReduceMotion } from './ConfettiBurst';

/** The website's springy entrance, cubic-bezier(0.2, 1.4, 0.4, 1). */
const SPRING_IN = Easing.bezier(0.2, 1.4, 0.4, 1);

/** The website's --card-shadow, in each theme. */
export function cardShadow(dark: boolean): string {
  return dark
    ? '0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 28px rgba(0, 0, 0, 0.35)'
    : '0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)';
}

interface Props {
  /** The ring's colour, as an `hsl(h, s%, l%)` triple: "140, 58%, 42%". */
  accent: string;
  /** The emoji over the title; `centerpiece` replaces it (the achievement's medal). */
  icon?: string;
  centerpiece?: ReactNode;
  /** A small line above everything else ("Achievement unlocked"). */
  eyebrow?: ReactNode;
  /** The icon hops twice once the card has landed (the improving average and the climb). */
  hop?: boolean;
  /** Which way the card arrives from: up from below, or down from above. */
  from: 'below' | 'above';
  /** How long the entrance takes, in ms. */
  enterMs: number;
  title?: string;
  /** The body line, already styled; see `Highlight` and `Tally`. */
  children?: ReactNode;
  /** A muted line under the body ("It's on your Stats page."). */
  footnote?: string;
  onDone: () => void;
}

/**
 * The card the website floats over the puzzle for its header celebrations --
 * a perfect month, a longest streak yet, an improving average, a climb up the
 * streak board, yesterday's best word and an achievement unlocked
 * (`.perfect-month` and `.improvement` in index.css): a ringed card near the
 * top of the screen, which stays until its × is tapped.
 *
 * Floats over the puzzle rather than taking it over: the player may be
 * mid-guess, and a modal they had to close before their next word would be a
 * celebration in the way.
 */
export function CelebrationCard({
  accent,
  icon,
  centerpiece,
  eyebrow,
  hop = false,
  from,
  enterMs,
  title,
  children,
  footnote,
  onDone,
}: Props) {
  const theme = useTheme();
  const reduced = useReduceMotion();
  const { width } = useWindowDimensions();
  const [enter] = useState(() => new Animated.Value(0));
  const [bounce] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // The icon's hop: 900ms, twice, starting 420ms in, as the card lands.
    const hopOnce = Animated.sequence([
      Animated.timing(bounce, {
        toValue: 1,
        duration: 450,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(bounce, {
        toValue: 0,
        duration: 450,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    const run = Animated.parallel([
      Animated.timing(enter, {
        toValue: 1,
        duration: enterMs,
        easing: SPRING_IN,
        useNativeDriver: true,
      }),
      ...(hop ? [Animated.sequence([Animated.delay(420), Animated.loop(hopOnce, { iterations: 2 })])] : []),
    ]);
    run.start();
    return () => run.stop();
  }, [enter, bounce, enterMs, hop]);

  const offset = from === 'below' ? 24 : -24;
  const motion = reduced
    ? undefined
    : {
        opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' as const }),
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
        ],
      };

  const iconNode =
    icon === undefined ? null : (
      <Animated.Text
        style={[
          styles.icon,
          hop &&
            !reduced && {
              transform: [
                { translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -6.4] }) },
                { rotate: bounce.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-8deg'] }) },
                { scale: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
              ],
            },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {icon}
      </Animated.Text>
    );

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Animated.View style={[{ width: Math.min(352, width - 32) }, motion]}>
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: `hsl(${accent})`,
              boxShadow: `${cardShadow(theme.dark)}, 0 0 0 6px hsla(${accent}, 0.18)`,
            },
          ]}
        >
          {/* The only way the card goes: a tap elsewhere on it does nothing. */}
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={12}
            style={styles.close}
          >
            <Text style={[styles.closeGlyph, { color: theme.fgMuted }]}>×</Text>
          </Pressable>
          {eyebrow}
          {centerpiece ?? iconNode}
          {title !== undefined && <Text style={[styles.title, { color: theme.fg }]}>{title}</Text>}
          {children !== undefined && (
            <Text style={[styles.body, { color: theme.fgMuted }]}>{children}</Text>
          )}
          {footnote !== undefined && (
            <Text style={[styles.footnote, { color: theme.fgMuted }]}>{footnote}</Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/** The figure in the body that is the news: the gain, in the card's own colour. */
export function Highlight({ color, children }: { color: string; children: ReactNode }) {
  return <Text style={[styles.highlight, { color }]}>{children}</Text>;
}

/** The before-and-after in the body, in the page's text colour. */
export function Tally({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.tally, { color: theme.fg }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    paddingTop: 20,
    zIndex: 21,
    elevation: 21,
  },
  card: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderRadius: 16,
  },
  close: {
    position: 'absolute',
    top: 6,
    right: 10,
    zIndex: 1,
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 20,
  },
  icon: {
    fontSize: 36,
    lineHeight: 42,
  },
  title: {
    fontSize: 20.8,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    fontSize: 15.2,
    lineHeight: 21,
    textAlign: 'center',
  },
  footnote: {
    marginTop: 3.2,
    fontSize: 12.8,
    textAlign: 'center',
  },
  highlight: {
    fontWeight: '800',
  },
  tally: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
