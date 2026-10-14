import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchBoards,
  dayFloor,
  monthFloor,
  weekFloor,
  type FetchOptions,
  type BoardEntry,
  type Boards,
} from "../game/leaderboard";
import { loadPlayerId, selfName } from "../game/player";
import { addDays, formatDateLabel, todayDateString } from "../game/date";
import { currentMode, type GameMode } from "../game/mode";
import { pageCache } from "../game/pageCache";
import { useGameMode } from "../hooks/useGameMode";
import {
  monthLabel,
  monthResetLabel,
  monthStart,
  nextMonthStart,
  previousMonthStart,
} from "../game/month";
import { WEEK_BEST_DAYS, weekLabel, weekStart } from "../game/week";
import { formatScore, formatTotal } from "../game/dictionary";
import { navigate } from "../routes";
import { useNarrowLayout } from "../hooks/useNarrowLayout";
import { CongratsBubble } from "./CongratsBubble";

type LoadState = "loading" | "ready" | "error";

/** One of the three windows the page counts, as the pills name them. */
type BoardWindow = "day" | "week" | "month";

/**
 * The three windows in the order they are shown, shortest first, with the word
 * each is called by on its pill.
 *
 * "Day" rather than "Today", "Week" rather than "This week": the pills are a
 * choice of *window*, and a reader stepped back to last week should not be
 * looking at a pill claiming the board under it is this one. The board's own
 * heading says which day, week or month it is about, and it is still right after
 * a step back.
 */
const BOARD_WINDOWS: { window: BoardWindow; label: string }[] = [
  { window: "day", label: "Day" },
  { window: "week", label: "Week" },
  { window: "month", label: "Month" },
];

/**
 * How old the boards have to be before returning to the tab re-reads them.
 *
 * They are not polled: the boards request carries this player's id, so it is
 * private and uncached, and a rank is not something that moves under a reader
 * minute by minute. But a tab left open all day and come back to is stale in a
 * way a minute-old one is not, and a return is exactly when somebody looks. Five
 * minutes is long enough that flicking between tabs costs nothing and short
 * enough that a real absence is caught.
 */
const BOARDS_STALE_MS = 5 * 60_000;
/**
 * How many rows a board holds open while it is fetching another window.
 *
 * The five the board shows before anybody scrolls it, which is the part of it a
 * reader is looking at when they press the button -- so the section keeps its
 * height and the page under their thumb does not jump. The same trick the finds
 * page plays with the day it is leaving (see FoundWordsPage).
 */
const BOARD_PLACEHOLDER_ROWS = 5;

/** The three windows the boards count, as a request carries them. */
interface Windows {
  day: string;
  week: string;
  month: string;
  /** Which of the two boards those windows were counted on. */
  board: GameMode;
}

/**
 * One board's identity while it is loading: its window, and which of the two
 * boards that window is being counted on.
 *
 * The board belongs in the key for the same reason the window does. Switching
 * from Standard to Freeform re-reads all three, and without it the rows of the
 * board just left would sit under the heading of the one just asked for, saying
 * "ready" the whole time -- which is exactly the wrong thing to be confident
 * about, because the numbers change completely and nothing about them looks
 * stale.
 */
function windowKey(board: GameMode, window: string): string {
  return `${board}:${window}`;
}

/**
 * Every window this page has read, so stepping back to one is instant -- and so
 * is coming back to the page from the puzzle (see game/pageCache.ts).
 *
 * Kept per window rather than per request: the three boards step separately,
 * so the day a reader returns to is very often paired with a week they have
 * never had on screen beside it, and only the board that moved needs anything.
 * Keyed like `windowKey`, so a window on one board is never served as the same
 * window on the other, and by the player asking, because the response carries
 * their own row from below the cut.
 *
 * A remembered window is only ever shown while it is re-read underneath (see
 * `load`) -- a past day's board can still move, as players backfill old puzzles.
 */
const boardCache = {
  day: pageCache<Pick<Boards, "daily" | "dailySelf">>(),
  week: pageCache<Pick<Boards, "weekly" | "weeklySelf" | "weekStart">>(),
  month: pageCache<Pick<Boards, "monthly" | "monthlySelf">>(),
};

function cacheKey(board: GameMode, window: string): string {
  return `${loadPlayerId() ?? ""}:${windowKey(board, window)}`;
}

