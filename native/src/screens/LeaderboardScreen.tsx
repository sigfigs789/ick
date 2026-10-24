import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDateLabel, todayDateString } from '../../../src/game/date';
import { formatScore, formatTotal } from '../../../src/game/dictionary';
import {
  dayFloor,
  fetchBoards,
  monthFloor,
  weekFloor,
  type BoardEntry,
  type Boards,
  type FetchOptions,
  type StreakEntry,
} from '../../../src/game/leaderboard';
import type { GameMode } from '../../../src/game/mode';
import {
  MONTH_BEST_DAYS,
  monthLabel,
  monthResetLabel,
  monthStart,
  nextMonthStart,
  previousMonthStart,
} from '../../../src/game/month';
import { pageCache } from '../../../src/game/pageCache';
import { loadPlayerId, selfName } from '../../../src/game/player';
import { rememberStreakRank, streakRankIn } from '../../../src/game/streakClimb';
import { WEEK_BEST_DAYS, weekLabel, weekStart } from '../../../src/game/week';
import { useGameMode } from '../../../src/hooks/useGameMode';
import { CongratsBubble } from '../components/CongratsBubble';
import { RestDayBadge } from '../components/RestDayBadge';
import {
  BackToPuzzle,
  PAGE_GUTTER,
  PageHead,
  PagerArrows,
  PlaceholderRow,
  StatusLine,
  segmentOn,
} from '../components/PageChrome';
import { signalTap } from '../host/feedback';
import { useAppState } from '../hooks/useAppState';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type LoadState = 'loading' | 'ready' | 'error';

/** One of the boards the pills pick: the three windows, and the streak board, which has none. */
type BoardWindow = 'day' | 'week' | 'month' | 'streak';

const BOARD_WINDOWS: { window: BoardWindow; label: string }[] = [
  { window: 'day', label: 'Day' },
  { window: 'week', label: 'Week' },
  { window: 'month', label: 'Month' },
  { window: 'streak', label: 'Streak' },
];

/**
 * How long the app has to have been away before coming back re-reads the
 * boards: the website's five minutes. A glance at another app is not news.
 */
const BOARDS_STALE_MS = 5 * 60_000;

/** The rows a board holds open while its window is on its way. */
const BOARD_PLACEHOLDER_ROWS = 5;

/** A row's height, which is what a placeholder stands in for (`--row-height`). */
const ROW_HEIGHT = 48;

/** The rank column (`2.1rem`) plus the column gap, which the detail line is indented by. */
const RANK_WIDTH = 33.6;
const COLUMN_GAP = 8;

interface Windows {
  day: string;
  week: string;
  month: string;
  /** Which of the two modes' boards those windows were counted on. */
  board: GameMode;
}

function windowKey(board: GameMode, window: string): string {
  return `${board}:${window}`;
}

/**
 * Every window this screen has read, so stepping back to one is instant -- and
 * so is coming back to the tab from the puzzle. Kept per window, as the website
 * keeps them (see LeaderboardPage), because the three boards step separately.
 */
const boardCache = {
  day: pageCache<Pick<Boards, 'daily' | 'dailySelf'>>(),
  week: pageCache<Pick<Boards, 'weekly' | 'weeklySelf' | 'weekStart'>>(),
  month: pageCache<Pick<Boards, 'monthly' | 'monthlySelf'>>(),
  // No window to step, so keyed by the day it was counted up to.
  streak: pageCache<Pick<Boards, 'streak' | 'streakSelf'>>(),
};

function cacheKey(board: GameMode, window: string): string {
  return `${loadPlayerId() ?? ''}:${windowKey(board, window)}`;
}

