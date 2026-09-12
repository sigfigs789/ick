import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { formatDateLabel, todayDateString } from '../../../src/game/date';
import { fetchFoundWords, type FoundWord } from '../../../src/game/leaderboard';
import { RarityBadge } from '../components/RarityBadge';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * Everything anybody turned up, newest puzzle first.
 *
 * The companion to the boards and deliberately not the same page: a board row
 * is a *player* and a find is a *word*, they are read for different reasons,
 * and the one people come back through the day for is the words.
 *
 * Grouped by the puzzle a word was found on, because a find only means anything
 * next to the letters it came out of.
 */
export function FoundWordsScreen() {
  const theme = useTheme();
  const [words, setWords] = useState<FoundWord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Started and awaited inside the effect so the `cancelled` flag can be closed
  // over -- a reader who opens the feed and switches tab before the network
  // answers would otherwise have a late response write into a screen that is
  // gone. See LeaderboardScreen, which does the same for the same reason.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await fetchFoundWords(todayDateString(), { fresh: false });
        if (cancelled) return;
        setWords(found);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Pull to refresh, which on this page is what people actually come back for. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setWords(await fetchFoundWords(todayDateString(), { fresh: true }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setRefreshing(false);
  }, []);

  // Grouped in the order the server sent them, which is already newest-first:
  // re-sorting here would be this screen inventing an order of its own and
  // quietly disagreeing with the website about which find is the latest.
  const sections = useMemo(() => {
    if (!words) return [];
    const groups: { title: string; today: boolean; data: FoundWord[] }[] = [];
    for (const word of words) {
      const last = groups[groups.length - 1];
      if (last && last.title === word.foundOn) last.data.push(word);
      else groups.push({ title: word.foundOn, today: word.today, data: [word] });
    }
    return groups;
  }, [words]);

  if (words === null && !failed) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.fgMuted} />
      </View>
    );
  }

  return (
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
          {section.today ? 'Today' : formatDateLabel(section.title)}
        </Text>
      )}
      renderItem={({ item }) => (
        <View
          style={[styles.row, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
          accessible
          accessibilityLabel={
            `${item.word}, ${item.rarity}, found by ${item.finders} ${
              item.finders === 1 ? 'player' : 'players'
            }`
          }
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
            : 'No finds yet. Play a word and it will show up here.'}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: space.lg,
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
