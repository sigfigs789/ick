import { useCallback, useEffect, useState } from "react";
import { formatScore } from "../game/dictionary";
import {
  backfillHistory,
  boardName,
  fetchBoards,
  type BoardEntry,
  type Boards,
} from "../game/leaderboard";
import { joinBoard, loadPlayerId } from "../game/player";
import { resetLabel } from "../game/week";
import { navigate } from "../routes";
import { trackLeaderboardJoined } from "../analytics";

type LoadState = "loading" | "ready" | "error";

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
  // The name this browser would appear under: the best word it can prove was
  // played on its own day. Null until the player has one.
  const name = boardName();

  const load = useCallback(() => {
    setState("loading");
    fetchBoards()
      .then((loaded) => {
        setBoards(loaded);
        setState("ready");
      })
      // A board that won't load is a disappointment, not an error the player has
      // to act on -- so it says so plainly and offers a retry, and that is all.
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
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
            <button type="button" className="leaderboard__retry" onClick={load}>
              Try again
            </button>
          </p>
        )}

        {state === "ready" && !ready && <NotYet boards={boards} />}

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

        {playerId ? (
          <p className="leaderboard__note leaderboard__note--playing">
            {name ? (
              <>
                You're on the board as <strong>{name}</strong> — your rarest word so far.
                Beat it and this changes.
              </>
            ) : (
              <>You're on the board. Your rarest word will name you once you've played one.</>
            )}
            {imported !== null && (
              <>
                {" "}
                <span className="leaderboard__imported" aria-live="polite">
                  {/* Not "past" puzzles: today counts too when it has been
                      played, and it usually has by the time anyone joins. */}
                  {imported > 0
                    ? `Counted ${imported} ${imported === 1 ? "puzzle" : "puzzles"} you'd already played.`
                    : "Nothing to count yet — your first scored puzzle starts you off."}
                </span>
              </>
            )}
          </p>
        ) : (
          <div className="leaderboard__join">
            {name ? (
              <>
                <p className="leaderboard__join-pitch">
                  Join as <strong>{name}</strong>
                </p>
                <button type="button" className="leaderboard__join-button" onClick={join}>
                  Put me on the board
                </button>
                <p className="leaderboard__note">
                  No account, no email, no name to pick — the board calls you by your
                  rarest word, and renames you when you beat it. Joining brings every
                  puzzle you played on its own day with it.
                </p>
              </>
            ) : (
              <p className="leaderboard__note">
                Play a word and you can join the board. It calls players by their rarest
                find rather than a name they picked, so you need one first.
              </p>
            )}
          </div>
        )}

        <button type="button" className="leaderboard-page__back" onClick={() => navigate("game")}>
          Back to today's puzzle
        </button>
      </main>
    </div>
  );
}

/**
 * What the page says before the boards open.
 *
 * A leaderboard with three names on it is not a leaderboard -- it is a list of
 * whoever found the page first, and it teaches a new player that nobody plays
 * this. So scores are collected from the start and shown from the threshold, and
 * until then the count is what there is to say. It is also the more honest
 * thing: "six of ten players so far" is a reason to come back and a reason to
 * tell someone, which an empty table is not.
 */
function NotYet({ boards }: { boards: Boards | null }) {
  const players = boards?.players ?? 0;
  const needed = boards?.minPlayers ?? 0;
  const remaining = Math.max(needed - players, 0);
  return (
    <section className="leaderboard__not-yet" aria-label="Leaderboard status">
      <p className="leaderboard__not-yet-count">
        <strong>{players}</strong> of {needed} players
      </p>
      <p className="leaderboard__not-yet-copy">
        The boards open once {needed} people have scored. {remaining}{" "}
        {remaining === 1 ? "more to go" : "to go"} — scores are already being counted, including
        yours, so nothing you play between now and then is lost.
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
          {entries.map((entry) => {
            const isYou = playerId !== null && playerId === entry.playerId;
            return (
              <li
                key={entry.playerId}
                className={`leaderboard__row${isYou ? " leaderboard__row--you" : ""}`}
              >
                <span className="leaderboard__rank">{entry.rank}</span>
                <span className="leaderboard__name">
                  {entry.name}
                  {isYou && <span className="leaderboard__you"> you</span>}
                </span>
                <span className="leaderboard__meta">
                  {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"} · best{" "}
                  {formatScore(entry.best)}
                </span>
                <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