function remember(windows: Windows, loaded: Boards, today: string) {
  const { board } = windows;
  // The rank the player has now seen themselves at, so the game only
  // celebrates a climb past it (see game/streakClimb.ts).
  rememberStreakRank(streakRankIn(loaded, loadPlayerId()));
  boardCache.streak.set(cacheKey(board, `streak:${today}`), {
    streak: loaded.streak,
    streakSelf: loaded.streakSelf,
  });
  boardCache.day.set(cacheKey(board, windows.day), {
    daily: loaded.daily,
    dailySelf: loaded.dailySelf,
  });
  boardCache.week.set(cacheKey(board, windows.week), {
    weekly: loaded.weekly,
    weeklySelf: loaded.weeklySelf,
    weekStart: loaded.weekStart,
  });
  boardCache.month.set(cacheKey(board, windows.month), {
    monthly: loaded.monthly,
    monthlySelf: loaded.monthlySelf,
  });
}

/** Every board for these windows, if every one of them has been read. */
function recall(windows: Windows, today: string): Boards | null {
  const { board } = windows;
  const day = boardCache.day.get(cacheKey(board, windows.day));
  const week = boardCache.week.get(cacheKey(board, windows.week));
  const month = boardCache.month.get(cacheKey(board, windows.month));
  const streak = boardCache.streak.get(cacheKey(board, `streak:${today}`));
  if (!day || !week || !month || !streak) return null;
  return { ...day, ...week, ...month, ...streak, mode: board };
}

/**
 * What one board is doing: showing the window asked for, waiting for it, or
 * unable to load it -- answered by comparing the window wanted against the one
 * on screen and the one that last failed, as the website does.
 */
function boardState(wanted: string, onScreen: string | undefined, lastFailed: string | undefined): LoadState {
  if (onScreen === wanted) return 'ready';
  if (lastFailed === wanted) return 'error';
  return 'loading';
}

/**
 * The boards: one at a time, picked from a row of pills -- Day, Week, Month,
 * Streak -- under the rules they are kept on.
 *
 * A port of the website's LeaderboardPage, drawn as src/index.css draws it, so
 * a phone player and a browser player read the same page. The rows come from
 * the website's own endpoint through the website's own client, so they are on
 * the same board too rather than on two boards that happen to look alike.
 *
 * Each board walks its own axis, in its own unit: the day board a day, the week
 * seven, the month to the first of the one before. The streak board has no
 * window and does not step. Every board bottoms out at the window bracketing
 * the first puzzle, because a step past that could only show an empty board.
 *
 * What the website does that this does not: your own row does not dock to the
 * screen's edge while it is scrolled out of view (a CSS `position: sticky`
 * nicety with no direct equivalent in a ScrollView). It is still marked, and
 * still last below the cut when you rank outside it.
 */
