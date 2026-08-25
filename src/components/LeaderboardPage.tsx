import { useCallback, useEffect, useRef, useState } from "react";
import { formatScore } from "../game/dictionary";
import { RarityBadge } from "./RarityBadge";
import {
  backfillHistory,
  fetchBoards,
  type BoardEntry,
  type Boards,
  type FoundWord,
} from "../game/leaderboard";
import { joinBoard, loadPlayerId } from "../game/player";
import { formatDateLabel, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { resetLabel } from "../game/week";
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
  const [state, setState] = useState<LoadState>("loading");
  const [playerId, setPlayerId] = useState<string | null>(() => loadPlayerId());
  /** Days imported from this browser's history on joining, for one message. */
  const [imported, setImported] = useState<number | null>(null);

  /**
   * Fetch the boards and the finds.
   *
   * `quiet` is for the refreshes: a poll that flipped the page back to "Loading
   * the boards…" every minute would be worse than not polling at all, so a
   * refresh leaves whatever is on screen alone until new data replaces it, and a
   * refresh that fails leaves the last good data up rather than throwing the
   * page away over one bad minute.
   */
  const load = useCallback((quiet = false) => {
    if (!quiet) setState("loading");
    fetchBoards()
      .then((loaded) => {
        setBoards(loaded);
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      .catch(() => {
        if (!quiet) setState("error");
      });
  }, []);

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
   */
  useEffect(() => {
    let timer = window.setInterval(() => load(true), REFRESH_MS);
    function onVisibilityChange() {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      load(true);
      timer = window.setInterval(() => load(true), REFRESH_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  function join() {
    const id = joinBoard();
    if (!id) return;
    setPlayerId(id);
    trackLeaderboardJoined(false);
    // Joining brings your history with you: every puzzle this browser can show
    // was played on its own day goes up in one request, so a player who has been
    // at this for weeks doesn't start from zero.
    setImported(backfillHistory(id));
    load();
  }

  /**
   * Which words turned up since the last look, so the feed can show them
   * arriving rather than just quietly containing them.
   *
   * The first load marks nothing: everything is new to a page that has just
   * opened, and animating the whole list would say "twelve words just arrived"
   * when none of them did. After that, each refresh diffs against what was
   * already on screen and only the genuinely new ones move.
   *
   */
  const seenWords = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!boards) return;
    const words = boards.words.map((found) => found.word);
    if (seenWords.current === null) {
      seenWords.current = new Set(words);
      return;
    }
    const fresh = words.filter((word) => !seenWords.current?.has(word));
    for (const word of words) seenWords.current.add(word);
    if (fresh.length === 0) return;
    setArrived(fresh);
    // Cleared once the animation is done, so a later re-render for some
    // unrelated reason does not replay it.
    const timer = window.setTimeout(() => setArrived([]), 1400);
    return () => window.clearTimeout(timer);
  }, [boards]);

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
        <div className="app__header-titles">
          <h1>Leaderboard</h1>
          <p className="app__puzzle-number">Ranked by total score</p>
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
              caption={`From Sunday on. ${resetLabel()}.`}
              entries={boards.weekly}
              emptyMessage="Nobody's scored yet this week. Be first."
              playerId={playerId}
            />
            <Board
              heading="All time"
              caption="Every puzzle you've scored on, added up."
              entries={boards.allTime}
              emptyMessage="No scores yet."
              playerId={playerId}
            />
          </div>
        )}

        {state === "ready" && boards && boards.words.length > 0 && (
          <FoundWords words={boards.words} today={todayDateString()} arrived={arrived} />
        )}

        {playerId ? (
          // Nothing standing to say once a player has joined: their own row is
          // marked on the boards, which is where they would look for themselves
          // anyway. The one message worth showing is the confirmation right
          // after joining, and it goes away with the next load.
          imported !== null && (
            <p className="leaderboard__note leaderboard__note--playing" aria-live="polite">
              {/* Not "past" puzzles: today counts too when it has been played,
                  and it usually has by the time anyone joins. */}
              {imported > 0
                ? `Counted ${imported} ${imported === 1 ? "puzzle" : "puzzles"} you'd already played.`
                : "Nothing to count yet — your first scored puzzle starts you off."}
            </p>
          )
        ) : (
          <div className="leaderboard__join">
            <button type="button" className="leaderboard__join-button" onClick={join}>
              Put me on the board
            </button>
            <p className="leaderboard__note">
              No account, no email, no name to invent — you get one when you join. Joining
              brings every puzzle you played on its own day with it.
            </p>
          </div>
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
 * What people have found on today's puzzle, newest first.
 *
 * Today only. A week of history behind it read as an archive, and the drop in
 * the heading is what makes the list mean anything: `asphyxiate` is just a word
 * until you know the day asked for PHY.
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
  words: FoundWord[];
  today: string;
  arrived: readonly string[];
}) {
  return (
    <section className="found-words" aria-label="Today's finds">
      <h2 className="leaderboard__board-heading">
        Today's finds
        <span className="found-words__drop">{dropForDate(today)}</span>
      </h2>
      <p className="leaderboard__caption">The best word each player has found today.</p>
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
        The weekly and all-time boards go live on {formatDateLabel(opensOn)}. Scores are
        already being counted, including yours, so nothing you play between now and then is
        lost.
      </p>
    </section>
  );
}

interface BoardProps {
  heading: string;
  caption: string;
  entries: BoardEntry[];
  emptyMessage: string;
  playerId: string | null;
}

/** One board, ranked by total score exactly as the database ordered it. */
function Board({ heading, caption, entries, emptyMessage, playerId }: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">{heading}</h2>
      <p className="leaderboard__caption">{caption}</p>
      {entries.length === 0 ? (
        <p className="leaderboard__status">{emptyMessage}</p>
      ) : (
        <ol className="leaderboard__list">
          {entries.map((entry) => (
            <Row key={entry.playerId} entry={entry} isYou={playerId === entry.playerId} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One player's row: who they are, then what they found.
 *
 * The name leads on both boards. The weekly one used to lead with that week's
 * find instead, because back then a "name" was itself a word and the row needed
 * something to say the week with. Now that a name is plainly a name, putting the
 * person first reads better and gives both boards the same shape -- and the find
 * still says which week it is, because it is the window's: this week's on the
 * weekly board, their best ever on the all-time one.
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
        {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"} ·{" "}
        <span className="leaderboard__find">{entry.windowWord}</span>{" "}
        {formatScore(entry.windowScore)}
      </span>
      <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
    </li>
  );
}
