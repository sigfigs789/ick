import { useCallback, useEffect, useRef, useState } from "react";
import { RarityBadge } from "./RarityBadge";
import {
  backfillHistory,
  fetchBoards,
  fetchFoundWords,
  seasonName,
  seasonRange,
  type BoardEntry,
  type Boards,
  type FoundWord,
} from "../game/leaderboard";
import { joinBoard, loadPlayerId } from "../game/player";
import { formatDateLabel, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { navigate } from "../routes";
import { trackLeaderboardJoined } from "../analytics";
import { setUsingSampleData, usingSampleData } from "../dev/sampleData";

type LoadState = "loading" | "ready" | "error";

/** How often an open page re-checks for new finds. Matches the CDN's own cache. */
const REFRESH_MS = 60_000;

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
  const [playerId, setPlayerId] = useState<string | null>(() => loadPlayerId());
  /** Days imported from this browser's history on joining, for one message. */
  const [imported, setImported] = useState<number | null>(null);

  /**
   * Re-read the finds, leaving everything else alone.
   *
   * A failure here is swallowed on purpose: the last good list stays on screen,
   * which is a truer thing to show than an empty section over one bad minute.
   */
  const refreshWords = useCallback(() => {
    fetchFoundWords(today)
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
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      .catch(() => setState("error"));
    refreshWords();
  }, [refreshWords, today]);


  /**
   * Opening this page is the joining.
   *
   * There used to be a button and a paragraph under it explaining that there is
   * no account, no email and no name to invent. All of that is still true, and
   * none of it needed saying: somebody who has opened the leaderboard has said
   * what they wanted, and asking them to say it again with a tap was a step that
   * only ever stood between a player and their own row.
   *
   * So the id is minted here, on the first visit, and the browser's history goes
   * up with it. The trade is worth stating plainly: a player who opens this page
   * to look at other people's scores is now on the board themselves, where
   * before they had to ask for it. What goes up is what the board shows -- an
   * id this browser made up, and the words they found -- and nothing about it
   * reaches back into the game, so the cost of being wrong about somebody's
   * intent is a row with their own handle on it.
   */
  useEffect(() => {
    if (!loadPlayerId()) {
      const id = joinBoard();
      if (id) {
        setPlayerId(id);
        trackLeaderboardJoined(false);
        // Joining brings your history with you: every puzzle this browser can
        // show was played on its own day goes up in one request, so a player who
        // has been at this for weeks doesn't start from zero.
        setImported(backfillHistory(id));
      }
    }
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
    let timer = window.setInterval(refreshWords, REFRESH_MS);
    function onVisibilityChange() {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      refreshWords();
      timer = window.setInterval(refreshWords, REFRESH_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshWords]);

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

  const ready = boards?.ready ?? false;

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
        {/* A spacer, so the title stays centred against the back button. */}
        <div className="leaderboard-page__header-spacer" aria-hidden="true" />
      </header>

      <main>
        {state === "loading" && (
          <p className="leaderboard__status" aria-live="polite">
            Loading the boards…
          </p>
        )}

        {state === "error" && (
          <p className="leaderboard__status" aria-live="polite">
            Couldn't load the boards.{" "}
            <button type="button" className="leaderboard__retry" onClick={() => load()}>
              Try again
            </button>
          </p>
        )}

        {state === "ready" && !ready && boards && <NotYet opensOn={boards.opensOn} />}

        {state === "ready" && ready && boards && (
          <div className="leaderboard__boards">
            <Board
              heading="This week"
              // No dates on this one. A week is the window you are already in --
              // "this week" is the whole of what a player needs to know about
              // which days it counts, and spelling them out was answering a
              // question nobody had. The season gets dates because it is long
              // enough to be worth knowing where you are inside it.
              caption="Resets on Sundays."
              entries={boards.weekly}
              self={boards.weeklySelf}
              emptyMessage="Nobody's scored yet this week. Be first."
              playerId={playerId}
            />
            <Board
              heading={seasonName()}
              // Beside the name rather than under it: the range is what
              // "Season 1" means, and a season with no dates on it is a word
              // rather than a window.
              headingDetail={seasonRange()}
              caption="Must be completed the day of the puzzle."
              entries={boards.allTime}
              self={boards.allTimeSelf}
              emptyMessage="No scores yet."
              playerId={playerId}
            />
          </div>
        )}

        {/* Not gated on the boards' state. The feed is its own request, answering
            its own question, and it is the part of this page that works from day
            one -- so boards that failed to load are a reason to show a retry
            above it, never a reason to hide finds that arrived perfectly well. */}
        {words.length > 0 && (
          <FoundWords words={words} today={today} arrived={arrived} />
        )}

        {/* Nothing standing to say: their own row is marked on the boards, which
            is where they would look for themselves anyway. The one message worth
            showing is where the history on a brand new row came from, and it
            goes away with the next load.

            Only when there was history. A player who joins with nothing used to
            be told "nothing to count yet", which announced an absence they had
            not asked about -- the reply to a question nobody put. Their empty
            row is on the boards either way, and the first puzzle they score
            fills it without anything here having promised so. */}
        {playerId && imported !== null && imported > 0 && (
          <p className="leaderboard__note leaderboard__note--playing" aria-live="polite">
            {/* Not "past" puzzles: today counts too when it has been played, and
                it usually has by the time anyone opens this page. */}
            {`Counted ${imported} ${imported === 1 ? "puzzle" : "puzzles"} you'd already played.`}
          </p>
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
      <h2 className="leaderboard__board-heading">
        Today's finds
        <span className="found-words__drop">{dropForDate(today)}</span>
      </h2>
      <p className="leaderboard__caption">Every word found on today's puzzle.</p>
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

/**
 * What the page says before the boards open.
 *
 * A date, not a target. The earlier version counted players toward a threshold,
 * which was honest but open-ended -- "six of ten" is a good reason to come back
 * only if you believe the other four are coming. A day of the week is something
 * a player can plan around, and it arrives whether or not the game is busy.
 *
 * The finds feed is above this and keeps working throughout, so the page is
 * never empty while the boards wait.
 */
function NotYet({ opensOn }: { opensOn: string }) {
  const opens = new Date(`${opensOn}T00:00:00`);
  const weekday = opens.toLocaleDateString(undefined, { weekday: "long" });
  return (
    <section className="leaderboard__not-yet" aria-label="Leaderboard status">
      <p className="leaderboard__not-yet-count">
        Boards open <strong>{weekday}</strong>
      </p>
      <p className="leaderboard__not-yet-copy">
        The weekly and season boards go live on {formatDateLabel(opensOn)}. Scores are
        already being counted, including yours, so nothing you play between now and then is
        lost.
      </p>
    </section>
  );
}

interface BoardProps {
  heading: string;
  /** A note beside the heading, set smaller -- the season's dates. */
  headingDetail?: string;
  caption: string;
  entries: BoardEntry[];
  /** This player's own row, when they rank below the last one shown. */
  self: BoardEntry | null;
  emptyMessage: string;
  playerId: string | null;
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
  caption,
  entries,
  self,
  emptyMessage,
  playerId,
}: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">
        {heading}
        {headingDetail && <span className="leaderboard__board-dates">{headingDetail}</span>}
      </h2>
      <p className="leaderboard__caption">{caption}</p>
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
          <ol className="leaderboard__list">
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
    </section>
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
