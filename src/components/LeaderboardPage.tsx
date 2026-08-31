import { useCallback, useEffect, useRef, useState } from "react";
import { RarityBadge } from "./RarityBadge";
import {
  fetchBoards,
  fetchFoundWords,
  feedFloor,
  monthFloor,
  weekFloor,
  type FetchOptions,
  type BoardEntry,
  type Boards,
  type FoundWord,
} from "../game/leaderboard";
import { loadPlayerId } from "../game/player";
import { handleFor } from "../game/handle";
import {
  addDays,
  formatDateLabel,
  previousMonthName,
  todayDateString,
} from "../game/date";
import {
  monthChampionSettling,
  monthLabel,
  monthResetLabel,
  monthStart,
  nextMonthStart,
  previousMonthStart,
} from "../game/month";
import { weekChampionSettling, weekLabel, weekStart } from "../game/week";
import { dropForDate } from "../game/drop";
import { navigate } from "../routes";
import { setUsingSampleData, usingSampleData } from "../dev/sampleData";

type LoadState = "loading" | "ready" | "error";

/**
 * How often an open page re-checks for new finds.
 *
 * Thirty seconds. It used to be sixty, to match the CDN's own cache exactly --
 * which read as one decision but was two, and they add up rather than overlap:
 * a word waits out the shared cache and *then* waits out the rest of a poll, so
 * two sixties were most of a two-minute wait to see a word already found.
 *
 * The cache is fifteen seconds now (see api/leaderboard.ts), so the worst case
 * is a little under a minute and the usual case is half of that. Deliberately
 * not lowered to fifteen as well: past a point the page is asking more often
 * than a reader can notice, and every one of those is a request from every open
 * tab. Halving the poll buys most of the freshness for half the chatter.
 */
const REFRESH_MS = 30_000;
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
 * feed plays with the day it is leaving (see FoundWords).
 */
const BOARD_PLACEHOLDER_ROWS = 5;