export function LeaderboardScreen({ onPlay }: { onPlay?: () => void } = {}) {
  const theme = useTheme();

  /*
   * Today, fixed once for the life of the screen. Read again on every render it
   * would be a moving floor: a board left open across midnight would quietly
   * decide the reader had stepped into the future.
   */
  const [today] = useState(todayDateString);
  const thisWeek = weekStart(today);
  const thisMonth = monthStart(today);
  const [board] = useGameMode();

  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(thisWeek);
  const [month, setMonth] = useState(thisMonth);

  const [boards, setBoards] = useState<Boards | null>(() =>
    recall({ day: today, week: thisWeek, month: thisMonth, board }, today),
  );
  const [state, setState] = useState<LoadState>(() => (boards ? 'ready' : 'loading'));
  /** The windows the boards on screen are about. */
  const [shown, setShown] = useState<Windows | null>(() =>
    boards ? { day: today, week: thisWeek, month: thisMonth, board } : null,
  );
  /** The windows of the last request that failed, so only that board says so. */
  const [failed, setFailed] = useState<Windows | null>(null);
  const [visibleBoard, setVisibleBoard] = useState<BoardWindow>('day');
  const [pulling, setPulling] = useState(false);

  const dayIsLive = day === today;
  const weekIsLive = week === thisWeek;
  const monthIsLive = month === thisMonth;
  const keyOf = (windows: Windows | null, window: 'day' | 'week' | 'month') =>
    windows ? windowKey(windows.board, windows[window]) : undefined;
  const dayState = boardState(windowKey(board, day), keyOf(shown, 'day'), keyOf(failed, 'day'));
  const weekState = boardState(windowKey(board, week), keyOf(shown, 'week'), keyOf(failed, 'week'));
  const monthState = boardState(windowKey(board, month), keyOf(shown, 'month'), keyOf(failed, 'month'));

  const playerId = loadPlayerId();
  const boardsReadAt = useRef(0);
  /*
   * Which request is the latest. A reader pressing back twice quickly has two in
   * flight over two windows, and the first sent is not necessarily the first to
   * answer; only the latest is allowed onto the screen.
   */
  const boardsRequest = useRef(0);

  /*
   * A step puts the window's boards up at once if this visit has read them --
   * a reader stepping back and forward is looking for something they have just
   * seen -- and in the same render that moves the window, so there is never a
   * frame of the old window's rows under the new window's heading. Anything not
   * cached shows its placeholders until the request below lands.
   */
  const windowsKey = `${board}|${day}|${week}|${month}`;
  const [lastWindowsKey, setLastWindowsKey] = useState(windowsKey);
  if (lastWindowsKey !== windowsKey) {
    setLastWindowsKey(windowsKey);
    const cached = recall({ day, week, month, board }, today);
    if (cached) {
      setBoards(cached);
      setShown({ day, week, month, board });
      setState('ready');
    }
    setFailed(null);
  }

  /** Ask for these windows; only the latest request is allowed onto the screen. */
  const request = useCallback(
    (windows: Windows) => {
      const cached = recall(windows, today) !== null;
      const asked = ++boardsRequest.current;
      fetchBoards(today, { day: windows.day, week: windows.week, month: windows.month, mode: windows.board })
        .then((loaded) => {
          remember(windows, loaded, today);
          if (asked !== boardsRequest.current) return;
          setBoards(loaded);
          setShown(windows);
          boardsReadAt.current = Date.now();
          setState('ready');
        })
        .catch(() => {
          if (cached || asked !== boardsRequest.current) return;
          setState((was) => (was === 'ready' ? was : 'error'));
          setFailed(windows);
        });
    },
    [today],
  );

  /** Try again, after a failure. */
  const load = useCallback(() => {
    setState((was) => (was === 'ready' ? was : 'loading'));
    setFailed(null);
    request({ day, week, month, board });
  }, [request, day, week, month, board]);

  /**
   * Re-read what is on screen without blanking it: what is there is the last
   * true answer, and a skeleton in its place would be a worse page than a
   * slightly old one.
   */
  const refreshBoards = useCallback(
    (options: FetchOptions = {}) => {
      const request = ++boardsRequest.current;
      const windows: Windows = { day, week, month, board };
      return fetchBoards(today, { ...options, day, week, month, mode: board })
        .then((loaded) => {
          remember(windows, loaded, today);
          if (request !== boardsRequest.current) return;
          setBoards(loaded);
          setShown(windows);
          boardsReadAt.current = Date.now();
        })
        .catch(() => {});
    },
    [today, day, week, month, board],
  );

  useEffect(() => {
    request({ day, week, month, board });
  }, [request, day, week, month, board]);

  // Not polled -- a rank does not move minute by minute -- but an app put down
  // this morning and picked up again is showing this morning's standings.
  useAppState({
    onForeground: () => {
      if (Date.now() - boardsReadAt.current <= BOARDS_STALE_MS) return;
      void refreshBoards();
    },
  });

  /** Pull to refresh, past the shared copy: the reader has said this one is old. */
  const pull = useCallback(async () => {
    setPulling(true);
    await refreshBoards({ fresh: true });
    setPulling(false);
  }, [refreshBoards]);

  const showsBoard = (which: BoardWindow) => which === visibleBoard;

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={theme.fgMuted} />}
    >
      <PageHead title="Leaderboards" onRefresh={() => void refreshBoards({ fresh: true })}>
        {/* Your own handle, stated before the boards rather than left to be
            found in them: it is derived from the player id and never typed, so
            this is the only place a player is told it. */}
        {playerId && (
          <Text style={[styles.handle, { color: theme.fgFaint }]}>
            Playing as{' '}
            <Text style={[styles.handleName, { color: theme.fgMuted }]}>{selfName(playerId)}</Text>
          </Text>
        )}
      </PageHead>

      {state === 'loading' && (
        <View style={styles.boardsSlot}>
          <StatusLine>Loading the boards…</StatusLine>
        </View>
      )}

      {state === 'error' && (
        <View style={styles.boardsSlot}>
          <StatusLine onRetry={load}>Couldn't load the boards.</StatusLine>
        </View>
      )}

      {state === 'ready' && boards && (
        <>
          {/* The rules the boards run on, before them: they decide what a
              score has to be to count before anybody reads one. */}
          <View style={styles.rules}>
            {[
              'Only puzzles played on the day they drop count',
              `A week counts your best ${WEEK_BEST_DAYS} days of 7`,
              `A month counts your best ${MONTH_BEST_DAYS} days`,
            ].map((rule) => (
              <View key={rule} style={styles.rule}>
                <Text style={[styles.ruleText, { color: theme.fgMuted }]}>{'•'}</Text>
                <Text style={[styles.ruleText, styles.ruleBody, { color: theme.fgMuted }]}>{rule}</Text>
              </View>
            ))}
          </View>

          {/* Which board. No Streak pill where the server sent no streak board,
              so there is never a pill for a board that is not there. */}
          <View
            style={[styles.windows, { borderColor: theme.border, backgroundColor: theme.bgInset }]}
            accessibilityRole="tablist"
            accessibilityLabel="Which board to show"
          >
            {BOARD_WINDOWS.filter(({ window }) => window !== 'streak' || boards.streak).map(
              ({ window, label }) => {
                const on = window === visibleBoard;
                return (
                  <Pressable
                    key={window}
                    onPress={() => {
                      if (on) return;
                      signalTap();
                      setVisibleBoard(window);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.window,
                      on && [styles.windowOn, { backgroundColor: segmentOn(theme) }],
                    ]}
                  >
                    <Text style={[styles.windowText, { color: on ? theme.fg : theme.fgMuted }]}>{label}</Text>
                  </Pressable>
                );
              },
            )}
          </View>

          {/* The boards, and the layer the congratulation wanders over: it names
              the winner of the window that just closed, the one result the
              boards themselves cannot show (see src/game/congrats.ts). Inside
              the loaded branch, so it never floats over a board that failed. */}
          <View style={styles.boardsArea}>
            {showsBoard('day') && (
              <Board
                heading={dayIsLive ? 'Today' : formatDateLabel(day)}
                headingDetail={dayIsLive ? 'Resets at midnight' : 'Final'}
                entries={boards.daily}
                self={boards.dailySelf}
                emptyMessage={dayIsLive ? "Nobody's scored yet today. Be first." : 'Nobody scored on this puzzle.'}
                playerId={playerId}
                state={dayState}
                onRetry={load}
                unit="day"
                columns={SCORE_COLUMNS}
                renderRow={scoreRow}
                canGoBack={day > dayFloor()}
                canGoForward={!dayIsLive}
                onBack={() => setDay(addDays(day, -1))}
                onForward={() => setDay(addDays(day, 1))}
              />
            )}
            {showsBoard('week') && (
              <Board
                heading={weekIsLive ? 'This week' : weekLabel(week)}
                headingDetail={weekIsLive ? 'Resets on Sundays' : 'Final'}
                entries={boards.weekly}
                self={boards.weeklySelf}
                emptyMessage={weekIsLive ? "Nobody's scored yet this week. Be first." : 'Nobody scored this week.'}
                playerId={playerId}
                state={weekState}
                onRetry={load}
                unit="week"
                columns={SCORE_COLUMNS}
                renderRow={scoreRow}
                canGoBack={week > weekFloor()}
                canGoForward={!weekIsLive}
                onBack={() => setWeek(addDays(week, -7))}
                onForward={() => setWeek(addDays(week, 7))}
              />
            )}
            {showsBoard('month') && (
              <Board
                heading={monthIsLive ? 'This month' : monthLabel(month)}
                headingDetail={monthIsLive ? monthResetLabel(today) : 'Final'}
                entries={boards.monthly}
                self={boards.monthlySelf}
                emptyMessage={monthIsLive ? "Nobody's scored yet this month. Be first." : 'Nobody scored this month.'}
                playerId={playerId}
                state={monthState}
                onRetry={load}
                unit="month"
                columns={SCORE_COLUMNS}
                renderRow={scoreRow}
                canGoBack={month > monthFloor()}
                canGoForward={!monthIsLive}
                onBack={() => setMonth(previousMonthStart(month))}
                onForward={() => setMonth(nextMonthStart(month))}
              />
            )}
            {boards.streak && showsBoard('streak') && (
              <Board
                heading="Streaks"
                // Not a window, so nothing resets: a streak ends when its player
                // stops, which is the one thing worth saying here.
                headingDetail="Who's on a run now"
                entries={boards.streak}
                self={boards.streakSelf}
                emptyMessage="Nobody's on a streak. Play today to start one."
                playerId={playerId}
                // Read with the other three and never stepped, so once the page
                // has boards this one is never waiting on anything.
                state="ready"
                onRetry={load}
                unit="streak board"
                columns={STREAK_COLUMNS}
                renderRow={streakRow}
              />
            )}
            <CongratsBubble today={today} />
          </View>
        </>
      )}

      {onPlay && <BackToPuzzle onPress={onPlay} />}
    </ScrollView>
  );
}

