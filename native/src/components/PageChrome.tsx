import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { signalTap } from '../host/feedback';
import type { Theme } from '../theme/tokens';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * The furniture the website's three "look at it" pages share -- the leaderboards,
 * the finds and the stats -- drawn the way src/index.css draws it, so a phone
 * and a browser show the same page rather than two pages about the same thing.
 *
 * Kept apart from StepNav on purpose: StepNav is the puzzle's own compact
 * control, while these are the website's `.page-head`, `.leaderboard__board-arrow`
 * and `.leaderboard-page__back`, which are larger and say their unit out loud.
 */

/**
 * The raised segment of a segmented control (`--segment-on`). Not in the token
 * file because nothing else draws one; white on light is the card colour, and
 * dark lifts a step above the inset track rather than sinking into it.
 */
export function segmentOn(theme: Theme): string {
  return theme.dark ? '#35353a' : '#ffffff';
}

/** The gutter every page sits in, matching the website's phone layout. */
export const PAGE_GUTTER = space.lg;

/**
 * A page's own title, with an optional line under it and the ↻ refresh opposite.
 *
 * The website's `.page-head`: an uppercase display title, and a refresh only on
 * the pages whose content is other people's. The button turns once per press
 * rather than spinning, because it answers a tap and is not a progress bar.
 */
export function PageHead({
  title,
  children,
  onRefresh,
}: {
  /** The title, as a string or with a muted span nested in it (the finds' drop). */
  title: ReactNode;
  /** What sits under the title: a note, or the leaderboard's "Playing as". */
  children?: ReactNode;
  onRefresh?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.head}>
      <View style={styles.headText}>
        <Text style={[styles.title, { color: theme.fg }]} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
      {onRefresh && <RefreshButton onPress={onRefresh} />}
    </View>
  );
}

/** The grey line under a page title (`.page-head__note`). */
export function PageNote({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.note, { color: theme.fgMuted }]}>{children}</Text>;
}

function RefreshButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const [turn] = useState(() => new Animated.Value(0));
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      onPress={() => {
        if (busy) return;
        signalTap();
        setBusy(true);
        onPress();
        turn.setValue(0);
        // Long enough to read as a response to the tap, and it ends on its own
        // rather than on the request -- the website's 600ms.
        Animated.timing(turn, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(() => setBusy(false));
      }}
      accessibilityRole="button"
      accessibilityLabel="Refresh"
      hitSlop={space.xs}
      style={({ pressed }) => [
        styles.iconButton,
        {
          borderColor: theme.border,
          backgroundColor: pressed ? theme.bgInset : theme.cardBg,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Animated.Text
        style={[
          styles.iconGlyph,
          {
            color: theme.fg,
            transform: [
              { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          },
        ]}
      >
        ↻
      </Animated.Text>
    </Pressable>
  );
}

/**
 * "‹ Previous day" and "Next day ›", one at each edge.
 *
 * The website's `.leaderboard__board-arrow` / `.found-words__arrow`: both always
 * drawn and disabled at the ends rather than removed, so a reader who has
 * stepped back can see that forward exists.
 */
export function PagerArrows({
  unit,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  backLabel,
  forwardLabel,
}: {
  /** What a step moves by, as the buttons say it: "day", "week", "month". */
  unit: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The screen reader's name for each, when it differs from the visible text. */
  backLabel?: string;
  forwardLabel?: string;
}) {
  return (
    <View style={styles.pager}>
      <PagerArrow
        text={`Previous ${unit}`}
        glyph="‹"
        glyphFirst
        disabled={!canGoBack}
        onPress={onBack}
        accessibilityLabel={backLabel ?? `Previous ${unit}`}
      />
      <PagerArrow
        text={`Next ${unit}`}
        glyph="›"
        disabled={!canGoForward}
        onPress={onForward}
        accessibilityLabel={forwardLabel ?? `Next ${unit}`}
      />
    </View>
  );
}

function PagerArrow({
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
      hitSlop={space.xs}
      style={({ pressed }) => [
        styles.arrow,
        {
          borderColor: theme.borderStrong,
          backgroundColor: pressed && !disabled ? theme.accent : theme.bgInset,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        },
      ]}
    >
      {({ pressed }) => {
        const color = pressed && !disabled ? theme.accentFg : theme.fg;
        return (
          <>
            {glyphFirst && <Text style={[styles.arrowGlyph, { color }]}>{glyph}</Text>}
            <Text style={[styles.arrowText, { color }]}>{text}</Text>
            {!glyphFirst && <Text style={[styles.arrowGlyph, { color }]}>{glyph}</Text>}
          </>
        );
      }}
    </Pressable>
  );
}

/** "Back to today's puzzle", closing the two pages about other people's play. */
export function BackToPuzzle({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        signalTap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.back,
        { borderColor: theme.borderStrong, backgroundColor: pressed ? theme.bgInset : theme.cardBg },
      ]}
    >
      <Text style={[styles.backText, { color: theme.fg }]}>Back to today's puzzle</Text>
    </Pressable>
  );
}

/**
 * A grey bar holding the place of a row that is on its way, breathing the way
 * the website's `found-words-pending` does. Decorative: whoever renders these
 * says "Loading" in words beside them.
 */
export function PlaceholderRow({ height }: { height: number }) {
  const theme = useTheme();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[styles.placeholder, { height, backgroundColor: theme.bgInset, opacity: pulse }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * The one-line answer where a list would be: loading, empty, or failed with a
 * retry (`.leaderboard__status` and `.leaderboard__retry`).
 */
export function StatusLine({
  children,
  onRetry,
  retryLabel,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Text style={[styles.status, { color: theme.fgMuted }]} accessibilityLiveRegion="polite">
      {children}
      {onRetry && (
        <>
          {' '}
          <Text
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            style={[styles.retry, { color: theme.fg }]}
          >
            Try again
          </Text>
        </>
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 22,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.96,
    textTransform: 'uppercase',
    lineHeight: 27,
  },
  note: {
    marginTop: 5.6,
    fontSize: 13.6,
    lineHeight: 19,
  },
  iconButton: {
    width: 37.6,
    height: 37.6,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 17.6,
    fontWeight: '700',
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6.4,
  },
  arrow: {
    minHeight: 32,
    paddingVertical: 4,
    paddingHorizontal: 8.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  arrowText: {
    fontSize: 12.2,
    fontWeight: '700',
  },
  arrowGlyph: {
    fontSize: 15,
    lineHeight: 16,
    fontWeight: '700',
  },
  back: {
    alignSelf: 'center',
    marginTop: 25.6,
    borderWidth: 1,
    borderRadius: 9.6,
    paddingVertical: 9.6,
    paddingHorizontal: 19.2,
  },
  backText: {
    fontSize: 14.4,
    fontWeight: '700',
  },
  placeholder: {
    borderRadius: 4.8,
  },
  status: {
    marginVertical: 22.4,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  retry: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
