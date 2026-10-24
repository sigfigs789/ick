import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDateLabel } from '../../../src/game/date';
import { formatRarityScore } from '../../../src/game/dictionary';
import { dropForDate } from '../../../src/game/drop';
import { handleFor } from '../../../src/game/handle';
import {
  fetchBestWordWins,
  fetchFoundWords,
  fetchWordFinders,
  repriceFoundWords,
  type FoundWord,
} from '../../../src/game/leaderboard';
import { pageCache } from '../../../src/game/pageCache';
import { loadPlayerId, selfName } from '../../../src/game/player';
import {
  bestCandidates,
  finderTotal,
  orderedFinders,
  otherPlayers,
  pickBest,
} from '../../../src/game/yesterdaysBest';
import { useGameMode } from '../../../src/hooks/useGameMode';
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
}

/**
 * Yesterday's finds, read once a visit: the line comes back with the puzzle
 * after a trip to another tab without asking again. Shares the found-words
 * feed's request, so the CDN answers it from the copy it already holds.
 */
const yesterdayCache = pageCache<readonly FoundWord[]>();

/** The best word's finders, keyed by day and word, kept the same way. */
const findersCache = pageCache<readonly string[]>();

/** A settled tie's winning word, keyed by day and the tied words. */
const tieCache = pageCache<string>();

/**
 * The rarest word anybody found on the previous day's drop, as a footnote at
 * the foot of the play screen -- a port of the website's line, logic and all.
 *
 * The previous day's drop is not this one, so naming its best word spoils
 * nothing here -- it shows the ceiling players actually reached, which is the
 * thing to beat. Priced by the reader's own mode like the finds tab, so the
 * score here and the badge there agree.
 *
 * Two words showing the same top score are a tie, settled by `pickBest`: the
 * word of the player the line has named least often, then the longer word,
 * then a coin toss. If either the finders or the tally of past best words
 * can't be read, the tie falls through to length and the toss rather than
 * holding the line back.
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
export function YesterdaysBest({ date, isToday }: Props) {
  const theme = useTheme();
  const yesterday = addDays(date, -1);
  // The finds as last read, tagged with their day; until this day's arrive,
  // whatever this visit already holds for it.
  const [read, setRead] = useState<{ day: string; words: readonly FoundWord[] } | undefined>();
  const words = read?.day === yesterday ? read.words : yesterdayCache.get(yesterday);
  const [mode] = useGameMode();

  useEffect(() => {
    let current = true;
    fetchFoundWords(yesterday)
      .then((found) => {
        yesterdayCache.set(yesterday, found);
        if (current) setRead({ day: yesterday, words: found });
      })
      .catch(() => {
        // Nothing to say; the cached copy, if any, stays on screen.
      });
    return () => {
      current = false;
    };
  }, [yesterday]);

  const candidates = useMemo(
    () => (words ? bestCandidates(repriceFoundWords(words)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the trigger
    [words, mode],
  );
  const tieKey =
    candidates.length > 1
      ? `${yesterday}:${candidates
          .map((found) => found.word)
          .sort()
          .join(',')}`
      : undefined;
  // The settled tie, tagged with its key like the finders below; one this
  // visit already settled is read straight from the cache.
  const [settled, setTie] = useState<{ key: string; word: string } | undefined>();
  const cachedTie = tieKey ? tieCache.get(tieKey) : undefined;
  const tie = tieKey && cachedTie ? { key: tieKey, word: cachedTie } : settled;

  useEffect(() => {
    if (!tieKey) return;
    let current = true;
    if (tieCache.get(tieKey)) return;
    const tied = candidates;
    void Promise.all([
      Promise.all(
        tied.map((found) =>
          fetchWordFinders(found.word, yesterday)
            .then((ids) => {
              findersCache.set(`${yesterday}:${found.word}`, ids);
              return ids;
            })
            .catch(() => findersCache.get(`${yesterday}:${found.word}`) ?? []),
        ),
      ),
      fetchBestWordWins(yesterday).catch(() => ({}) as Record<string, number>),
    ]).then(([finderLists, wins]) => {
      const holders = new Map<string, string>();
      tied.forEach((found, i) => {
        const first = finderLists[i][0];
        if (first) holders.set(found.word, first.toLowerCase());
      });
      const word = pickBest(tied, yesterday, holders, wins)?.word;
      if (!word) return;
      tieCache.set(tieKey, word);
      if (current) setTie({ key: tieKey, word });
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the tied words
  }, [tieKey]);

  const best = tieKey
    ? tie?.key === tieKey
      ? candidates.find((found) => found.word === tie.word)
      : undefined
    : candidates[0];
  const findersKey = best ? `${yesterday}:${best.word}` : undefined;
  // The finders for the word they were read for: ids null when they couldn't
  // be read. Tagged with their key, so a new word's line never borrows the last
  // word's names while its own are on their way.
  // Until this word's answer arrives, whatever this visit already holds.
  const [answered, setFinders] = useState<
    { key: string; ids: readonly string[] | null } | undefined
  >();
  const cachedIds = findersKey ? findersCache.get(findersKey) : undefined;
  const finders =
    answered?.key === findersKey
      ? answered
      : findersKey && cachedIds
        ? { key: findersKey, ids: cachedIds }
        : undefined;

  useEffect(() => {
    if (!best || !findersKey) return;
    let current = true;
    fetchWordFinders(best.word, yesterday)
      .then((ids) => {
        findersCache.set(findersKey, ids);
        if (current) setFinders({ key: findersKey, ids });
      })
      .catch(() => {
        if (current)
          setFinders({ key: findersKey, ids: findersCache.get(findersKey) ?? null });
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the word
  }, [findersKey]);

  // Which word's list of other finders is open, so another day's starts shut.
  const [openFor, setOpenFor] = useState<string | undefined>();

  if (!best || !finders || finders.key !== findersKey) return null;

  const selfId = loadPlayerId()?.toLowerCase() ?? null;
  const ids = finders.ids ? orderedFinders(finders.ids, selfId) : [];
  const total = finders.ids ? finderTotal(finders.ids, best.finders) : best.finders;
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
    <FadeIn key={yesterday} style={[styles.line, { borderTopColor: theme.border }]}>
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
    marginTop: 20,
    marginBottom: 16,
    paddingTop: 14.4,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
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
