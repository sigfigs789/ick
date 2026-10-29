import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDateLabel } from '../../../src/game/date';
import { formatRarityScore } from '../../../src/game/dictionary';
import { dropForDate } from '../../../src/game/drop';
import { handleFor } from '../../../src/game/handle';
import { loadPlayerId, selfName } from '../../../src/game/player';
import { finderTotal, orderedFinders, otherPlayers } from '../../../src/game/yesterdaysBest';
import { useYesterdaysBest } from '../../../src/hooks/useYesterdaysBest';
import { signalTap } from '../host/feedback';
import { rarityPalette, useTheme } from '../theme/useTheme';

/** The website's --ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1). */
const EASE_STANDARD = Easing.bezier(0.2, 0.8, 0.2, 1);

interface Props {
  /** The puzzle being played; the line reports the day before it. */
  date: string;
  /**
   * Whether that puzzle is today's, so the day before is "Yesterday". On an
   * archived puzzle the day before is named by its date instead.
   */
  isToday: boolean;
  /**
   * Whether the line draws the footnotes' divider over itself. False when the
   * come-back line sits above it, which then wears the divider for both (see
   * PlayScreen's footnotes).
   */
  divided?: boolean;
}

/**
 * The rarest word anybody found on the previous day's drop, as a footnote at
 * the foot of the play screen -- a port of the website's line, logic and all.
 *
 * The previous day's drop is not this one, so naming its best word spoils
 * nothing here -- it shows the ceiling players actually reached, which is the
 * thing to beat. Priced by the reader's own mode like the finds tab, so the
 * score here and the badge there agree.
 *
 * Which word that is, ties and all, is worked out by the website's own
 * `useYesterdaysBest`.
 *
 * Names the finders once they arrive -- the reader first, when they were one:
 * one or two by name, and for three or more the first and "N other players",
 * which opens the rest as a list. Falls back to a bare count if they can't be
 * read.
 *
 * Says nothing at all while loading, on a failed read, or for a day nobody
 * found anything: a spinner or an error under the guesses would be louder than
 * the line itself. Held back until the finders have answered too, so it fades
 * in once, whole, rather than gaining its "Found by" a beat later and
 * reflowing.
 */
export function YesterdaysBest({ date, isToday, divided = true }: Props) {
  const theme = useTheme();
  const yesterday = addDays(date, -1);
  // Which word, ties and all, and its finders: the website's own hook, which
  // the news card over the puzzle reads too -- one request answers both.
  const resolved = useYesterdaysBest(yesterday);

  // Which word's list of other finders is open, so another day's starts shut.
  const [openFor, setOpenFor] = useState<string | undefined>();

  if (!resolved) return null;

  const { best, finderIds } = resolved;
  const findersKey = `${yesterday}:${best.word}`;

  const selfId = loadPlayerId()?.toLowerCase() ?? null;
  const ids = finderIds ? orderedFinders(finderIds, selfId) : [];
  const total = finderIds ? finderTotal(finderIds, best.finders) : best.finders;
  const nameOf = (id: string) => (id === selfId ? selfName(id) : handleFor(id));
  const open = openFor === findersKey;
  // Ids past the server's cap, or not yet read when the count was taken.
  const unlisted = total - ids.length;

  let foundBy: ReactNode;
  if (ids.length === 0) {
    foundBy = `Found by ${total} ${total === 1 ? 'player' : 'players'}`;
  } else if (total === 1) {
    foundBy = `Found by ${nameOf(ids[0])}`;
  } else if (total === 2 && ids.length === 2) {
    foundBy = `Found by ${nameOf(ids[0])} and ${nameOf(ids[1])}`;
  } else if (total === 2) {
    foundBy = `Found by ${nameOf(ids[0])} and ${otherPlayers(1)}`;
  } else {
    foundBy = (
      <>
        Found by {nameOf(ids[0])} and{' '}
        <Text
          style={[styles.others, { color: open ? theme.fg : theme.fgMuted }]}
          onPress={() => {
            signalTap();
            setOpenFor(open ? undefined : findersKey);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          suppressHighlighting
        >
          {otherPlayers(total - 1)}
        </Text>
      </>
    );
  }

  const scoreDate = best.foundOn || yesterday;
  const palette = rarityPalette(theme, best.rarity, scoreDate);
  return (
    // Keyed by day, so stepping to another puzzle fades the new line in afresh.
    <FadeIn
      key={yesterday}
      style={[styles.line, divided && [styles.divided, { borderTopColor: theme.border }]]}
    >
      <Text style={[styles.text, { color: theme.fgMuted }]}>
        {isToday ? 'Yesterday' : formatDateLabel(yesterday)}'s best for “{dropForDate(yesterday)}”{'  '}
        <Text style={[styles.word, { color: theme.fg }]}>{best.word.toLowerCase()}</Text>
        {'  '}
        {/* The score beside its tier's dot, without the badge; the tier is
            named for a screen reader. */}
        <Text
          style={[styles.score, { color: theme.fg }]}
          accessibilityLabel={`${formatRarityScore(best.zipf, scoreDate)} ${best.rarity}`}
        >
          {/* A glyph rather than a View: iOS does not draw a View nested in Text. */}
          <Text style={[styles.dot, { color: palette.dot }]}>●</Text>
          {' '}
          {formatRarityScore(best.zipf, scoreDate)}
        </Text>
        {'  '}
        <Text style={{ color: theme.fgFaint }}>{foundBy}</Text>
      </Text>
      {open && (
        <FadeIn duration={300} style={styles.list}>
          {ids.slice(1).map((id) => (
            <Text key={id} style={[styles.text, { color: theme.fgFaint }]}>
              {nameOf(id)}
            </Text>
          ))}
          {unlisted > 0 && (
            <Text style={[styles.text, { color: theme.fgFaint }]}>and {unlisted} more</Text>
          )}
        </FadeIn>
      )}
    </FadeIn>
  );
}

/** The website's `yesterdays-best-in`: fading in, drifting down into place. */
function FadeIn({
  duration = 450,
  style,
  children,
}: {
  duration?: number;
  style: React.ComponentProps<typeof View>['style'];
  children: ReactNode;
}) {
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(enter, {
      toValue: 1,
      duration,
      easing: EASE_STANDARD,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [enter, duration]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: {
    alignItems: 'center',
  },
  /* .page-footnotes, when this line is the only footnote. */
  divided: {
    marginTop: 20,
    marginBottom: 16,
    paddingTop: 14.4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 13.1,
    lineHeight: 20,
    textAlign: 'center',
  },
  word: {
    fontWeight: '800',
  },
  score: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    fontSize: 10,
  },
  others: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 12,
    rowGap: 3.2,
    marginTop: 5.6,
  },
});
