import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { addDays, formatDateLabel, todayDateString } from '../../../src/game/date';
import { dropForDate } from '../../../src/game/drop';
import { feedFloor, fetchFoundWords, type FoundWord } from '../../../src/game/leaderboard';
import { RarityBadge } from '../components/RarityBadge';
import { StepNav } from '../components/StepNav';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * Everything anybody turned up, newest puzzle first.
 *
 * The companion to the boards and deliberately not the same page: a board row
 * is a *player* and a find is a *word*, they are read for different reasons,
 * and the one people come back through the day for is the words.
 *
 * ## Stepping
 *
 * A day at a time, and nothing is prefetched -- a reader who never presses back
 * costs one request, and the whole archive costs exactly what they walk
 * through.
 *
 * It bottoms out earlier than the boards do. Scores go back to the first puzzle
 * ever played, because a player joining today backfills everything their device
 * remembers; finds only go back to when the finds table started recording
 * (`feedFloor`). Offering a step past that would say nobody found anything on a
 * puzzle that had finders.
 */
export function FoundWordsScreen() {
  const theme = useTheme();

  // Fixed once, like the boards': read fresh on every render, a feed left open
  // across midnight would decide the reader had stepped into the future.
  const [today] = useState(todayDateString);
  const [viewing, setViewing] = useState(today);

  const [words, setWords] = useState<FoundWord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /*
   * The outgoing day's words are cleared in the same render that moves the day,
   * not from an effect afterwards. The label above names a drop and the words
   * under it have to be that drop's -- yesterday's finds sitting under today's
   * letters, for the length of a request, is the one wrong thing this screen
   * could show.
   */
  const [lastViewing, setLastViewing] = useState(viewing);
  if (lastViewing !== viewing) {
    setLastViewing(viewing);
    setWords(null);
  }

  /*
   * Load the day on screen, and again whenever it is stepped.
   *
   * Started and awaited inside the effect so the `cancelled` flag can be closed
   * over: a reader pressing back twice quickly has two requests in flight over
   * two different days, and the first sent is not necessarily the first to
   * answer. See LeaderboardScreen, which does the same for the same reason.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await fetchFoundWords(viewing);
        if (cancelled) return;
        setWords(found);
        setFailed(false);
      } catch {
        if (!cancelled) {
          setWords([]);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  /** Pull to refresh, which on this page is what people actually come back for. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setWords(await fetchFoundWords(viewing, { fresh: true }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setRefreshing(false);
  }, [viewing]);

  // Grouped in the order the server sent them, which is already newest-first:
  // re-sorting here would be this screen inventing an order of its own and
  // quietly disagreeing with the website about which find is the latest.
  const sections = useMemo(() => {
    if (!words) return [];
    const groups: { title: string; data: FoundWord[] }[] = [];
    for (const word of words) {
      const last = groups[groups.length - 1];
      if (last && last.title === word.foundOn) last.data.push(word);
      else groups.push({ title: word.foundOn, data: [word] });
    }
    return groups;
  }, [words]);

  return (
    <View style={styles.fill}>
      {/* The drop beside the date, because a find only means anything next to
          the letters it came out of: "aria" is unremarkable until you know the
          day asked for ARI. */}
      <StepNav
        label={`${viewing === today ? 'Today' : formatDateLabel(viewing)} · ${dropForDate(
          viewing,
        ).toUpperCase()}`}
        unit="day"
        canGoBack={viewing > feedFloor()}
        canGoForward={viewing < today}
        onBack={() => setViewing(addDays(viewing, -1))}
        onForward={() => setViewing(addDays(viewing, 1))}
      />

      {words === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.fgMuted} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.foundOn}:${item.word}`}
          contentContainerStyle={styles.content}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.fgMuted} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.heading, { color: theme.fgMuted }]} accessibilityRole="header">
              {/* Against the real calendar date, not against the day being
                  viewed: stepping back three days should not relabel that day
                  "Today" just because it is the one on screen. */}
              {section.title === today ? 'Today' : formatDateLabel(section.title)}
            </Text>
          )}
          renderItem={({ item }) => (
            <View
              style={[styles.row, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
              accessible
              accessibilityLabel={`${item.word}, ${item.rarity}, found by ${item.finders} ${
                item.finders === 1 ? 'player' : 'players'
              }`}
            >
              <View style={styles.wordBlock}>
                <Text style={[styles.word, { color: theme.fg }]} numberOfLines={1}>
                  {item.word}
                </Text>
                <RarityBadge rarity={item.rarity} zipf={item.zipf} date={item.foundOn} />
              </View>
              <Text style={[styles.finders, { color: theme.fgFaint }]}>
                {item.finders === 1 ? '1 find' : `${item.finders} finds`}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={[styles.message, { color: theme.fgMuted }]}>
              {failed
                ? "Couldn't load the finds. Pull down to try again."
                : 'Nothing found on this puzzle yet.'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl * 2,
    gap: space.sm,
  },
  heading: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  wordBlock: {
    flex: 1,
    gap: space.sm,
  },
  word: {
    fontSize: 17,
    fontWeight: '700',
  },
  finders: {
    fontSize: 11,
    fontWeight: '600',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: space.xxl,
  },
});
