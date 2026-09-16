import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { addDays, formatDateLabel, todayDateString } from '../../../src/game/date';
import { formatScore, formatTotal } from '../../../src/game/dictionary';
import {
  BOARD_LIMIT,
  dayFloor,
  fetchBoards,
  monthFloor,
  weekFloor,
  type BoardEntry,
  type Boards,
} from '../../../src/game/leaderboard';
import { monthLabel, monthStart, nextMonthStart, previousMonthStart } from '../../../src/game/month';
import { loadPlayerId } from '../../../src/game/player';
import { weekLabel, weekStart } from '../../../src/game/week';
import { StepNav } from '../components/StepNav';
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
 *
 * ## Stepping
 *
 * Each board walks its own axis, and the step is the window's own unit: the
 * daily board moves a day, the weekly seven, the monthly to the first of the
 * month before. A week stepped by one day would be six days of the week you
 * were already reading.
 *
 * The three windows are held separately and sent together, which is what the
 * endpoint takes. Stepping the month back therefore must not disturb the week
 * beside it -- and because each is its own piece of state, it cannot.
 *
 * Every board bottoms out at the window bracketing the first puzzle, because a
 * step past that could only ever produce an empty board.
 */
export function LeaderboardScreen() {
  const theme = useTheme();
  const [window, setWindow] = useState<Window>('daily');

  /*
   * Today, fixed once for the life of the screen.
   *
   * Read again on every render it would be a moving floor: a board left open
   * across midnight would quietly decide the reader had stepped into the
   * future, and the forward arrow would switch itself off under them.
   */
  const [today] = useState(todayDateString);

  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(() => weekStart(today));
  const [month, setMonth] = useState(() => monthStart(today));

  const [boards, setBoards] = useState<Boards | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const playerId = loadPlayerId();

  /*
   * A step means the rows on screen no longer belong to the label above them,
   * so the spinner goes up in the same render that moves the window rather
   * than in an effect afterwards. An effect would paint one frame of the old
   * window's rows under the new window's name first.
   */
  const windowKey = `${day}|${week}|${month}`;
  const [lastWindowKey, setLastWindowKey] = useState(windowKey);
  if (lastWindowKey !== windowKey) {
    setLastWindowKey(windowKey);
    setLoading(true);
  }

  /*
   * Load whichever windows are on screen, and again whenever one is stepped.
   *
   * The request is started and awaited inside the effect rather than through a
   * shared helper, so the `cancelled` flag can be closed over. That matters
   * more here than it looks: a reader pressing back twice quickly has two
   * fetches in flight over two different windows, and the first one to be sent
   * is not necessarily the first to answer. Without the flag the older window's
   * rows could land last and sit under the newer window's label.
   *
   * A board that will not load is worth saying so about and worth nothing more.
   * There is no retry loop, because the pull-to-refresh gesture below happens
   * when somebody actually wants the board, which is the only moment a refresh
   * is worth a request.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchBoards(today, { day, week, month });
        if (cancelled) return;
        setBoards(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, day, week, month]);

  /** Pull to refresh: the reader has seen this board and wants the next one. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setBoards(await fetchBoards(today, { day, week, month, fresh: true }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setRefreshing(false);
  }, [today, day, week, month]);

  const board = boards ? boardFor(boards, window) : null;

  /*
   * What the arrows do, per window.
   *
   * Forward is capped at the window containing today rather than at today
   * itself: the week a reader is in is not over, and refusing to step to it
   * because it has not finished would strand them one week back.
   */
  const stepper = {
    daily: {
      unit: 'day',
      label: day === today ? 'Today' : formatDateLabel(day),
      canGoBack: day > dayFloor(),
      canGoForward: day < today,
      onBack: () => setDay(addDays(day, -1)),
      onForward: () => setDay(addDays(day, 1)),
    },
    weekly: {
      unit: 'week',
      label: weekLabel(week),
      canGoBack: week > weekFloor(),
      canGoForward: week < weekStart(today),
      onBack: () => setWeek(addDays(week, -7)),
      onForward: () => setWeek(addDays(week, 7)),
    },
    monthly: {
      unit: 'month',
      label: monthLabel(month),
      canGoBack: month > monthFloor(),
      canGoForward: month < monthStart(today),
      onBack: () => setMonth(previousMonthStart(month)),
      onForward: () => setMonth(nextMonthStart(month)),
    },
  }[window];

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

      <StepNav
        label={stepper.label}
        unit={stepper.unit}
        canGoBack={stepper.canGoBack}
        canGoForward={stepper.canGoForward}
        onBack={stepper.onBack}
        onForward={stepper.onForward}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.fgMuted} />
        }
      >
        {/* A spinner rather than the outgoing window's rows. The label above
            names a week, and the rows under it have to be that week's -- three
            names from the week you just left, sitting under the heading for the
            week you asked for, is the one wrong thing this screen could show. */}
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.fgMuted} />
          </View>
        )}

        {!loading && failed && (
          <Text style={[styles.message, { color: theme.fgMuted }]}>
            Couldn't load the board. Pull down to try again.
          </Text>
        )}

        {!loading && !failed && board && board.rows.length === 0 && (
          <Text style={[styles.message, { color: theme.fgMuted }]}>
            Nobody scored on this one. Play a word and you'll be first.
          </Text>
        )}

        {!loading &&
          !failed &&
          board?.rows.map((entry) => (
            <Row key={entry.playerId} entry={entry} isYou={entry.playerId === playerId} />
          ))}

        {/* The player's own row, when they rank below the cut -- carrying the
            rank they actually hold. The short board is only safe because of
            this: it got shorter without hiding anybody. */}
        {!loading && !failed && board?.self && (
          <>
            <Text style={[styles.cut, { color: theme.fgFaint }]}>Below the top {BOARD_LIMIT}</Text>
            <Row entry={board.self} isYou />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ entry, isYou }: { entry: BoardEntry; isYou: boolean }) {
  const theme = useTheme();

  /*
   * Two rows are dressed differently, and the gold belongs to the rarer one.
   *
   * Leading the board is what a player is racing for, so rank 1 takes the same
   * gold the crowned best word wears elsewhere, with the trophy standing in for
   * the digit -- rank 1 is what a trophy *means*, so it replaces the number
   * instead of crowding the name. Being yourself is merely where you are, so
   * your own row is the quieter inset grey: enough to find at a glance while
   * scrolling, not enough to look like a prize.
   *
   * Both at once keeps the gold, because top of the board is the rarer thing to
   * be and the row already says "you" beside the name. This is the treatment
   * the website's board has (see `.leaderboard__row--leader` in index.css); the
   * two front-ends showing the same standings should dress them the same way.
   */
  const isLeader = entry.rank === 1;
  const background = isLeader ? theme.bestWordBg : isYou ? theme.bgInset : theme.cardBg;
  const outline = isLeader ? theme.bestWordAccent : theme.border;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: background,
          borderColor: outline,
          borderWidth: isLeader || isYou ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
      accessible
      accessibilityLabel={
        `${isYou ? 'You, ' : ''}rank ${entry.rank}, ${entry.name}, ` +
        `${formatTotal(entry.score)} across ${entry.puzzles} ${entry.puzzles === 1 ? 'puzzle' : 'puzzles'}` +
        `${entry.windowWord ? `, best word ${entry.windowWord}` : ''}`
      }
    >
      {/* The rank itself stays in the row's accessibility label above, because
          "first" is the part a screen reader needs and a trophy glyph is not a
          rank. */}
      <Text style={[styles.rank, { color: theme.fgMuted }]}>
        {isLeader ? '\u{1F3C6}' : entry.rank}
      </Text>

      <View style={styles.who}>
        <Text
          style={[styles.name, isLeader && styles.nameLeader, { color: theme.fg }]}
          numberOfLines={1}
        >
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
        <Text style={[styles.score, isLeader && styles.scoreLeader, { color: theme.fg }]}>
          {formatTotal(entry.score)}
        </Text>
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
    paddingTop: space.sm,
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
  /* A step louder than the rows under it, at the row's own size so nothing
     below it moves. */
  nameLeader: {
    fontWeight: '900',
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
  scoreLeader: {
    fontWeight: '900',
  },
  puzzles: {
    fontSize: 11,
  },
});