function remember(windows: Windows, loaded: Boards) {
  const { board } = windows;
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

/** All three boards for these windows, if every one of them has been read. */
function recall(windows: Windows): Boards | null {
  const { board } = windows;
  const day = boardCache.day.get(cacheKey(board, windows.day));
  const week = boardCache.week.get(cacheKey(board, windows.week));
  const month = boardCache.month.get(cacheKey(board, windows.month));
  if (!day || !week || !month) return null;
  return { ...day, ...week, ...month, mode: board };
}

/** The windows a page opens on, and their boards if this visit has read them. */
function openingBoards(): { windows: Windows; boards: Boards | null } {
  const day = todayDateString();
  const windows = {
    day,
    week: weekStart(day),
    month: monthStart(day),
    board: currentMode(),
  };
  return { windows, boards: recall(windows) };
}

/**
 * What one board is doing: showing the window asked for, waiting for it, or
 * unable to load it.
 *
 * Answered by comparing the window the reader is asking for against the one the
 * boards on screen are about and the one that last failed. Nothing is timed and
 * no request is tracked -- if the rows in hand are not this window's, they are
 * on their way.
 */
function boardState(
  wanted: string,
  onScreen: string | undefined,
  lastFailed: string | undefined,
): LoadState {
  if (onScreen === wanted) return "ready";
  if (lastFailed === wanted) return "error";
  return "loading";
}

/**
 * The boards, as their own page at /leaderboard.
 *
 * A page rather than a modal because that is what it behaves like: something you
 * link a friend to, open in a second tab, and leave with the back button. A
 * modal can do none of those, and a board is exactly the thing people want to
 * send each other.
 *
 * Three windows of the same game, all on screen at once, shortest first. Showing
 * them together is the point of having three: the interesting thing about any
 * one of them is how it differs from the others -- who is new today, who is
 * always there -- and a reader who has to click between them has to hold the
 * first in their head to see it. Today leads because it is the one anybody can
 * still win from nothing; by Thursday a week's board is mostly a week's play,
 * and a month's is a month's.
 *
 * The finds that used to sit under all this are their own page now (see
 * FoundWordsPage): they are a list of *words* under two lists of *players*, they
 * are read for a different reason, and they were the live half of a page whose
 * other half had not moved since breakfast.
 */
export function LeaderboardPage() {
  /**
   * What the page opens on: today's windows, already on screen if this visit
   * has read them -- so coming back from the puzzle is not a skeleton.
   */
  const [opening] = useState(openingBoards);
  const [boards, setBoards] = useState<Boards | null>(opening.boards);
  const [state, setState] = useState<LoadState>(
    opening.boards ? "ready" : "loading",
  );
  /**
   * The puzzle this page is about, fixed when the page opened.
   *
   * Read once rather than on every render, so it moves only on a refresh -- the
   * same way the game fixes its own date at mount (useDailyPuzzle). Both come
   * from the same clock, so they name the same drop, and the day board here is
   * the day the player was just playing.
   *
   * Read on every render instead, a tab left open would cross midnight and swap
   * every window under a reader who never asked for it.
   */
  const today = opening.windows.day;
  /**
   * The live windows: the day, the week and the month the player is playing in.
   *
   * Derived from `today`, which is frozen at mount, so these are the windows the
   * page opened on and the ones "next" walks back to -- a tab left open across a
   * Sunday keeps naming the week it was opened in rather than silently becoming
   * a page about a different one.
   */
  const thisWeek = weekStart(today);
  const thisMonth = monthStart(today);
  /**
   * Which windows the two boards are counting, which is what the reader steps.
   *
   * Separately, and that is the point of two pieces of state rather than one
   * offset: the boards answer different questions over different lengths of
   * time, and a reader comparing last month's standings against this week's is
   * doing exactly the thing having two boards is for. Nothing links them.
   *
   * Both are the near end of the window -- a Sunday and a first -- because that
   * is what the request carries and what the server bounds each board from (see
   * game/leaderboard.ts).
   */
  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(thisWeek);
  const [month, setMonth] = useState(thisMonth);
  /**
   * Which of the two boards all three windows are about.
   *
   * The player's own mode, and not a copy of it: the board somebody reads and
   * the game they play are one choice, so the header's switch is the only
   * control for both. Flipping it there repaints this page.
   *
   * One choice for the whole section, not one per board. A page showing this
   * week's Standard beside this month's Freeform would be comparing two games,
   * which is the thing having two boards is meant to stop.
   */
  const [board] = useGameMode();
  /**
   * Whether the page is showing one board at a time, and which one.
   *
   * Only ever true on the narrow layout. Three boards side by side is the whole
   * point of the wide one -- what is interesting about any window is how it
   * differs from the others -- but stacked on a phone that comparison is gone
   * anyway: the second board starts below the fold, so the reader is already
   * choosing one, just by scrolling past two. The pills make the choice a tap
   * instead of a scroll, and put all three windows on the first screen.
   *
   * The day leads because it is the one anybody can still win from nothing, the
   * same reason it is first in the stack.
   *
   * The choice is kept across a resize rather than reset with the layout: a
   * window widened past the breakpoint shows all three boards, and narrowed back
   * returns to the one that was picked.
   */
  const narrow = useNarrowLayout();
  const [visibleBoard, setVisibleBoard] = useState<BoardWindow>("day");
  /** Wide shows all three; narrow shows the one the pills have picked. */
  const showsBoard = (which: BoardWindow) => !narrow || which === visibleBoard;
  const dayIsLive = day === today;
  const weekIsLive = week === thisWeek;
  const monthIsLive = month === thisMonth;
  /**
   * Which windows the boards on screen are actually about, and which ones failed
   * to load.
   *
   * The pair is recorded rather than assumed, because a fetch is in flight for
   * the length of a step: without this the board would sit under a heading
   * naming the week the reader just asked for, showing the rows of the week they
   * left. Comparing what is on screen against what is asked for is the whole of
   * each board's own loading state, and it needs no timer and no request id --
   * the last response to land says what it was about.
   */
  const [shown, setShown] = useState<Windows | null>(
    opening.boards ? opening.windows : null,
  );
  const [failed, setFailed] = useState<Windows | null>(null);
  /**
   * Each board's state, which after the first load is no longer the page's: one
   * board can be waiting on a window the reader stepped to while the other is
   * sitting on rows that never moved.
   */
  const keyOf = (windows: Windows | null, window: keyof Omit<Windows, "board">) =>
    windows ? windowKey(windows.board, windows[window]) : undefined;
  const dayState = boardState(
    windowKey(board, day),
    keyOf(shown, "day"),
    keyOf(failed, "day"),
  );
  const weekState = boardState(
    windowKey(board, week),
    keyOf(shown, "week"),
    keyOf(failed, "week"),
  );
  const monthState = boardState(
    windowKey(board, month),
    keyOf(shown, "month"),
    keyOf(failed, "month"),
  );
  /**
   * Who the boards should call "you".
   *
   * Read once, on the way in: the id is minted before this page renders (see
   * src/Root.tsx) and never changes afterwards, so there is nothing here to
   * keep in state.
   */
  const playerId = loadPlayerId();
  /**
   * When the boards on screen were last read, so a return to the tab can tell a
   * page that has been sitting there for an hour from one glanced away from.
   */
  const boardsReadAt = useRef(0);
  /**
   * Which boards request is the current one.
   *
   * A reader stepping twice quickly has two fetches in flight over two different
   * windows, and nothing says they come back in order. Without this the older
   * answer could land last and leave the board waiting on a window it already
   * has. Counted rather than compared against the windows themselves, so a
   * refresh of the same window is also correctly the newer of the two.
   */
  const boardsRequest = useRef(0);

  /**
   * Fetch all three boards.
   *
   * One request, because they are one answer: the three windows are counted from
   * the same rows and the response carries this player's id, so asking three
   * times would be three private queries to say one thing.
   */
  const load = useCallback(() => {
    // The page's own state is the *first* read and nothing after it: once there
    // are boards on screen, a fetch is one board stepping to another window, and
    // blanking the whole page -- including the board that did not move -- to
    // fetch it would be a worse page than the one the reader is looking at. From
    // then on each board says for itself whether it is waiting (see
    // `boardState`).
    const windows: Windows = { day, week, month, board };
    // A window already read this visit goes straight back on screen, and the
    // request below only checks it: a reader stepping back and forward is
    // looking for something they have just seen, and a skeleton in its place
    // says it has gone. The answer swaps in when it lands, as a refresh does.
    const cached = recall(windows);
    if (cached) {
      setBoards(cached);
      setShown(windows);
      setState("ready");
    } else {
      setState((was) => (was === "ready" ? was : "loading"));
    }
    setFailed(null);
    const request = ++boardsRequest.current;
    fetchBoards(today, { day, week, month, mode: board })
      .then((loaded) => {
        remember(windows, loaded);
        if (request !== boardsRequest.current) return;
        setBoards(loaded);
        setShown(windows);
        boardsReadAt.current = Date.now();
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      // Recorded against the windows that were asked for, so the board that was
      // waiting is the one that reports it.
      .catch(() => {
        // A remembered window stays up: a failed check is not news about rows
        // the reader can already see.
        if (cached || request !== boardsRequest.current) return;
        setState((was) => (was === "ready" ? was : "error"));
        setFailed({ day, week, month, board });
      });
  }, [today, day, week, month, board]);

  /**
   * Re-read the boards without disturbing the page.
   *
   * No loading state and no error state: the boards already on screen are the
   * last true answer, and replacing them with a spinner -- or with "couldn't
   * load" -- to fetch something the reader can already see would be a worse
   * page than a slightly old one. It swaps them or it leaves them.
   */
  const refreshBoards = useCallback(
    (options: FetchOptions = {}) => {
      // Whichever windows are on screen: a reader who stepped back and then
      // tapped refresh is asking for the board in front of them again, not for
      // this week's.
      const request = ++boardsRequest.current;
      fetchBoards(today, { ...options, day, week, month, mode: board })
        .then((loaded) => {
          remember({ day, week, month, board }, loaded);
          if (request !== boardsRequest.current) return;
          setBoards(loaded);
          setShown({ day, week, month, board });
          boardsReadAt.current = Date.now();
        })
        .catch(() => {});
    },
    [today, day, week, month, board],
  );

  /**
   * Nothing to join here any more.
   *
   * The id is minted on opening the app, whichever page that is, and the
   * browser's history goes up with it (see src/Root.tsx) -- so by the time
   * anybody reaches this page they are already a player, and the join that used
   * to live here could never fire. Dropped rather than kept as a fallback: a
   * second place that mints ids is a second thing to keep true, on a path that
   * no longer exists.
   */
  useEffect(() => {
    load();
  }, [load]);

  /**
   * Re-read the boards when a tab that has been away comes back.
   *
   * They are not polled -- a rank does not move under a reader minute by minute,
   * and this is the request carrying their id, so polling it would mean a
   * private, uncached query every minute per open page. But a page left open
   * since this morning and returned to is showing last night's standings, and a
   * return is exactly when somebody looks. Only after a real absence: a glance
   * at another tab and back is not new information.
   */
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - boardsReadAt.current <= BOARDS_STALE_MS) return;
      refreshBoards();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshBoards]);

  /**
   * Refresh the boards, because a reader asked.
   *
   * With the cache-buster: a poll can be answered from the shared copy, but
   * somebody who taps this has just told you the board they are looking at is
   * not the one they want. Handing them the same bytes back would make the
   * button a decoration -- which is what a browser reload already is here, since
   * a client cannot bust a CDN's shared copy.
   *
   * No loading state on the boards themselves. What is on screen is the last
   * true answer, and blanking it to fetch something the reader can already see
   * would be a worse page than a slightly old one -- the same reason
   * `refreshBoards` doesn't. The button says it is working; the page stays
   * readable underneath.
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    refreshBoards({ fresh: true });
    // Long enough to read as a response to the tap, and it ends on its own
    // rather than on the request: it does not reject in a way this cares about,
    // and a button that stayed disabled because a fetch hung would be worse than
    // one that came back a moment early.
    window.setTimeout(() => setRefreshing(false), 600);
  }, [refreshBoards]);

  return (
    <main>
    <div className="page-head">
      <div>
        <h1 className="page-head__title">Leaderboards</h1>
        {/* Your own handle, stated before the boards rather than left to be
            found in them.

            Nobody is ever told their name anywhere else -- it is derived from
            the player id and never typed (src/game/handle.ts) -- so the only
            way to learn it was to spot your own row, which is circular if
            spotting your row is what you came here to do. It goes up here
            because that is the half of the answer that works before you have
            scrolled, and the half that still works when you are on none of
            the three boards.

            "Playing as" rather than "You're": nobody chose this handle, so a
            page asserting who you *are* is claiming more than it should. A
            role is what it actually is, and it is the frame that survives
            handles becoming rerollable. It is also the register the rest of
            the page is written in -- "Resets on Sundays", "Resets at
            midnight" -- where a warmer line would be the one thing here
            raising its voice. */}
        {playerId && (
          <p className="leaderboard-page__handle">
            Playing as <strong>{selfName(playerId)}</strong>
          </p>
        )}
      </div>
      {/* A refresh belongs on the two pages whose content is other people's,
          and nowhere else in the app. */}
      <button
        type="button"
        className="app__icon-button leaderboard-page__refresh"
        onClick={refreshAll}
        disabled={refreshing}
        aria-label="Refresh"
        title="Refresh"
        data-refreshing={refreshing ? "" : undefined}
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>


      {/* Both of these hold the room a board will take -- a heading and five
          rows -- so what is under them stays where it is when the boards land.
          The alternative is the whole page jumping down a screen a second after
          it opened, under a reader who had started reading. */}
      {state === "loading" && (
        <div className="leaderboard__boards-slot">
          <p className="leaderboard__status" aria-live="polite">
            Loading the boards…
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="leaderboard__boards-slot">
          <p className="leaderboard__status" aria-live="polite">
            Couldn't load the boards.{" "}
            <button
              type="button"
              className="leaderboard__retry"
              onClick={() => load()}
            >
              Try again
            </button>
          </p>
        </div>
      )}

      {state === "ready" && boards && (
        <>
          {/* The rules the boards run on, stated before them rather
              than after: it is the condition a score has to meet to be on any
              of the lists, so a reader wants it on the way in. Underneath them
              it had nothing to sit against -- a bullet adrift under the last
              row. Outside the grid below, so it sits against the first board
              rather than a column gap away from it. The week's best-days rule
              sits beside it for the same reason: it decides what a weekly total
              is before anybody reads one (see WEEK_BEST_DAYS). */}
          <ul className="leaderboard__rules">
            <li>Only puzzles played on the day they drop count</li>
            <li>A week counts your best {WEEK_BEST_DAYS} days of 7</li>
          </ul>
          {/* Which board, on the layout that only has room for one at a time.
              Above the boards rather than beside each heading, because it is one
              choice about the section and not three controls: a reader picks a
              window here and then reads a whole board, exactly as they would on
              a laptop -- where these do not appear at all, because there all
              three are already on screen and a picker would be a way of hiding
              two of them.
              Buttons rather than tabs: what they switch is a section of the page
              that keeps its own heading and its own back/forward nav, and a
              tablist would promise arrow-key navigation between panels that are
              not panels. `aria-pressed` says which one is on, which is the whole
              of the state. */}
          {narrow && (
            <div
              className="leaderboard__windows"
              role="group"
              aria-label="Which board to show"
            >
              {BOARD_WINDOWS.map(({ window: boardWindow, label }) => (
                <button
                  key={boardWindow}
                  type="button"
                  className="leaderboard__window"
                  aria-pressed={visibleBoard === boardWindow}
                  onClick={() => setVisibleBoard(boardWindow)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* The boards, and the layer the congratulation wanders over. The
              bubble is positioned against this box rather than the viewport,
              because what it is about is the standings -- it names the winner
              of the window that just closed, which is the one result the boards
              themselves cannot show, and it drifts around them until somebody
              hits it, for a few days after each window closes (see
              game/congrats.ts).
              Inside the loaded branch, so there is never a congratulation
              floating over a board that says it couldn't load. */}
          <div className="leaderboard__boards-area">
            <CongratsBubble today={today} />
            <div className="leaderboard__boards">
              {showsBoard("day") && (
                <Board
                  // "Today" while it is today's, and the day's own date once it
                  // isn't -- the same wording the finds page heads a day with, for
                  // the same reason: two steps back has no word like "yesterday",
                  // and a heading whose shape changes halfway down a week is
                  // harder to read than one that always names the day.
                  heading={dayIsLive ? "Today" : formatDateLabel(day)}
                  // What a day board resets at, which is the one thing worth
                  // saying about a window everybody is already inside. A day that
                  // has closed says the other half of it: what is on screen is not
                  // going to change again.
                  headingDetail={dayIsLive ? "Resets at midnight" : "Final"}
                  entries={boards.daily}
                  self={boards.dailySelf}
                  emptyMessage={
                    dayIsLive
                      ? "Nobody's scored yet today. Be first."
                      : "Nobody scored on this puzzle."
                  }
                  playerId={playerId}
                  state={dayState}
                  onRetry={load}
                  unit="day"
                  canGoBack={day > dayFloor()}
                  canGoForward={!dayIsLive}
                  onBack={() => setDay(addDays(day, -1))}
                  onForward={() => setDay(addDays(day, 1))}
                />
              )}
              {showsBoard("week") && (
                <Board
                  heading={weekIsLive ? "This week" : weekLabel(week)}
                  // Beside the heading rather than under it: the two boards sit
                  // shoulder to shoulder, and a line under one of them and not
                  // the other pushed its rows half a line down -- two lists side
                  // by side that do not start level read as a mistake. No dates
                  // on either board now. A window you are already in does not
                  // need its days spelled out; when it turns over is the one
                  // thing worth saying, and both boards say exactly that. A
                  // window that has turned over says the other half of it: that
                  // what is on screen is not going to change again.
                  headingDetail={weekIsLive ? "Resets on Sundays" : "Final"}
                  entries={boards.weekly}
                  self={boards.weeklySelf}
                  emptyMessage={
                    weekIsLive
                      ? "Nobody's scored yet this week. Be first."
                      : "Nobody scored this week."
                  }
                  playerId={playerId}
                  state={weekState}
                  onRetry={load}
                  // The window this board counts is the reader's to move: back
                  // through the weeks that have finished, forward to the one they
                  // are playing. See the note on the nav in `Board`.
                  unit="week"
                  canGoBack={week > weekFloor()}
                  canGoForward={!weekIsLive}
                  onBack={() => setWeek(addDays(week, -7))}
                  onForward={() => setWeek(addDays(week, 7))}
                />
              )}
              {showsBoard("month") && (
                <Board
                  heading={monthIsLive ? "This month" : monthLabel(month)}
                  // The weekday it turns over on and the date that is, which for
                  // a month is computed (see game/month.ts) rather than the
                  // constant the week can get away with -- and the weekday leads,
                  // because a bare "Sep 1" is a date a reader still has to place
                  // in their own week. This board used to be "Season 1" with
                  // the season's two dates under it -- a window a reader had to
                  // be told the ends of, because they were picked by hand. A
                  // month has ends everybody already knows.
                  headingDetail={monthIsLive ? monthResetLabel(today) : "Final"}
                  entries={boards.monthly}
                  self={boards.monthlySelf}
                  emptyMessage={
                    monthIsLive
                      ? "Nobody's scored yet this month. Be first."
                      : "Nobody scored this month."
                  }
                  playerId={playerId}
                  state={monthState}
                  onRetry={load}
                  unit="month"
                  canGoBack={month > monthFloor()}
                  canGoForward={!monthIsLive}
                  onBack={() => setMonth(previousMonthStart(month))}
                  onForward={() => setMonth(nextMonthStart(month))}
                />
              )}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today's puzzle
      </button>
    </main>
  );
}

interface BoardProps {
  heading: string;
  /** A note beside the heading, set smaller -- when the board resets. */
  headingDetail?: string;
  entries: BoardEntry[];
  /** This player's own row, when they rank below the last one shown. */
  self: BoardEntry | null;
  emptyMessage: string;
  playerId: string | null;
  /**
   * Whether these rows are the window in the heading, on their way, or lost.
   *
   * Its own state per board rather than the page's, because the two windows move
   * independently: stepping the month back must not blank the week beside it.
   */
  state: LoadState;
  /** Ask for this board's window again, after one failed to load. */
  onRetry: () => void;
  /** What this board's window is called in its own controls: "week", "month". */
  unit: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/**
 * One board: the top fifteen, ranked by total score exactly as the database
 * ordered it, and then you.
 *
 * The board is short because a leaderboard is read, not scrolled -- but a short
 * board that stops at fifteen tells everybody below it nothing at all, and "am I
 * anywhere" is the question a player brings to this page. So the server sends
 * their own row back when it falls outside the fifteen, and it goes last in the
 * same list, after a gap, where the sticky rule docks it to the bottom edge of
 * the board exactly as it docks the row of a player inside the fifteen. The rank
 * on it is the real one -- 61st of everybody, not 16th of what fits.
 */
function Board({
  heading,
  headingDetail,
  entries,
  self,
  emptyMessage,
  playerId,
  state,
  onRetry,
  unit,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">
        {heading}
        {headingDetail && (
          <span className="leaderboard__board-dates">{headingDetail}</span>
        )}
      </h2>
      {/* Stepping this board's window, back through the ones that have closed
          and forward to the one being played.
          Both arrows always rendered and disabled at the ends rather than
          removed, exactly as the finds feed's are: a control that disappears at
          the edge of its range takes the shape of the thing with it, and a
          reader who has stepped back needs to see that forward exists before
          they know they can come back. Per board, because the two windows are
          different lengths of time and the comparison between them is the whole
          reason there are two. */}
      <div className="leaderboard__board-nav">
        <button
          type="button"
          className="leaderboard__board-arrow"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label={`Previous ${unit}`}
        >
          <span aria-hidden="true">‹</span>
          <span>Previous {unit}</span>
        </button>
        <button
          type="button"
          className="leaderboard__board-arrow"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label={`Next ${unit}`}
        >
          <span>Next {unit}</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {state === "error" ? (
        // Named for the board it belongs to: there are three retries on this
        // page now -- two boards and the feed -- and three buttons called "Try
        // again" are one button to anybody who reaches them by name.
        <p className="leaderboard__status" aria-live="polite">
          Couldn't load this {unit}.{" "}
          <button
            type="button"
            className="leaderboard__retry"
            onClick={onRetry}
            aria-label={`Try loading the ${unit} board again`}
          >
            Try again
          </button>
        </p>
      ) : state === "loading" ? (
        // Rows holding the board's height while another window is fetched, for
        // the reason the feed holds the day's: what a reader notices in that
        // moment is the page moving under the button they just pressed, not the
        // absence of a message. Nothing to read, so it is out of the reading
        // order and the one sentence worth saying is announced instead.
        <>
          <p className="sr-only" aria-live="polite">
            Loading the {unit}…
          </p>
          <ol className="leaderboard__list" aria-hidden="true">
            {Array.from({ length: BOARD_PLACEHOLDER_ROWS }, (_, i) => (
              <li
                key={i}
                className="leaderboard__row leaderboard__row--placeholder"
              />
            ))}
          </ol>
        </>
      ) : entries.length === 0 ? (
        <p className="leaderboard__status">{emptyMessage}</p>
      ) : (
        <>
          {/* What the numbers on the right are. Every other figure on the row
              says what it is in words -- "1 puzzle" -- and the scores, the ones
              the board is actually ranked by, said nothing at all: a reader had
              to infer 221.3 from context. One label over the column they belong
              to, above the rule, is the whole fix.

              Stacked in the order the numbers under it are stacked, so which
              label goes with which figure is a matter of reading straight down
              rather than of guessing. Two labels on one line would fit, and
              would leave a reader mapping left-to-right onto top-to-bottom --
              which is the confusion this is here to end, not a smaller version
              of it. */}
          <p className="leaderboard__columns">
            <span>Total score</span>
            <span>Best find</span>
          </p>
          {/* Fifteen rows. How many of them are on screen at once is the
              stylesheet's: three boards side by side on a laptop each cut to
              five with the rest one flick away, so no one of them runs the
              length of the page; one board on a phone running its full length,
              because there is nothing under it to push off.
              Focusable, because where it does scroll it has to be reachable by
              keyboard as well as by thumb; labelled so it is announced as the
              board it belongs to rather than as a bare scroll box. */}
          <ol
            className="leaderboard__list"
            tabIndex={0}
            aria-label={`${heading}, top ${entries.length}`}
          >
            {entries.map((entry) => (
              <Row
                key={entry.playerId}
                entry={entry}
                isYou={playerId === entry.playerId}
              />
            ))}
            {self && (
              <>
                {/* The gap between the top fifteen and the row below it, said in
                    the one way that needs no words. Decorative: the row itself
                    is marked "you" and carries its own rank, which is what a
                    screen reader needs from it. */}
                <li className="leaderboard__gap" aria-hidden="true">
                  ⋯
                </li>
                {/* Last in the same scrolling list, not a second list under it.
                    A player inside the fifteen already has their row docked to
                    the bottom of the board by the sticky rule, and a player
                    outside it had one sitting still underneath -- two different
                    answers to the same question, and the board looked shorter in
                    the docked case because the dock covered its last row. One
                    place, one behaviour: the row rides the bottom edge of the
                    box at every rank, and scrolling to the end of the list walks
                    it back into the flow after the gap.
                    Always "you": the server sends this row only to the player it
                    belongs to. */}
                <Row entry={self} isYou />
              </>
            )}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * One player's row: who they are, how much they played, and what it added up to.
 *
 * Under the total sits their best single find inside the board's window, as the
 * word and its score -- the same "word · score" line the app's board carries
 * under each name. The total says how much a week of playing came to, which
 * rewards turning up every day; the find says how good the best day *was*, which
 * is the other thing a player wants to be measured on, and the word is the part
 * of that they will recognise and want to show off.
 *
 * The word gives way before anything else on the row: it is cut with an ellipsis
 * rather than allowed to widen the score column and squeeze the name (see
 * `.leaderboard__best-word`), with the whole word kept in its tooltip.
 *
 * A score of zero means the find is a word today's dictionary no longer prices
 * and the row arrived without a stored frequency (see `scoreOf`). That is a gap
 * rather than a result, so the word stands alone instead of reading "0.0".
 *
 * Formatted by `formatScore` and not by hand. A single word's score carries two
 * decimals from Mythic up (9.5+), where the top ranks are decided on hundredths
 * and one decimal would print two different finds as the same number -- and it
 * is the fixed cutoffs the shown value keys off, so rounding it here would put
 * the number out of step with the rank the same word wears everywhere else in
 * the app. The total above it carries two decimals as well, through
 * `formatTotal` -- a total is a sum of numbers priced to the cent, so a tenth
 * of it is a digit the player cannot account for.
 */
function Row({ entry, isYou }: { entry: BoardEntry; isYou: boolean }) {
  /**
   * Whoever is top of this board, dressed as the winner they are.
   *
   * The plaques under the boards used to be where the gold went -- one line per
   * board about the window that had *closed*, which meant the page celebrated
   * three results nobody could see happening and dressed the live top row like
   * the fourteen under it. The prize belongs on the board: leading it is the
   * thing a player is playing for, and on a window that has closed the top row
   * is the champion anyway, so one treatment now says both.
   *
   * The trophy sits in the rank column rather than beside the name. Rank 1 is
   * what the trophy *means*, so it replaces the digit instead of crowding the
   * name -- and the column is already the width of three digits, which is more
   * than enough for it. The number itself stays in the reading order, because
   * "first" is the part a screen reader needs and a trophy glyph is not a rank.
   */
  const isLeader = entry.rank === 1;
  return (
    <li
      className={`leaderboard__row${isLeader ? " leaderboard__row--leader" : ""}${
        isYou ? " leaderboard__row--you" : ""
      }`}
    >
      <span className="leaderboard__rank">
        {isLeader ? (
          <>
            <span className="leaderboard__rank-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="sr-only">{entry.rank}</span>
          </>
        ) : (
          entry.rank
        )}
      </span>
      <span className="leaderboard__name">
        {entry.name}
        {isYou && <span className="leaderboard__you">you</span>}
      </span>
      <span className="leaderboard__score">{formatTotal(entry.score)}</span>
      {/* One strip under the name and the total, so the find's word can take
          the width the name column has rather than widening the score column
          it hangs under. */}
      <span className="leaderboard__detail">
        <span className="leaderboard__meta">
          {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"}
        </span>
        {entry.windowWord && (
          <span className="leaderboard__best">
            {/* The total above and the find below are told apart by their size
                and their position, which says nothing to a reader who gets the
                row as a sentence -- so the find is named to them and to nobody
                else. */}
            <span className="sr-only">best find </span>
            <span className="leaderboard__best-word" title={entry.windowWord}>
              {entry.windowWord}
            </span>
            {entry.windowScore > 0 && (
              <span className="leaderboard__best-score">
                {" · "}
                {formatScore(entry.windowScore)}
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  );
}
