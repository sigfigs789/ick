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
import { loadPlayerId } from "../game/player";
import { handleFor } from "../game/handle";
import { accountName } from "../game/player";
import { addDays, formatDateLabel, todayDateString } from "../game/date";
import {
  monthLabel,
  monthResetLabel,
  monthStart,
  nextMonthStart,
  previousMonthStart,
} from "../game/month";
import { weekLabel, weekStart } from "../game/week";
import { formatScore } from "../game/dictionary";
import { navigate } from "../routes";
import { setUsingSampleData, usingSampleData } from "../dev/sampleData";

type LoadState = "loading" | "ready" | "error";

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

/** Which board a phone is showing, when it can only show one. */
type BoardWindow = "daily" | "weekly" | "monthly";

/**
 * The pills, in the order the boards are in.
 *
 * Named for the live window rather than for the one on screen: a reader who has
 * stepped the day board back to Sep 5 still picked it by pressing "Today", and a
 * pill that renamed itself under them would be a control whose label depends on
 * what it did last. The heading inside the board is where the window being read
 * is named, and it is the thing that moves.
 */
const BOARD_TABS: { key: BoardWindow; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
];

/** The three windows the boards count, as a request carries them. */
interface Windows {
  day: string;
  week: string;
  month: string;
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
 * Three windows of the same game, shortest first. On a laptop all three are on
 * screen at once, which is the point of having three: the interesting thing
 * about any one of them is how it differs from the others -- who is new today,
 * who is always there -- and a reader who has to click between them has to hold
 * the first in their head to see it. Today leads because it is the one anybody
 * can still win from nothing; by Thursday a week's board is mostly a week's
 * play, and a month's is a month's.
 *
 * On a phone that comparison is not on offer at any price -- three boards stack,
 * and the month lands two screens down where nobody scrolls to it. So on a phone
 * the pills take over and show one at a time, the way the phone app has always
 * shown them. A browser is left alone at every width: dragged narrow it stacks
 * the three boards exactly as it always has, which is why the stylesheet asks
 * about the pointer as well as the width (see `.leaderboard__windows`).
 *
 * The choosing lives in the stylesheet (`.leaderboard__windows`,
 * `.leaderboard__boards[data-window]`): all three boards are always rendered and
 * always fetched -- they come back in one response anyway -- and the layout
 * decides how many of them the surface is able to say.
 *
 * The finds that used to sit under all this are their own page now (see
 * FoundWordsPage): they are a list of *words* under two lists of *players*, they
 * are read for a different reason, and they were the live half of a page whose
 * other half had not moved since breakfast.
 */
export function LeaderboardPage() {
  const [boards, setBoards] = useState<Boards | null>(null);
  const [state, setState] = useState<LoadState>("loading");
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
  const [today] = useState(todayDateString);
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
   * Which of the three a phone is showing.
   *
   * Only ever read by the pills and by the `data-window` the stylesheet keys off
   * (see `.leaderboard__boards[data-window]`), so in a browser this is state that
   * changes nothing: every board is on the page there, and the pills that would
   * move this are not. Kept in one place rather than behind a matchMedia hook
   * because which surface gets which layout is a layout fact, and the stylesheet
   * is where this page keeps its layout facts -- a second copy of the query in
   * JavaScript would be a condition that has to be changed twice.
   *
   * Today, because it is the one a player can still enter from nothing -- the
   * same reason it leads the row on a wide screen.
   */
  const [boardWindow, setBoardWindow] = useState<BoardWindow>("daily");
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
  const [shown, setShown] = useState<Windows | null>(null);
  const [failed, setFailed] = useState<Windows | null>(null);
  /**
   * Each board's state, which after the first load is no longer the page's: one
   * board can be waiting on a window the reader stepped to while the other is
   * sitting on rows that never moved.
   */
  const dayState = boardState(day, shown?.day, failed?.day);
  const weekState = boardState(week, shown?.week, failed?.week);
  const monthState = boardState(month, shown?.month, failed?.month);
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
    setState((was) => (was === "ready" ? was : "loading"));
    setFailed(null);
    const request = ++boardsRequest.current;
    fetchBoards(today, { day, week, month })
      .then((loaded) => {
        if (request !== boardsRequest.current) return;
        setBoards(loaded);
        setShown({ day, week, month });
        boardsReadAt.current = Date.now();
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      // Recorded against the windows that were asked for, so the board that was
      // waiting is the one that reports it.
      .catch(() => {
        if (request !== boardsRequest.current) return;
        setState((was) => (was === "ready" ? was : "error"));
        setFailed({ day, week, month });
      });
  }, [today, day, week, month]);

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
      fetchBoards(today, { ...options, day, week, month })
        .then((loaded) => {
          if (request !== boardsRequest.current) return;
          setBoards(loaded);
          setShown({ day, week, month });
          boardsReadAt.current = Date.now();
        })
        .catch(() => {});
    },
    [today, day, week, month],
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
          {/* The one rule all three boards run on, stated before them rather
              than after: it is the condition a score has to meet to be on any
              of the lists, so a reader wants it on the way in. Underneath them
              it had nothing to sit against -- a bullet adrift under the last
              row. Outside the grid below, so it sits against the first board
              rather than a column gap away from it. */}
          <ul className="leaderboard__rules">
            <li>Only puzzles played on the day they drop count</li>
          </ul>
          {/* Which board, on a phone.
              A phone stacks the three boards, and three stacked boards are two
              screens of scrolling to reach the month -- a board you have to go
              looking for is one most people never see. Pills rather than the
              accordion or the select the stacked layout could also have used:
              the phone app has had this exact control at the top of this exact
              screen since it shipped (native/src/screens/LeaderboardScreen.tsx),
              and somebody who plays in both should not have to learn the page
              twice.
              A browser never shows these, at any width: it stacks the boards the
              way it always has. The stylesheet is what decides that, and asks
              about the pointer as well as the width to do it. */}
          <div
            className="leaderboard__windows"
            role="tablist"
            aria-label="Which leaderboard"
          >
            {BOARD_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`leaderboard-tab-${tab.key}`}
                aria-selected={tab.key === boardWindow}
                aria-controls={`leaderboard-board-${tab.key}`}
                className="leaderboard__window"
                onClick={() => setBoardWindow(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="leaderboard__boards" data-window={boardWindow}>
            <Board
              // "Today" while it is today's, and the day's own date once it
              // isn't -- the same wording the finds page heads a day with, for
              // the same reason: two steps back has no word like "yesterday",
              // and a heading whose shape changes halfway down a week is
              // harder to read than one that always names the day.
              boardWindow="daily"
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
            <Board
              boardWindow="weekly"
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
            <Board
              boardWindow="monthly"
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

      {/* Development only. `import.meta.env.DEV` is a compile-time constant, so
          this whole branch -- and the fixture it reaches -- is dropped from a
          production build. Same trick as the "Reset answers" button. */}
      {import.meta.env.DEV && (
        <label className="dev-sample-toggle">
          <input
            type="checkbox"
            checked={usingSampleData()}
            onChange={(e) => {
              setUsingSampleData(e.target.checked);
              load();
            }}
          />
          Use sample data
        </label>
      )}
    </main>
  );
}

interface BoardProps {
  /**
   * Which of the three this is, for the pills to point at and the stylesheet to
   * show or hide when a phone can only hold one.
   */
  boardWindow: BoardWindow;
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
  boardWindow,
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
    <section
      className="leaderboard__board"
      id={`leaderboard-board-${boardWindow}`}
      data-window={boardWindow}
      aria-label={heading}
    >
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
          {/* Five rows of the fifteen, and the rest scrolled to.
              A board that runs its full length pushes the next section off the
              screen entirely, so the page reads as one column of names with
              headings in it -- the boards were what made the sections hard to
              tell apart. Five rows is a top five, which is the part anybody
              reads first, and the whole fifteen is one flick away.
              Focusable, because a region that scrolls has to be reachable by
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
 * Under the total sits their best single find inside the board's window -- a
 * bare number, no word and no label. The total says how much a week of playing
 * came to, which rewards turning up every day; the number under it says how good
 * the best day *was*, which is the other thing a player wants to be measured on,
 * and the two read as one column of scores rather than as a score and a caption.
 *
 * The word itself is not here on purpose. It is the day's find under Today's
 * finds, where it belongs to the day; on a row it would be a claim about a
 * player, and it would need its own name-length column in a row that already
 * wraps long names.
 *
 * Zero means the find is a word today's dictionary no longer prices and the row
 * arrived without a stored frequency (see `scoreOf`). That is a gap rather than
 * a result, so the line is left off instead of reading "0.0".
 *
 * Formatted by `formatScore` and not by hand. A single word's score carries two
 * decimals from Mythic up (9.5+), where the top ranks are decided on hundredths
 * and one decimal would print two different finds as the same number -- and it
 * is the fixed cutoffs the shown value keys off, so rounding it here would put
 * the number out of step with the rank the same word wears everywhere else in
 * the app. The total above it stays at one decimal: it is a sum, which is the
 * line `formatScore` itself draws.
 */
/**
 * What to call the player reading the page.
 *
 * The same rule the board's own rows follow (see `nameFor` in
 * game/leaderboard.ts): an account is named, a browser is given a handle. They
 * have to agree, or the line above the board tells the player one name while
 * their row on it carries another.
 */
function selfName(playerId: string): string {
  const account = accountName();
  return account ? `u/${account}` : handleFor(playerId);
}

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
      <span className="leaderboard__meta">
        {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"}
      </span>
      <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
      {entry.windowScore > 0 && (
        <span className="leaderboard__best">
          {/* Two numbers stacked in one column are told apart by their size and
              their position, which says nothing to a reader who gets the row as
              a sentence -- so the second one is named to them and to nobody
              else. */}
          <span className="sr-only">best find </span>
          {formatScore(entry.windowScore)}
        </span>
      )}
    </li>
  );
}
