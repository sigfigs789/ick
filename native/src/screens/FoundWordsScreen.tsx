import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDateLabel, todayDateString } from '../../../src/game/date';
import { dropForDate } from '../../../src/game/drop';
import {
  feedFloor,
  fetchFoundWords,
  repriceFoundWords,
  type FetchOptions,
  type FoundWord,
} from '../../../src/game/leaderboard';
import { pageCache } from '../../../src/game/pageCache';
import { useGameMode } from '../../../src/hooks/useGameMode';
import { useWordDataLoaded } from '../../../src/hooks/useWordDataLoaded';
import {
  BackToPuzzle,
  PAGE_GUTTER,
  PageHead,
  PageNote,
  PagerArrows,
  PlaceholderRow,
  StatusLine,
} from '../components/PageChrome';
import { RarityBadge } from '../components/RarityBadge';
import { useAppState } from '../hooks/useAppState';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * How often today's finds are re-read while the screen is open: the website's
 * fifteen seconds. Only today's -- a closed day's finds do not change.
 */
const REFRESH_MS = 15_000;

/** A placeholder's height, standing in for one find's row. */
const ROW_HEIGHT = 30.4;

/**
 * Every day this visit has read, so stepping back to one -- or coming back to
 * the tab from the puzzle -- is instant (see game/pageCache.ts).
 */
const wordsCache = pageCache<readonly FoundWord[]>();

/**
 * Everything anybody turned up for a drop, rarest first.
 *
 * A port of the website's FoundWordsPage, drawn as src/index.css draws it: the
 * day and its drop in the title, a day at a time under a pair of arrows, and
 * each find as its word, its badge, and how many players found it.
 *
 * The feed holds both modes' finds, and each word is priced by the rules of the
 * mode the reader is in (`repriceFoundWords`). Until the rejection metadata and
 * the deferred scoring data are in, a word priced off an estimate would show
 * the wrong score, so their arrival re-prices the list as well.
 *
 * It bottoms out earlier than the boards do: finds only go back to when the
 * finds table started recording (`feedFloor`).
 */