/** The figures on a scored board: the window's total, and its best find. */
const SCORE_COLUMNS = ['Total score', 'Best find'] as const;
/** The figures on the streak board: the run they are on, and the longest they have had. */
const STREAK_COLUMNS = ['Streak', 'Longest streak'] as const;

function scoreRow(entry: BoardEntry, isYou: boolean, last: boolean): ReactNode {
  return <Row key={entry.playerId} entry={entry} isYou={isYou} last={last} />;
}

function streakRow(entry: StreakEntry, isYou: boolean, last: boolean): ReactNode {
  return <StreakRow key={entry.playerId} entry={entry} isYou={isYou} last={last} />;
}

interface BoardProps<Entry extends { playerId: string }> {
  heading: string;
  /** A note beside the heading, set smaller -- when the board resets. */
  headingDetail?: string;
  entries: Entry[];
  /** This player's own row, when they rank below the last one shown. */
  self: Entry | null;
  /** What the two stacked figures on the right of each row are. */
  columns: readonly [string, string];
  /** One row of this board; the last one drops its rule. */
  renderRow: (entry: Entry, isYou: boolean, last: boolean) => ReactNode;
  emptyMessage: string;
  playerId: string | null;
  state: LoadState;
  onRetry: () => void;
  /** What this board's window is called in its own controls: "week", "month". */
  unit: string;
  /** Stepping the window. The streak board, which has none, leaves these out. */
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
}