/** The pair of windows the two boards count, as a request carries them. */
interface Windows {
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
 * The leaderboard, as its own page at /leaderboard.
 *
 * A page rather than a modal because that is what it behaves like: something you
 * link a friend to, open in a second tab, and leave with the back button. A
 * modal can do none of those, and a board is exactly the thing people want to
 * send each other.
 *
 * Both boards are always on screen -- side by side where there is room, stacked
 * into one column where there isn't. Showing both at once is the point of having
 * two: the interesting thing about a weekly board is how it differs from the
 * all-time one, and a player who has to click between them has to hold the first
 * in their head to see it. On a phone the same two boards become one scrolling
 * column, weekly first, since that is the one a new player can still win.
 */
export function LeaderboardPage() {
  const [boards, setBoards] = useState<Boards | null>(null);
  /**
   * The finds, held apart from the boards because they arrive apart from them:
   * the boards are fetched once and the feed is polled, so one piece of state
   * that held both would be re-set every minute with fifteen unchanged rows.
   */
  const [words, setWords] = useState<readonly FoundWord[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  /**
   * The feed's own load state, which is not the page's.
   *
   * It has one now because the feed can be asked a question whose answer is
   * legitimately nothing: an earlier day of the week nobody found a word on.
   * While the feed only ever showed today, an empty list and a list still in
   * flight looked the same and it did not matter -- the section simply wasn't
   * there yet. Stepping back makes them different answers to a question the
   * reader just asked, and each has to be said out loud.
   */
  const [feedState, setFeedState] = useState<LoadState>("loading");
  /**
   * The puzzle this page is about, fixed when the page opened.
   *
   * Read once rather than on every render, so it moves only on a refresh -- the
   * same way the game fixes its own date at mount (useDailyPuzzle). Both come
   * from the same clock, so they name the same drop, and the finds below are the
   * finds for the drop the player was just looking at.
   *
   * Read on every render instead, a tab left open would cross midnight and swap
   * the whole list to a new drop mid-poll, under a reader who never asked for it.
   */
  const [today] = useState(todayDateString);
  /**
   * The puzzle the finds below are about -- today's, until a reader steps back.
   *
   * Only the feed moves. The boards stay on this week and this month, because
   * those windows are not a day's worth of anything and stepping back a day
   * would say nothing about either. What a reader is asking for when they press
   * back is the thing that *is* a day: what everybody found on it.
   */
  const [viewing, setViewing] = useState(today);
  /**
   * How far back the feed steps (see feedFloor).
   *
   * Frozen beside `today` rather than recomputed as the page renders: both
   * answer "which window am I in", and a tab open across a midnight should carry
   * one answer to that rather than two that disagree.
   */
  const [floor] = useState(() => feedFloor(today));
  const isToday = viewing === today;
  const canGoBack = viewing > floor;
  /**
   * The live windows: the week and the month the player is playing in.
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
  const [week, setWeek] = useState(thisWeek);
  const [month, setMonth] = useState(thisMonth);
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
   * Re-read the finds for the day on screen, leaving everything else alone.
   *
   * A failure is swallowed once there is a list to keep: the last good one is a
   * truer thing to show than an empty section over one bad minute. A failure on
   * the *first* read of a day is different -- there is nothing behind it, and
   * silently showing an empty list would say nobody found anything -- so that
   * one becomes the feed's error state and offers a retry.
   */
  const refreshWords = useCallback(
    (options: FetchOptions = {}) => {
      fetchFoundWords(viewing, options)
        .then((found) => {
          setWords(found);
          setFeedState("ready");
        })
        .catch(() =>
          setFeedState((was) => (was === "loading" ? "error" : was)),
        );
    },
    [viewing],
  );

  /**
   * Step the feed to another day of the week.
   *
   * Sets the day and nothing else; the effect that follows `viewing` does the
   * fetching. Nothing is prefetched and no day is held in memory, so a reader
   * who never presses back costs exactly what they cost before -- one request,
   * for today. The list is cleared on the way,
   * because the heading names a drop and the rows under it have to be that
   * drop's; leaving yesterday's words under today's heading for the length of a
   * request would be the one wrong thing this could show. The empty list keeps
   * its height while it is in flight (see .found-words__list), so the page does
   * not collapse and spring back under the button that was just pressed.
   */
  const showDay = useCallback((date: string) => {
    setViewing(date);
    setWords([]);
    setFeedState("loading");
  }, []);

  /**
   * How tall the list was, so the next day can be the same height while it
   * loads.
   *
   * A ref rather than state: it is read only at the moment a day is swapped,
   * and nothing should re-render because a count was recorded. The day arriving
   * is very often about as long as the day leaving -- the same players on the
   * same drop -- so the rows the skeleton holds open are close to the rows that
   * replace them, and the page does not collapse and spring back under the
   * button that was just pressed.
   */
  const lastRowCount = useRef(0);
  useEffect(() => {
    if (words.length > 0) lastRowCount.current = words.length;
  }, [words]);

  /**
   * Fetch the boards, and the finds beside them.
   *
   * Two requests rather than one, and the split is not cosmetic: the boards
   * carry this player's id so they can return their own row, which makes that
   * response theirs alone, while the feed is the same for everybody and can be
   * cached once for all of them (see api/leaderboard.ts). Asking together would
   * have made the shared half private.
   *
   * The page's state follows the boards: a feed that fails is a section saying
   * so, while boards that fail are the page not loading.
   *
   * The boards only. The feed is fetched by the effect that follows the day on
   * screen, which is what keeps stepping back a day from re-reading two boards
   * that did not move -- they are this week and this month whichever day the
   * feed is showing.
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
    fetchBoards(today, { week, month })
      .then((loaded) => {
        if (request !== boardsRequest.current) return;
        setBoards(loaded);
        setShown({ week, month });
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
        setFailed({ week, month });
      });
  }, [today, week, month]);

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
      fetchBoards(today, { ...options, week, month })
        .then((loaded) => {
          if (request !== boardsRequest.current) return;
          setBoards(loaded);
          setShown({ week, month });
          boardsReadAt.current = Date.now();
        })
        .catch(() => {});
    },
    [today, week, month],
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
   * Read the finds for whichever day is on screen.
   *
   * Runs on the way in and again every time a reader steps to another day --
   * `refreshWords` is rebuilt only when `viewing` changes, so this is exactly
   * once per day looked at. A day nobody presses back to is never requested.
   */
  useEffect(() => {
    refreshWords();
  }, [refreshWords]);

  /**
   * Keep the finds feed current while the page is open.
   *
   * Today's finds land through the day now, so a page left open would otherwise
   * show a snapshot from whenever it was opened -- and the one thing a live list
   * must not be is stale without saying so.
   *
   * Every 60 seconds, which is not an arbitrary number: the endpoint is
   * CDN-cached for exactly that, so polling faster would return the same bytes
   * and polling slower would waste freshness already paid for. Nothing runs
   * while the tab is hidden -- a backgrounded tab is not being read -- and coming
   * back refreshes immediately rather than waiting out the rest of an interval.
   *
   * The finds and nothing else. The boards move slowly enough that a player
   * would have to be watching for a rank to change under them, and they are the
   * request carrying this player's id -- so polling them would mean a private,
   * uncached query every minute per open page, to redraw fifteen rows that had
   * almost certainly not moved.
   */
  useEffect(() => {
    // Wrapped rather than passed straight to setInterval: the timer hands its
    // callback nothing, but a bare reference would also accept the event object
    // that other callers pass, and the options argument is not a thing a timer
    // should ever be able to set.
    const tick = () => refreshWords();
    // Only today's feed is live. A past day of this week is finished -- the game
    // refuses a score for a puzzle played after its own date (see
    // game/leaderboard.ts, submitScore), so no word can ever be added to it --
    // and polling a list that cannot change would be a request a minute to be
    // handed the same rows back.
    let timer = isToday ? window.setInterval(tick, REFRESH_MS) : 0;
    function onVisibilityChange() {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      if (isToday) refreshWords();
      // The boards too, but only after a real absence. Coming back to a page
      // that has been open since this morning and finding last night's
      // standings is the one way they go properly stale -- while a glance at
      // another tab and back is not new information, and re-asking on every
      // return would put this player's own uncached query on a hair trigger.
      if (Date.now() - boardsReadAt.current > BOARDS_STALE_MS) refreshBoards();
      if (isToday) timer = window.setInterval(tick, REFRESH_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isToday, refreshBoards, refreshWords]);

  /**
   * Which words turned up since the last look, so the feed can show them
   * arriving rather than just quietly containing them.
   *
   * The first load marks nothing: everything is new to a page that has just
   * opened, and animating the whole list would say "the whole day just arrived"
   * when none of it did. After that, each refresh diffs against what was already
   * on screen and only the genuinely new ones move.
   *
   */
  const seenWords = useRef<Set<string> | null>(null);
  /**
   * Which day the set above is about, so stepping to another one starts a new
   * baseline rather than reading a whole different puzzle's words as arrivals.
   */
  const seenDay = useRef(today);
  const [arrived, setArrived] = useState<readonly string[]>([]);

  useEffect(() => {
    const found = words.map((entry) => entry.word);
    if (seenDay.current !== viewing) {
      // A day the reader asked for, arriving all at once because they asked --
      // which is not the same event as a word turning up under them, and gets
      // none of the animation that says so.
      seenDay.current = viewing;
      seenWords.current = found.length > 0 ? new Set(found) : null;
      setArrived([]);
      return;
    }
    if (seenWords.current === null) {
      // Nothing seen yet and nothing to see: an empty first response is not a
      // baseline, or the real first list would animate in as if it were new.
      if (found.length === 0) return;
      seenWords.current = new Set(found);
      return;
    }
    const fresh = found.filter((word) => !seenWords.current?.has(word));
    for (const word of found) seenWords.current.add(word);
    if (fresh.length === 0) return;
    setArrived(fresh);
    // Cleared once the animation is done, so a later re-render for some
    // unrelated reason does not replay it.
    const timer = window.setTimeout(() => setArrived([]), 1400);
    return () => window.clearTimeout(timer);
  }, [viewing, words]);

  /**
   * Refresh everything on the page, because a reader asked.
   *
   * Both halves, and with the cache-buster: a poll can be answered from the
   * shared copy, but somebody who taps this has just told you the list they are
   * looking at is not the one they want. Handing them the same bytes back would
   * make the button a decoration -- which is what a browser reload already is
   * here, since a client cannot bust a CDN's shared copy.
   *
   * No loading state on the sections themselves. The boards and the feed on
   * screen are the last true answer, and blanking them to fetch something the
   * reader can already see would be a worse page than a slightly old one -- the
   * same reason `refreshBoards` doesn't. The button says it is working; the
   * page stays readable underneath.
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    refreshWords({ fresh: true });
    refreshBoards({ fresh: true });
    // Long enough to read as a response to the tap, and it ends on its own
    // rather than on the requests: neither of them rejects in a way this cares
    // about, and a button that stayed disabled because a fetch hung would be
    // worse than one that came back a moment early.
    window.setTimeout(() => setRefreshing(false), 600);
  }, [refreshBoards, refreshWords]);

  return (
    <div className="app leaderboard-page">
      <header className="app__header">
        <button
          type="button"
          className="app__icon-button"
          onClick={() => navigate("game")}
          aria-label="Back to the puzzle"
          title="Back to the puzzle"
        >
          <span aria-hidden="true">‹</span>
        </button>
        {/* No subtitle. "Ranked by total score" described a column the boards
            already show, above two headings that say what each one counts. */}
        <div className="app__header-titles">
          <h1>Leaderboard</h1>
          {/* Your own handle, stated before the boards rather than left to be
              found in them.

              Nobody is ever told their name anywhere else -- it is derived from
              the player id and never typed (src/game/handle.ts) -- so the only
              way to learn it was to spot your own row, which is circular if
              spotting your row is what you came here to do. It goes in the
              header because that is the half of the answer that works before
              you have scrolled, and the half that still works when you are on
              neither board.

              Not the subtitle that used to sit here: "Ranked by total score"
              named a column the boards already show. This says the one thing
              the page cannot say twice.

              "Playing as" rather than "You're": nobody chose this handle, so a
              page asserting who you *are* is claiming more than it should. A
              role is what it actually is, and it is the frame that survives
              handles becoming rerollable. It is also the register the rest of
              the page is written in -- "Resets on Sundays", "Today's finds" --
              where a warmer line would be the one thing here raising its
              voice. */}
          {playerId && (
            <p className="leaderboard-page__handle">
              Playing as <strong>{handleFor(playerId)}</strong>
            </p>
          )}
        </div>
        {/* Where a spacer used to be, keeping the title centred against the
            back button -- and now doing something, which is the better way to
            hold a space. A refresh belongs on this page and nowhere else in the
            app: it is the one screen whose content is other people's. */}
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
      </header>

      <main>
        {/* Both of these hold the room the boards will take -- a heading and
            five rows -- so the finds below stay where they are when the boards
            land. The alternative is the whole page jumping down a screen a
            second after it opened, under a reader who had started reading. */}
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
            {/* The one rule both boards run on, stated before them rather than
                after: it is the condition a score has to meet to be on either
                list, so a reader wants it on the way in. Underneath the pair it
                had nothing to sit against -- a bullet adrift between the last
                row and the next section. Outside the grid below, so it sits
                against the first board rather than a column gap away from it. */}
            <ul className="leaderboard__rules">
              <li>Only puzzles played on the day they drop count</li>
            </ul>
            <div className="leaderboard__boards">
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
                // Who took the week this one replaced. Under the board rather
                // than in it: they are not competing in this week, and a row
                // among the live ones would read as though they were.
                //
                // On a week that has closed, the plaque is that week's own
                // winner instead -- the board above it is a final standing, and
                // the gold line is what it came to. Which is the same sentence
                // the live board's plaque makes about the week before it, one
                // window along, and on the turnover day the two name the same
                // player with the same caveat.
                champion={weekIsLive ? boards.lastWeek : championOf(boards.weekly)}
                championLabel={weekIsLive ? "Last week's champion" : "Champion"}
                // The day this plaque goes final, whichever week it ends up
                // naming: weeks close on Saturday and are settled everywhere by
                // Monday, so a weekly champion is always a Monday's news.
                //
                // Given for the live week and the one behind it, and no further
                // back: it is the day an empty plaque says it will be engraved,
                // and an older week nobody played is a week that never will be.
                // "Crowned on Monday" under it would be the one thing on this
                // page that is simply false, so it gets no plaque at all.
                championCrowning={
                  weekIsLive || week === addDays(thisWeek, -7)
                    ? "Monday"
                    : undefined
                }
                // And whether today is the Sunday that week turned over on --
                // the day it has not closed at the same moment for everybody
                // yet, so the name goes up with the caveat. See game/week.ts.
                // It covers the week just gone as well as the live one, because
                // that is the window whose top row can still move under a reader
                // who stepped back to it.
                championSettling={
                  weekChampionSettling(today) &&
                  (weekIsLive || week === addDays(thisWeek, -7))
                }
              />
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
                // This board's own window, one step back -- the same relation
                // last week's champion has to the weekly board. It used to be
                // the nearest thing available: a season had no completed season
                // behind it, so the month was borrowed as its closed window.
                // Now the board is the month, and the plaque under it is simply
                // the last one that finished. A month the reader has stepped
                // back to is finished itself, so it carries its own winner.
                champion={
                  monthIsLive ? boards.lastMonth : championOf(boards.monthly)
                }
                championLabel={
                  monthIsLive ? `${previousMonthName(today)}'s champion` : "Champion"
                }
                // The same, one window up: months close on the last and are
                // settled everywhere by the 2nd, so a monthly champion is
                // always the 2nd's news -- every month, which is what lets this
                // be a constant rather than a date to compute. Withheld from a
                // month older than the last one for the same reason the week's
                // is, so an unwon August of some past year says nothing rather
                // than promising an engraving that will never come.
                championCrowning={
                  monthIsLive || month === previousMonthStart(thisMonth)
                    ? "the 2nd"
                    : undefined
                }
                championSettling={
                  monthChampionSettling(today) &&
                  (monthIsLive || month === previousMonthStart(thisMonth))
                }
              />
            </div>
          </>
        )}

        {/* Not gated on the boards' state. The feed is its own request, answering
            its own question, and it is the part of this page that works from day
            one -- so boards that failed to load are a reason to show a retry
            above it, never a reason to hide finds that arrived perfectly well. */}
        {(words.length > 0 || canGoBack || !isToday) && (
          <FoundWords
            words={words}
            date={viewing}
            isToday={isToday}
            state={feedState}
            // Never nothing and never a screenful: a first load has no previous
            // day to measure, and a very long day should not open a hole the
            // list may not fill.
            placeholderRows={Math.min(Math.max(lastRowCount.current, 4), 12)}
            arrived={arrived}
            canGoBack={canGoBack}
            canGoForward={!isToday}
            onBack={() => showDay(addDays(viewing, -1))}
            onForward={() => showDay(addDays(viewing, 1))}
            onRetry={() => {
              setFeedState("loading");
              refreshWords();
            }}
          />
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
    </div>
  );
}

/**
 * Every word found on one puzzle, newest first.
 *
 * One puzzle at a time, and today's until a reader presses back. The drop in the
 * heading is what makes the list mean anything -- `asphyxiate` is just a word
 * until you know the day asked for PHY -- so the feed is keyed to a puzzle date
 * rather than to a clock, and stepping back moves the whole heading with it.
 *
 * Back as far as the week's reset and no further (see game/leaderboard.ts,
 * feedFloor). It is not an archive: it is the same window the board above it
 * ranks, which is the one a reader is already holding in their head. What it
 * fixes is a real loss -- a day's finds used to be gone at the reader's
 * midnight, so anybody who opened the page in the morning had missed them, and
 * the words are the part of this page people come back for.
 *
 * Every word rather than each player's best. The feed used to be built from the
 * one word per player the boards rank on, which made it a list of personal bests
 * and gave it a worse habit: that word is replaced when a player beats it, so a
 * find already on screen would disappear the moment its only finder did better.
 *
 * Its own section below the boards, rather than sharing the top of the page with
 * them. Both are lists of words, and a leaderboard row is a *player* while a
 * find is a *word* -- side by side that distinction is one nobody should have to
 * work out, so the two get separate headings and separate ground.
 *
 * A leaderboard tells you where you came; this tells you what you missed, and
 * "I did not know that was a word" is the thing players actually enjoy.
 */
function FoundWords({
  words,
  date,
  isToday,
  state,
  placeholderRows,
  arrived,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onRetry,
}: {
  words: readonly FoundWord[];
  date: string;
  isToday: boolean;
  state: LoadState;
  /** How many rows to hold open while a day loads. */
  placeholderRows: number;
  arrived: readonly string[];
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onRetry: () => void;
}) {
  // "Today's finds" while it is today's, and the day's own date once it isn't.
  // The date rather than "Yesterday": two steps back has no such word, and a
  // heading whose wording changes shape halfway down a week is harder to read
  // than one that always names the day.
  const heading = isToday
    ? "Today's finds"
    : `Finds from ${formatDateLabel(date)}`;
  return (
    <section className="found-words" aria-label={heading}>
      {/* No line under it. "Every word found on today's puzzle" restated the
          heading with the drop already beside it, and the boards above carry
          nothing under their headings either -- one of the three sections
          explaining itself was the odd one out. */}
      <h2 className="leaderboard__board-heading">
        {heading}
        <span className="found-words__drop">{dropForDate(date)}</span>
      </h2>
      {/* Both arrows always rendered, disabled at the ends rather than removed:
          a control that disappears at the edge of its range takes the shape of
          the thing with it, and a reader who has stepped back needs to see that
          forward exists before they know they can. */}
      <div className="found-words__nav">
        <button
          type="button"
          className="found-words__arrow"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Finds from the day before"
        >
          <span aria-hidden="true">‹</span>
          <span>Previous day</span>
        </button>
        <button
          type="button"
          className="found-words__arrow"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Finds from the day after"
        >
          <span>Next day</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {/* One slot for whatever the day has to say, so the three answers -- a
          list, nothing, or a failure -- all occupy the same ground and the
          sections below do not move as a reader steps between days. */}
      {state === "error" ? (
        <p className="leaderboard__status" aria-live="polite">
          Couldn't load these finds.{" "}
          {/* Named apart from the boards' retry above it, which reads the same
              and does something else. Two buttons called "Try again" on one
              page are one button to anybody who reaches them by name. */}
          <button
            type="button"
            className="leaderboard__retry"
            onClick={onRetry}
            aria-label="Try loading the finds again"
          >
            Try again
          </button>
        </p>
      ) : state === "loading" ? (
        // Rows rather than a spinner, as many as the day just left had: the
        // request is one small query and usually lands in a moment, and what a
        // reader notices in that moment is the page under their thumb jumping,
        // not the absence of a message. Hidden from the reading order entirely
        // -- there is nothing here to read -- with the one sentence that is
        // worth saying announced instead.
        <>
          <p className="sr-only" aria-live="polite">
            Loading the finds…
          </p>
          <ul className="found-words__list" aria-hidden="true">
            {Array.from({ length: placeholderRows }, (_, i) => (
              <li
                key={i}
                className="found-words__item found-words__item--placeholder"
              />
            ))}
          </ul>
        </>
      ) : words.length === 0 ? (
        <p className="leaderboard__status">
          {isToday
            ? "Nobody's found anything yet today."
            : "Nobody found anything on this puzzle."}
        </p>
      ) : (
        <ul className="found-words__list">
          {words.map((found) => (
            <li
              key={found.word}
              className={`found-words__item${
                arrived.includes(found.word)
                  ? " found-words__item--arrived"
                  : ""
              }`}
            >
              <span className="found-words__word">{found.word}</span>
              <RarityBadge rarity={found.rarity} zipf={found.zipf} />
              {found.finders > 1 && (
                <span className="found-words__finders">
                  {found.finders} players
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The winner of a window that has closed: the top row of its final standing.
 *
 * Taken from the board itself rather than asked of the server, because on a
 * closed window the board *is* the answer -- the row ranked first is the
 * champion, and a second query for it could only ever agree or be wrong. Null on
 * a window nobody scored in, and on the impossible board whose first row is not
 * rank 1, which is a thing to decline to crown rather than to guess at.
 */
function championOf(entries: BoardEntry[]): BoardEntry | null {
  const top = entries[0];
  return top && top.rank === 1 ? top : null;
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
  /**
   * Who won a closed window: the one before this board's on the live board, and
   * this board's own once the reader has stepped back to a window that finished.
   */
  champion?: BoardEntry | null;
  /** What that window was: "Last week's champion", "July's champion". */
  championLabel?: string;
  /**
   * When this plaque goes final: "Monday", "the 2nd".
   *
   * A constant per board rather than a date, because it is the same answer for
   * every window the board will ever name -- a weekly champion is always a
   * Monday's news and a monthly one always the 2nd's. It does two jobs from the
   * one word: an empty plaque says when it gets engraved, and a plaque named on
   * its turnover day says how long the name can still change for.
   *
   * Left off entirely for a window older than the last one, which has neither
   * job to do: it is settled, and it will never be engraved if nobody won it.
   * An empty plaque there would promise a name that is never coming.
   */
  championCrowning?: string;
  /**
   * Whether today is the day this board's window turned over, and so the day the
   * named winner can still change (see game/week.ts). True on Sunday for the
   * week and on the first for the month; false every other day -- and false on
   * an older window the reader stepped back to, which closed long before either
   * of those.
   */
  championSettling?: boolean;
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
  champion,
  championLabel,
  championCrowning,
  championSettling,
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
          {/* What the big number on the right is. Every other figure on the row
              says what it is in words -- "1 puzzle" -- and the score, the one
              the board is actually ranked by, said nothing at all: a reader had
              to infer 221.3 from context. One label over the column it belongs
              to, above the rule, is the whole fix. */}
          <p className="leaderboard__columns">Total score</p>
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
      {/* Outside the empty check on purpose: a board with nobody on it yet is
          exactly when last week's winner is the only thing there is to show,
          and the week that just ended is the reason this week's is empty.

          Two states, and only two: there is a winner of the closed window, or
          there is not. If there is, the plaque names them -- on every day of the
          week, the turnover day included. It used to go blank on that day
          because the window closes at each player's own midnight and a late
          score can still displace the name (see game/week.ts), but the day the
          week's result is the freshest thing on the page is the worst day to say
          nothing: a player coming back for their own win found an empty box. So
          the name goes up and the caveat goes beside it, which is what
          `championSettling` now buys.

          The empty plaque is left to the one thing it is actually true of -- a
          window nobody won, a month before the game existed -- and says the day
          it gets engraved, because that is the question an empty box raises.
          Which is why a champion no longer needs `championCrowning` to appear:
          a window the reader stepped back past the last one has no engraving
          day worth naming, but it can perfectly well have a winner. */}
      {state === "ready" &&
        (champion && championLabel ? (
          <Champion
            entry={champion}
            label={championLabel}
            provisional={championSettling}
            finalOn={championCrowning}
          />
        ) : championCrowning ? (
          <ChampionPending crowning={championCrowning} />
        ) : null)}
    </section>
  );
}

/**
 * The winner of the window this board just left behind.
 *
 * Both boards above are windows that move: "this week" resets under the reader
 * every Sunday and the season runs to New Year, so a week somebody won used to
 * disappear at midnight with nothing anywhere to say it happened. This is the
 * standing record of it -- the one name, the score it took, and which window.
 *
 * Dressed differently from a row, and not for decoration: it is the one line on
 * the page about a result that is *final*, where everything above it is a
 * standing that will have moved by tomorrow. The trophy and the gold say
 * "finished" in the shortest way available, and set it apart from the live rows
 * it sits under so nobody reads it as sixteenth place.
 *
 * `provisional` is the one day that is not final -- the day the window turned
 * over, when players behind this reader's clock are still finishing it. The name
 * goes up all the same, because it is right for almost everybody and it is the
 * day the result is worth reading; the "i" beside it is where the asterisk
 * lives.
 *
 * Folded behind that "i" rather than printed, because of who each state is for.
 * Almost everybody reading on the turnover day is looking at the right name and
 * wants the name -- a standing disclaimer under it would cast doubt on a result
 * that is correct for them. The reader it is for is the one who came back to
 * check a close finish, and a mark they can ask is enough for that.
 *
 * A button and not a `title`: a tooltip is a thing you hover, and most of this
 * game's readers are on a phone with nothing to hover with.
 */
function Champion({
  entry,
  label,
  provisional,
  finalOn,
}: {
  entry: BoardEntry;
  label: string;
  /** Today is this window's turnover day, so the name can still change. */
  provisional?: boolean;
  /**
   * When it stops being able to: "Monday", "the 2nd".
   *
   * Absent only on a window too old to have a turnover day worth naming -- a
   * week the reader stepped back past the last one -- which is exactly the case
   * that is never `provisional`, so the sentence below is never left with a
   * hole in it.
   */
  finalOn?: string;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <p className="leaderboard__champion">
      <span className="leaderboard__champion-trophy" aria-hidden="true">
        🏆
      </span>
      <span className="leaderboard__champion-label">
        {label}
        {provisional && (
          <button
            type="button"
            className="leaderboard__champion-info"
            aria-expanded={noteOpen}
            // The icon is a glyph with no reading of its own, so the control
            // says what it opens rather than what it looks like.
            aria-label="Why this winner can still change"
            onClick={() => setNoteOpen((wasOpen) => !wasOpen)}
          >
            <span aria-hidden="true">i</span>
          </button>
        )}
      </span>
      <span className="leaderboard__champion-name">{entry.name}</span>
      <span className="leaderboard__champion-score">
        {entry.score.toFixed(1)}
        {/* The number is labelled once for a reader who cannot see the column
            it lines up under -- the boards' own "Total score" header is above
            the rows, not above this. */}
        <span className="sr-only"> total score</span>
      </span>
      {/* Under the whole plaque rather than beside the label it belongs to: it
          is a sentence, and a sentence in that column would push the name and
          the score apart every time it opened.
          Always in the reading order, shown or not -- it is one short sentence,
          and a screen reader that had to find and press the button to hear it
          would be worse served than the eye that can see the "i". */}
      {provisional && (
        <span
          className={`leaderboard__champion-note${noteOpen ? "" : " sr-only"}`}
        >
          Not everyone has finished playing yet. The official winner can change
          until {finalOn}.
        </span>
      )}
    </p>
  );
}

/**
 * The plaque with nobody on it, saying when it will have somebody.
 *
 * It exists because the awarded plaque's absence read as a mistake rather than
 * as a fact. The monthly board's closed window is the month before it, and the
 * game is younger than that -- so the column simply stopped after its last row
 * while the weekly one beside it ended in gold, and two boards side by side that
 * end differently look broken rather than young.
 *
 * A blank engraving line instead of a name, and no score: the shape of a result
 * that is coming, without inventing any part of it.
 *
 * The label is the day, because the day is the only thing there is to say. This
 * read "Coming up" first, which told a reader the box gets filled and nothing
 * else -- and on the monthly board, where an unwon window can sit there for a
 * month, "coming up" is a month of saying nothing. Naming the day answers the
 * question the empty box actually raises.
 *
 * Not the window's own dates, though, which is what "Coming up" was avoiding:
 * the board's heading two lines above says when it *resets*, and this says when
 * it gets *crowned*. They are a day apart on purpose and describe different
 * things -- the board turning over, and this plaque being engraved.
 *
 * Only ever an unwon window now. It stood in for the turnover day as well while
 * the plaque was held closed then, which is the one state it was wrong for: a
 * window somebody did win, saying nobody had. That day names its winner and
 * footnotes it instead (see `Champion`).
 */
function ChampionPending({ crowning }: { crowning: string }) {
  return (
    <p className="leaderboard__champion leaderboard__champion--pending">
      <span className="leaderboard__champion-trophy" aria-hidden="true">
        🏆
      </span>
      <span className="leaderboard__champion-label">Crowned on {crowning}</span>
      {/* The line is the whole message to anybody who can see it and says
          nothing at all to anybody who cannot, so it is hidden from the reading
          order and the sentence it stands for is spelled out instead. */}
      <span className="leaderboard__champion-blank" aria-hidden="true" />
      {/* "Champion" and not "last week's champion": an unwon plaque is about
          whichever window fills it next rather than the one it sits under. The
          day is the part that is true either way. */}
      <span className="sr-only">Champion crowned on {crowning}</span>
    </p>
  );
}

/**
 * One player's row: who they are, how much they played, and what it added up to.
 *
 * The row used to carry the player's best find inside the board's window --
 * `quixotic 7.9` beside the count. It is held back for now, and the reason is
 * about the number rather than the word: a find is shown with what it scored,
 * and the scoring system is still being corrected, so a word that reads as a 7.9
 * today may not tomorrow. A leaderboard is the wrong place to publish a number
 * that moves. The words themselves are still on the page, under Today's finds,
 * where they are the day's finds rather than a claim about a player.
 *
 * The server still sends the find (`windowWord`), and the client still prices it
 * -- putting it back is this component and nothing else.
 */
function Row({ entry, isYou }: { entry: BoardEntry; isYou: boolean }) {
  return (
    <li className={`leaderboard__row${isYou ? " leaderboard__row--you" : ""}`}>
      <span className="leaderboard__rank">{entry.rank}</span>
      <span className="leaderboard__name">
        {entry.name}
        {isYou && <span className="leaderboard__you">you</span>}
      </span>
      <span className="leaderboard__meta">
        {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"}
      </span>
      <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
    </li>
  );
}
