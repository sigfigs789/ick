import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { todayDateString } from '../../../src/game/date';
import { formatScore } from '../../../src/game/dictionary';
import {
  BOARD_LIMIT,
  fetchBoards,
  type BoardEntry,
  type Boards,
} from '../../../src/game/leaderboard';
import { loadPlayerId } from '../../../src/game/player';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Window = 'daily' | 'weekly' | 'monthly';

const TABS: { key: Window; label: string }[] = [
  { key: 'daily', label: 'Today' },
  { key: 'weekly', label: 'This week' },
  { key: 'monthly', label: 'This month' },
];

/** The rows and the player's own row, for one window. */
function boardFor(boards: Boards, window: Window): { rows: BoardEntry[]; self: BoardEntry | null } {
  if (window === 'daily') return { rows: boards.daily, self: boards.dailySelf };
  if (window === 'weekly') return { rows: boards.weekly, self: boards.weeklySelf };
  return { rows: boards.monthly, self: boards.monthlySelf };
}

/**
 * Where today's score put you.
 *
 * Three windows rather than one: a month's board is mostly settled by the time
 * anyone looks at it, while today's is a single puzzle everybody starts level
 * on -- which is the one a player can actually enter from nothing. Today is
 * therefore the tab it opens on.
 *
 * The rows come from the website's own endpoint through the website's own
 * client, so a phone player and a browser player are on the same board rather
 * than on two boards that happen to look alike.
 */
export function LeaderboardScreen() {
  const theme = useTheme();
  const [window, setWindow] = useState<Window>('daily');
  const [boards, setBoards] = useState<Boards | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const playerId = loadPlayerId();

  /*
   * The first load, and the only one that is not asked for.
   *
   * The request is started and awaited inside the effect rather than through a
   * shared helper, so the `cancelled` flag can be closed over: a reader who
   * opens the boards and switches tab before the network answers would
   * otherwise have a late response write into a screen that is gone.
   *
   * A board that will not load is worth saying so about and worth nothing
   * more. There is no retry loop, because the pull-to-refresh gesture below is
   * a better retry than any timer -- it happens when somebody actually wants
   * the board, which is the only moment a refresh is worth a request.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchBoards(todayDateString(), { fresh: false });
        if (cancelled) return;
        setBoards(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Pull to refresh: the reader has seen this board and wants the next one. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setBoards(await fetchBoards(todayDateString(), { fresh: true }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setRefreshing(false);
  }, []);

  const board = boards ? boardFor(boards, window) : null;

  return (
    <View style={styles.fill}>
      <View style={[styles.tabs, { borderColor: theme.border, backgroundColor: theme.bgInset }]}>
        {TABS.map((tab) => {
          const current = tab.key === window;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setWindow(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: current }}
              style={[styles.tab, current && { backgroundColor: theme.cardBg }]}
            >
              <Text style={[styles.tabText, { color: current ? theme.fg : theme.fgMuted }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.fgMuted} />
        }
      >
        {boards === null && !failed && (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.fgMuted} />
          </View>
        )}

        {failed && boards === null && (
          <Text style={[styles.message, { color: theme.fgMuted }]}>
            Couldn't load the board. Pull down to try again.
          </Text>
        )}

        {board && board.rows.length === 0 && (
          <Text style={[styles.message, { color: theme.fgMuted }]}>
            Nobody has scored on this one yet. Play a word and you'll be first.
          </Text>
        )}

        {board?.rows.map((entry) => (
          <Row key={entry.playerId} entry={entry} isYou={entry.playerId === playerId} />
        ))}

        {/* The player's own row, when they rank below the cut -- carrying the
            rank they actually hold. The short board is only safe because of
            this: it got shorter without hiding anybody. */}
        {board?.self && (
          <>
            <Text style={[styles.cut, { color: theme.fgFaint }]}>
              Below the top {BOARD_LIMIT}
            </Text>
            <Row entry={board.self} isYou />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ entry, isYou }: { entry: BoardEntry; isYou: boolean }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: isYou ? theme.bestWordBg : theme.cardBg,
          borderColor: isYou ? theme.bestWordAccent : theme.border,
          borderWidth: isYou ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
      accessible
      accessibilityLabel={
        `${isYou ? 'You, ' : ''}rank ${entry.rank}, ${entry.name}, ` +
        `${formatScore(entry.score)} across ${entry.puzzles} ${entry.puzzles === 1 ? 'puzzle' : 'puzzles'}` +
        `${entry.windowWord ? `, best word ${entry.windowWord}` : ''}`
      }
    >
      <Text style={[styles.rank, { color: theme.fgMuted }]}>{entry.rank}</Text>

      <View style={styles.who}>
        <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
          {entry.name}
          {isYou && <Text style={{ color: theme.fgMuted }}> · you</Text>}
        </Text>
        {entry.windowWord ? (
          <Text style={[styles.word, { color: theme.fgMuted }]} numberOfLines={1}>
            {entry.windowWord} · {formatScore(entry.windowScore)}
          </Text>
        ) : null}
      </View>

      <View style={styles.scoreBlock}>
        <Text style={[styles.score, { color: theme.fg }]}>{formatScore(entry.score)}</Text>
        <Text style={[styles.puzzles, { color: theme.fgFaint }]}>
          {entry.puzzles} {entry.puzzles === 1 ? 'puzzle' : 'puzzles'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    margin: space.lg,
    marginBottom: 0,
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    padding: space.lg,
    paddingBottom: space.xxl * 2,
    gap: space.sm,
  },
  centered: {
    paddingVertical: space.xxl,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  cut: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
    paddingTop: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  rank: {
    minWidth: 24,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  who: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  word: {
    fontSize: 12,
  },
  scoreBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  score: {
    fontSize: 16,
    fontWeight: '800',
  },
  puzzles: {
    fontSize: 11,
  },
});