/** One board: its heading, its arrows, the column labels, and its rows. */
function Board<Entry extends { playerId: string }>({
  heading,
  headingDetail,
  entries,
  self,
  columns,
  renderRow,
  emptyMessage,
  playerId,
  state,
  onRetry,
  unit,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: BoardProps<Entry>) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={heading}>
      <Text style={[styles.boardHeading, { color: theme.fg }]} accessibilityRole="header">
        {heading.toUpperCase()}
        {headingDetail && (
          <Text style={[styles.boardDates, { color: theme.fgFaint }]}>
            {'  '}
            {headingDetail}
          </Text>
        )}
      </Text>
      {onBack && onForward && (
        <View style={styles.boardNav}>
          <PagerArrows
            unit={unit}
            canGoBack={canGoBack ?? false}
            canGoForward={canGoForward ?? false}
            onBack={onBack}
            onForward={onForward}
          />
        </View>
      )}
      {state === 'error' ? (
        <StatusLine onRetry={onRetry} retryLabel={`Try loading the ${unit} board again`}>
          Couldn't load this {unit}.
        </StatusLine>
      ) : state === 'loading' ? (
        <View style={styles.placeholders} accessibilityLabel={`Loading the ${unit}…`}>
          {Array.from({ length: BOARD_PLACEHOLDER_ROWS }, (_, i) => (
            <PlaceholderRow key={i} height={ROW_HEIGHT - 1} />
          ))}
        </View>
      ) : entries.length === 0 ? (
        <StatusLine>{emptyMessage}</StatusLine>
      ) : (
        <>
          {/* What the numbers on the right are, stacked in the order the
              numbers under them are stacked. */}
          <View style={[styles.columns, { borderBottomColor: theme.border }]}>
            <Text style={[styles.columnText, { color: theme.fgFaint }]}>{columns[0].toUpperCase()}</Text>
            <Text style={[styles.columnText, { color: theme.fgFaint }]}>{columns[1].toUpperCase()}</Text>
          </View>
          <View accessibilityLabel={`${heading}, top ${entries.length}`}>
            {entries.map((entry, index) =>
              renderRow(entry, playerId === entry.playerId, index === entries.length - 1 && !self),
            )}
            {self && (
              <>
                {/* The gap between the board and the row below its cut, said in
                    the one way that needs no words. */}
                <Text
                  style={[styles.gap, { color: theme.fgFaint }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  ⋯
                </Text>
                {renderRow(self, true, true)}
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The dressing every row shares: the gold of the board's leader, the inset grey
 * of your own row, the rule under everybody else.
 *
 * Gold belongs to the rarer one, so a leader who is you keeps the gold -- the
 * row already says "you" beside the name. Both are rounded and drop the rule,
 * as on the website.
 */
function rowStyle(theme: ReturnType<typeof useTheme>, isLeader: boolean, isYou: boolean, last: boolean) {
  if (isLeader) {
    return {
      backgroundColor: theme.bestWordBg,
      borderRadius: 7.2,
      borderWidth: 1,
      // `color-mix(accent 55%, transparent)`, as an alpha suffix.
      borderColor: `${theme.bestWordAccent}8c`,
    };
  }
  if (isYou) return { backgroundColor: theme.bgInset, borderRadius: 7.2 };
  return last ? null : { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: theme.border };
}

/** "you", as the website's small inverted tag beside the name. */
function YouTag() {
  const theme = useTheme();
  return (
    <Text style={[styles.you, { backgroundColor: theme.accent, color: theme.accentFg }]}>{' YOU '}</Text>
  );
}

/** The rank column: the number, or the trophy that means first. */
function Rank({ rank }: { rank: number | null }) {
  const theme = useTheme();
  return (
    <Text style={[styles.rank, { color: theme.fgFaint }]}>
      {rank === null ? '' : rank === 1 ? '\u{1F3C6}' : rank}
    </Text>
  );
}

/**
 * One player's row: who they are, how much they played, and what it came to,
 * with their best find in the window under the total as "word · score".
 *
 * A find score of zero is a word today's dictionary no longer prices; the word
 * then stands alone instead of reading "0.0".
 */
function Row({ entry, isYou, last }: { entry: BoardEntry; isYou: boolean; last: boolean }) {
  const theme = useTheme();
  const isLeader = entry.rank === 1;
  return (
    <View
      style={[styles.row, rowStyle(theme, isLeader, isYou, last)]}
      accessible
      accessibilityLabel={
        `${isYou ? 'You, ' : ''}rank ${entry.rank}, ${entry.name}, ` +
        `${formatTotal(entry.score)}, ${entry.puzzles} ${entry.puzzles === 1 ? 'puzzle' : 'puzzles'}` +
        `${entry.windowWord ? `, best find ${entry.windowWord}` : ''}`
      }
    >
      <View style={styles.rowTop}>
        <Rank rank={entry.rank} />
        <Text style={[styles.name, isLeader && styles.heavy, { color: theme.fg }]}>
          {entry.name}
          {isYou && (
            <>
              {'  '}
              <YouTag />
            </>
          )}
        </Text>
        <Text style={[styles.score, { color: theme.fg }]}>{formatTotal(entry.score)}</Text>
      </View>
      <View style={styles.detail}>
        <Text style={[styles.detailText, { color: theme.fgFaint }]}>
          {entry.puzzles} {entry.puzzles === 1 ? 'puzzle' : 'puzzles'}
        </Text>
        {entry.windowWord ? (
          <View style={styles.best}>
            <Text style={[styles.detailText, styles.bestWord, { color: theme.fgFaint }]} numberOfLines={1}>
              {entry.windowWord}
            </Text>
            {entry.windowScore > 0 && (
              <Text style={[styles.detailText, { color: theme.fgFaint }]}>
                {' · '}
                {formatScore(entry.windowScore)}
              </Text>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** What a screen reader hears after a streak row's count. */
function streakStatus(entry: StreakEntry): string {
  if (entry.lost) return ', lost';
  if (entry.endangered) return ', in danger: out of freezes, missed days to make up';
  if (entry.resting) return ", lazy Saturday: skipping it can't break the streak";
  if (entry.current <= 1 && !entry.frozen) return '';
  const held = entry.frozen
    ? ', covered by a saved freeze'
    : entry.covered
      ? entry.atRisk
        ? ', missed a day, covered by the free day'
        : ', missed a day, a saved freeze will cover today'
      : '';
  return held + (entry.atRisk ? ', at risk today' : '');
}

/**
 * One row of the streak board: who, how many days in a row, and their longest.
 *
 * The same row as a scored board's, with the run where the total goes and the
 * longest run where the best find goes. One icon says how the run stands: 😴 on
 * an earned Saturday not played yet (pressed to say why, see RestDayBadge); ⏳ when missed days
 * have spent every saved freeze; ⚠️ for the two days after, while the missed
 * puzzles can still be made up; 🧊 while a freeze is covering it; 💀 for a run
 * that has ended, kept for two days more, struck through and unranked;
 * 🔥 for a run played through yesterday. None on a live run of one day.
 */
function StreakRow({ entry, isYou, last }: { entry: StreakEntry; isYou: boolean; last: boolean }) {
  const theme = useTheme();
  const isLeader = entry.rank === 1;
  const icon = entry.lost
    ? '\u{1F480}'
    : entry.endangered
      ? '\u{26A0}\u{FE0F}'
      : entry.atRisk
        ? '\u{23F3}'
        : entry.frozen || entry.covered
          ? '\u{1F9CA}'
          : '\u{1F525}';
  const resting = entry.resting && !entry.lost && !entry.endangered;
  // Gold when the longest run beats the current one: a strong player on a
  // recent lapse, not a weak one.
  const past = entry.best > entry.current;
  const dim = entry.lost ? styles.lost : null;
  return (
    <View
      style={[styles.row, rowStyle(theme, isLeader, isYou, last)]}
      accessibilityLabel={
        `${isYou ? 'You, ' : ''}${entry.rank === null ? '' : `rank ${entry.rank}, `}${entry.name}, ` +
        `${entry.current} ${entry.current === 1 ? 'day' : 'days'} current streak${streakStatus(entry)}, ` +
        `longest ${entry.best}`
      }
    >
      <View style={styles.rowTop}>
        <View style={dim}>
          <Rank rank={entry.rank} />
        </View>
        <Text style={[styles.name, isLeader && styles.heavy, dim, { color: theme.fg }]}>
          {entry.name}
          {isYou && (
            <>
              {'  '}
              <YouTag />
            </>
          )}
        </Text>
        <View style={[styles.streakScore, dim]}>
          {resting ? (
            <RestDayBadge fontSize={16} style={styles.restBadge} />
          ) : (
            (entry.current > 1 || entry.lost || entry.endangered) && (
              <Text style={styles.score}>{icon} </Text>
            )
          )}
          <Text style={[styles.score, { color: theme.fg }]}>{entry.current}</Text>
        </View>
        {/* The strike through a lost run, from the name through the count. */}
        {entry.lost && (
          <View
            style={[styles.strike, { backgroundColor: theme.fgFaint }]}
            pointerEvents="none"
          />
        )}
      </View>
      <View style={[styles.detail, dim]}>
        <Text style={[styles.detailText, { color: theme.fgFaint }]} />
        <Text
          style={[
            styles.detailText,
            past ? { color: theme.rarity.Elusive.fg, fontWeight: '600' } : { color: theme.fgFaint },
          ]}
        >
          Longest {entry.best}
        </Text>
      </View>
    </View>
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
  /* `.leaderboard-page__handle`: a faint line, with the handle lifted a step. */
  handle: {
    marginTop: 2.4,
    fontSize: 12,
  },
  handleName: {
    fontWeight: '800',
  },
  /* Holds the room a board will take, so nothing under it jumps when it lands. */
  boardsSlot: {
    minHeight: ROW_HEIGHT * 5 + 54,
    justifyContent: 'center',
  },
  /* `.leaderboard__rules`: tucked up under the page head. */
  rules: {
    marginTop: -13.6,
    marginBottom: 16,
    paddingLeft: 4,
  },
  rule: {
    flexDirection: 'row',
    gap: 8,
  },
  ruleText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  ruleBody: {
    flex: 1,
  },
  /* `.leaderboard__windows`: one inset track with the chosen segment raised. */
  windows: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 16,
    padding: 3,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  window: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6.7,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
  },
  windowOn: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  windowText: {
    fontSize: 12.8,
    fontWeight: '700',
    lineHeight: 15.4,
  },
  boardsArea: {
    position: 'relative',
  },
  boardHeading: {
    fontSize: 15.2,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  /* `.leaderboard__board-dates`: a note beside the heading, at reading case. */
  boardDates: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.23,
  },
  boardNav: {
    marginTop: 8,
  },
  placeholders: {
    marginTop: 5.6,
    gap: 1,
  },
  columns: {
    marginTop: 5.6,
    paddingHorizontal: 6.4,
    paddingBottom: 5.6,
    alignItems: 'flex-end',
    borderBottomWidth: 1,
  },
  columnText: {
    fontSize: 10.9,
    fontWeight: '700',
    letterSpacing: 0.87,
    lineHeight: 13.6,
  },
  gap: {
    marginTop: 5.6,
    marginBottom: 4.8,
    fontSize: 14.4,
    lineHeight: 14.4,
    letterSpacing: 1.44,
    textAlign: 'center',
  },
  row: {
    paddingVertical: 7.2,
    paddingHorizontal: 6.4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: COLUMN_GAP,
  },
  rank: {
    width: RANK_WIDTH,
    fontSize: 12.8,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
  },
  heavy: {
    fontWeight: '900',
  },
  you: {
    fontSize: 10.4,
    fontWeight: '800',
    letterSpacing: 0.83,
    borderRadius: 4,
    overflow: 'hidden',
  },
  score: {
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  streakScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  /* `.leaderboard__detail`: the count at the left, the find under the total. */
  detail: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: COLUMN_GAP,
    marginLeft: RANK_WIDTH + COLUMN_GAP,
    minWidth: 0,
  },
  detailText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  best: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    flexShrink: 1,
    minWidth: 0,
  },
  bestWord: {
    flexShrink: 1,
  },
  /* `.leaderboard__row--lost`: faded, as if greyed, with a strike through it. */
  lost: {
    opacity: 0.45,
  },
  strike: {
    position: 'absolute',
    left: RANK_WIDTH + COLUMN_GAP,
    right: 0,
    top: '50%',
    height: 1.5,
  },
  restBadge: {
    marginRight: 4,
  },
});
