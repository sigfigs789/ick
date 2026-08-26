import { useCallback, useEffect, useRef, useState } from "react";
import { RarityBadge } from "./RarityBadge";
import {
  fetchBoards,
  fetchFoundWords,
  type FetchOptions,
  type BoardEntry,
  type Boards,
  type FoundWord,
} from "../game/leaderboard";
import { loadPlayerId } from "../game/player";
import { previousMonthName, todayDateString } from "../game/date";
import { monthResetLabel } from "../game/month";
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
   * Re-read the finds, leaving everything else alone.
   *
   * A failure here is swallowed on purpose: the last good list stays on screen,
   * which is a truer thing to show than an empty section over one bad minute.
   */
  const refreshWords = useCallback((options: FetchOptions = {}) => {
    fetchFoundWords(today, options)
      .then(setWords)
      .catch(() => {});
  }, [today]);

  /**
   * Fetch the boards, and the finds beside them.
   *
   * Two requests rather than one, and the split is not cosmetic: the boards
   * carry this player's id so they can return their own row, which makes that
   * response theirs alone, while the feed is the same for everybody and can be
   * cached once for all of them (see api/leaderboard.ts). Asking together would
   * have made the shared half private.
   *
   * The page's state follows the boards: a feed that fails is a section that
   * isn't there, while boards that fail are the page not loading.
   */
  const load = useCallback(() => {
    setState("loading");
    fetchBoards(today)
      .then((loaded) => {
        setBoards(loaded);
        boardsReadAt.current = Date.now();
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      .catch(() => setState("error"));
    refreshWords();
  }, [refreshWords, today]);


  /**
   * Re-read the boards without disturbing the page.
   *
   * No loading state and no error state: the boards already on screen are the
   * last true answer, and replacing them with a spinner -- or with "couldn't
   * load" -- to fetch something the reader can already see would be a worse
   * page than a slightly old one. It swaps them or it leaves them.
   */
  const refreshBoards = useCallback((options: FetchOptions = {}) => {
    fetchBoards(today, options)
      .then((loaded) => {
        setBoards(loaded);
        boardsReadAt.current = Date.now();
      })
      .catch(() => {});
  }, [today]);


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
    let timer = window.setInterval(tick, REFRESH_MS);
    function onVisibilityChange() {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      refreshWords();
      // The boards too, but only after a real absence. Coming back to a page
      // that has been open since this morning and finding last night's
      // standings is the one way they go properly stale -- while a glance at
      // another tab and back is not new information, and re-asking on every
      // return would put this player's own uncached query on a hair trigger.
      if (Date.now() - boardsReadAt.current > BOARDS_STALE_MS) refreshBoards();
      timer = window.setInterval(tick, REFRESH_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshBoards, refreshWords]);

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
  const [arrived, setArrived] = useState<readonly string[]>([]);

  useEffect(() => {
    const found = words.map((entry) => entry.word);
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
  }, [words]);

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
              <button type="button" className="leaderboard__retry" onClick={() => load()}>
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
                heading="This week"
                // Beside the heading rather than under it: the two boards sit
                // shoulder to shoulder, and a line under one of them and not
                // the other pushed its rows half a line down -- two lists side
                // by side that do not start level read as a mistake. No dates
                // on either board now. A window you are already in does not
                // need its days spelled out; when it turns over is the one
                // thing worth saying, and both boards say exactly that.
                headingDetail="Resets on Sundays"
                entries={boards.weekly}
                self={boards.weeklySelf}
                emptyMessage="Nobody's scored yet this week. Be first."
                playerId={playerId}
                // Who took the week this one replaced. Under the board rather
                // than in it: they are not competing in this week, and a row
                // among the live ones would read as though they were.
                champion={boards.lastWeek}
                championLabel="Last week's champion"
              />
              <Board
                heading="Monthly"
                // The weekday it turns over on and the date that is, which for
                // a month is computed (see game/month.ts) rather than the
                // constant the week can get away with -- and the weekday leads,
                // because a bare "Sep 1" is a date a reader still has to place
                // in their own week. This board used to be "Season 1" with
                // the season's two dates under it -- a window a reader had to
                // be told the ends of, because they were picked by hand. A
                // month has ends everybody already knows.
                headingDetail={monthResetLabel(today)}
                entries={boards.monthly}
                self={boards.monthlySelf}
                emptyMessage="Nobody's scored yet this month. Be first."
                playerId={playerId}
                // This board's own window, one step back -- the same relation
                // last week's champion has to the weekly board. It used to be
                // the nearest thing available: a season had no completed season
                // behind it, so the month was borrowed as its closed window.
                // Now the board is the month, and the plaque under it is simply
                // the last one that finished.
                champion={boards.lastMonth}
                championLabel={`${previousMonthName(today)}'s champion`}
              />
            </div>
          </>
        )}

        {/* Not gated on the boards' state. The feed is its own request, answering
            its own question, and it is the part of this page that works from day
            one -- so boards that failed to load are a reason to show a retry
            above it, never a reason to hide finds that arrived perfectly well. */}
        {words.length > 0 && (
          <FoundWords words={words} today={today} arrived={arrived} />
        )}

        <button type="button" className="leaderboard-page__back" onClick={() => navigate("game")}>
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
 * Every word found on today's puzzle, newest first.
 *
 * One puzzle only, and it is the puzzle the player in front of it is on. A week
 * of history behind it read as an archive, and the drop in the heading is what
 * makes the list mean anything: `asphyxiate` is just a word until you know the
 * day asked for PHY. That is also why the feed is keyed to a puzzle date rather
 * than to a clock -- the drop is the thing these words have in common.
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
  today,
  arrived,
}: {
  words: readonly FoundWord[];
  today: string;
  arrived: readonly string[];
}) {
  return (
    <section className="found-words" aria-label="Today's finds">
      {/* No line under it. "Every word found on today's puzzle" restated the
          heading with the drop already beside it, and the boards above carry
          nothing under their headings either -- one of the three sections
          explaining itself was the odd one out. */}
      <h2 className="leaderboard__board-heading">
        Today's finds
        <span className="found-words__drop">{dropForDate(today)}</span>
      </h2>
      <ul className="found-words__list">
        {words.map((found) => (
          <li
            key={found.word}
            className={`found-words__item${
              arrived.includes(found.word) ? " found-words__item--arrived" : ""
            }`}
          >
            <span className="found-words__word">{found.word}</span>
            <RarityBadge rarity={found.rarity} zipf={found.zipf} />
            {found.finders > 1 && (
              <span className="found-words__finders">{found.finders} players</span>
            )}
          </li>
        ))}
      </ul>
    </section>
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
  /** Who won this board's last completed window, when anybody did. */
  champion?: BoardEntry | null;
  /** What that window was: "Last week's champion", "July's champion". */
  championLabel?: string;
}

/**
 * One board: the top fifteen, ranked by total score exactly as the database
 * ordered it, and then you.
 *
 * The board is short because a leaderboard is read, not scrolled -- but a short
 * board that stops at fifteen tells everybody below it nothing at all, and "am I
 * anywhere" is the question a player brings to this page. So the server sends
 * their own row back when it falls outside the fifteen, and it goes underneath,
 * pinned outside the scrolling list where it cannot be scrolled away from. The
 * rank on it is the real one -- 61st of everybody, not 16th of what fits.
 */
function Board({
  heading,
  headingDetail,
  entries,
  self,
  emptyMessage,
  playerId,
  champion,
  championLabel,
}: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">
        {heading}
        {headingDetail && <span className="leaderboard__board-dates">{headingDetail}</span>}
      </h2>
      {entries.length === 0 ? (
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
              <Row key={entry.playerId} entry={entry} isYou={playerId === entry.playerId} />
            ))}
          </ol>
          {self && (
            <>
              {/* The gap between the board and the row below it, said in the one
                  way that needs no words. Decorative: the row itself is marked
                  "you" and carries its own rank, which is what a screen reader
                  needs from it. */}
              <p className="leaderboard__gap" aria-hidden="true">
                ⋯
              </p>
              <ol className="leaderboard__list leaderboard__list--self" start={self.rank}>
                {/* Always "you": the server sends this row only to the player it
                    belongs to. */}
                <Row entry={self} isYou />
              </ol>
            </>
          )}
        </>
      )}
      {/* Outside the empty check on purpose: a board with nobody on it yet is
          exactly when last week's winner is the only thing there is to show,
          and the week that just ended is the reason this week's is empty. */}
      {champion && championLabel && <Champion entry={champion} label={championLabel} />}
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
 */
function Champion({ entry, label }: { entry: BoardEntry; label: string }) {
  return (
    <p className="leaderboard__champion">
      <span className="leaderboard__champion-trophy" aria-hidden="true">
        🏆
      </span>
      <span className="leaderboard__champion-label">{label}</span>
      <span className="leaderboard__champion-name">{entry.name}</span>
      <span className="leaderboard__champion-score">
        {entry.score.toFixed(1)}
        {/* The number is labelled once for a reader who cannot see the column
            it lines up under -- the boards' own "Total score" header is above
            the rows, not above this. */}
        <span className="sr-only"> total score</span>
      </span>
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
        {isYou && <span className="leaderboard__you"> you</span>}
      </span>
      <span className="leaderboard__meta">
        {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"}
      </span>
      <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
    </li>
  );
}