export function FoundWordsScreen({ onPlay }: { onPlay?: () => void } = {}) {
  const theme = useTheme();

  // Fixed once, like the boards': read fresh on every render, a feed left open
  // across midnight would decide the reader had stepped into the future.
  const [today] = useState(todayDateString);
  const [viewing, setViewing] = useState(today);
  const [floor] = useState(feedFloor);
  const [words, setWords] = useState<readonly FoundWord[]>(() => wordsCache.get(today) ?? []);
  const [feedState, setFeedState] = useState<LoadState>(() => (wordsCache.has(today) ? 'ready' : 'loading'));
  const [pulling, setPulling] = useState(false);
  const isToday = viewing === today;

  const [mode] = useGameMode();
  const metadataLoaded = useWordDataLoaded();
  const priced = useMemo(
    () => repriceFoundWords(words),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` and `metadataLoaded` are triggers
    [words, mode, metadataLoaded],
  );

  /** The day on screen, for a response to check it is still wanted. */
  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);

  const refreshWords = useCallback(
    (options: FetchOptions = {}) => {
      const date = viewing;
      return fetchFoundWords(date, options)
        .then((found) => {
          wordsCache.set(date, found);
          if (viewingRef.current !== date) return;
          setWords(found);
          setFeedState('ready');
        })
        .catch(() => {
          if (viewingRef.current !== date) return;
          // A refresh that fails over a list already on screen leaves it there.
          setFeedState((was) => (was === 'loading' ? 'error' : was));
        });
    },
    [viewing],
  );

  /*
   * Step to another day, in the same render: the outgoing day's words go with
   * it, so yesterday's finds never sit under today's title for the length of a
   * request.
   */
  const showDay = useCallback((date: string) => {
    const cached = wordsCache.get(date);
    viewingRef.current = date;
    setViewing(date);
    setWords(cached ?? []);
    setFeedState(cached ? 'ready' : 'loading');
  }, []);

  /** How many rows the last list had, so the placeholders hold about its room. */
  const [lastRowCount, setLastRowCount] = useState(words.length);
  if (words.length > 0 && words.length !== lastRowCount) setLastRowCount(words.length);

  useEffect(() => {
    void refreshWords();
  }, [refreshWords]);

  /*
   * Today's finds are re-read every fifteen seconds while the app is in front,
   * and at once when it comes back -- the website's poll, paused while the page
   * is hidden. A day that has closed is read once.
   */
  const [foreground, setForeground] = useState(true);
  useAppState({
    onForeground: () => {
      setForeground(true);
      if (isToday) void refreshWords();
    },
    onBackground: () => setForeground(false),
  });
  useEffect(() => {
    if (!isToday || !foreground) return;
    const timer = setInterval(() => void refreshWords(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [isToday, foreground, refreshWords]);

  const pull = useCallback(async () => {
    setPulling(true);
    await refreshWords({ fresh: true });
    setPulling(false);
  }, [refreshWords]);

  const heading = isToday ? "Today's finds" : `Finds from ${formatDateLabel(viewing)}`;
  const placeholderRows = Math.min(Math.max(lastRowCount, 4), 12);

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={theme.fgMuted} />}
    >
      <PageHead
        // The drop, because without it the list is a pile of unrelated words:
        // `asphyxiate` is just a word until you know the day asked for PHY.
        // Quoted and inline -- part of the sentence the title says.
        title={
          <>
            {heading}{' '}
            <Text style={[styles.drop, { color: theme.fgMuted }]}>
              {'“'}
              {dropForDate(viewing)}
              {'”'}
            </Text>
          </>
        }
        onRefresh={() => void refreshWords({ fresh: true })}
      >
        <PageNote>
          Every word anybody turned up for this drop that the mode you’re in allows, scored by that mode.
        </PageNote>
      </PageHead>

      <View style={styles.feed} accessibilityLabel={heading}>
        <PagerArrows
          unit="day"
          canGoBack={viewing > floor}
          canGoForward={!isToday}
          onBack={() => showDay(addDays(viewing, -1))}
          onForward={() => showDay(addDays(viewing, 1))}
          backLabel="Finds from the day before"
          forwardLabel="Finds from the day after"
        />
        {feedState === 'error' ? (
          <StatusLine
            onRetry={() => {
              setFeedState('loading');
              void refreshWords();
            }}
            retryLabel="Try loading the finds again"
          >
            Couldn't load these finds.
          </StatusLine>
        ) : feedState === 'loading' ? (
          <View style={styles.list} accessibilityLabel="Loading the finds…">
            {Array.from({ length: placeholderRows }, (_, i) => (
              <PlaceholderRow key={i} height={ROW_HEIGHT} />
            ))}
          </View>
        ) : priced.length === 0 ? (
          <StatusLine>
            {isToday ? "Nobody's found anything yet today." : 'Nobody found anything on this puzzle.'}
          </StatusLine>
        ) : (
          <View style={styles.list}>
            {priced.map((found) => (
              <View
                key={found.word}
                style={[styles.item, { borderBottomColor: theme.border }]}
                accessible
                accessibilityLabel={`${found.word}, ${found.rarity}${
                  found.finders > 1 ? `, ${found.finders} players` : ''
                }`}
              >
                <Text style={[styles.word, { color: theme.fg }]}>{found.word}</Text>
                {/* Dated like the label is, or the number falls back to the
                    newest undated profile while the rank reads the puzzle's. */}
                <RarityBadge rarity={found.rarity} zipf={found.zipf} date={found.foundOn || undefined} />
                {found.finders > 1 && (
                  <Text style={[styles.finders, { color: theme.fgFaint }]}>{found.finders} players</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      {onPlay && <BackToPuzzle onPress={onPlay} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  page: {
    paddingHorizontal: PAGE_GUTTER,
    paddingTop: space.xl,
    paddingBottom: space.xxl * 2,
  },
  /* `.found-words__drop`: muted and spaced, never broken across a line. */
  drop: {
    letterSpacing: 1.9,
  },
  feed: {
    marginTop: 16,
  },
  list: {
    marginTop: 11.2,
    gap: 6.4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5.6,
    borderBottomWidth: 1,
  },
  word: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
  },
  finders: {
    fontSize: 11.2,
    fontVariant: ['tabular-nums'],
  },
});
