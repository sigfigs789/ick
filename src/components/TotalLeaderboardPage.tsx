import { useCallback, useEffect, useState } from "react";
import { fetchTotalBoard, type TotalBoard, type TotalEntry } from "../game/leaderboard";
import { formatDateLabel } from "../game/date";
import { loadPlayerId } from "../game/player";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";

/**
 * The puzzles-played board, at /leaderboard-total: every player, most puzzles
 * played first, either mode.
 *
 * Built from the other boards' row and list styles, so they read alike.
 */
export function TotalLeaderboardPage() {
  const [board, setBoard] = useState<TotalBoard>({ entries: [], self: null });
  const [state, setState] = useState<LoadState>("loading");
  const [playerId] = useState(() => loadPlayerId());

  const load = useCallback(
    (fresh = false) => {
      setState("loading");
      fetchTotalBoard(playerId, { fresh })
        .then((loaded) => {
          setBoard(loaded);
          setState("ready");
        })
        .catch(() => setState("error"));
    },
    [playerId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const { entries, self } = board;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Puzzles played</h1>
        </div>
      </div>

      {state === "loading" && (
        <p className="leaderboard__status" aria-live="polite">
          Loading the board…
        </p>
      )}

      {state === "error" && (
        <p className="leaderboard__status" aria-live="polite">
          Couldn’t load the board.{" "}
          <button type="button" className="leaderboard__retry" onClick={() => load(true)}>
            Try again
          </button>
        </p>
      )}

      {state === "ready" && (
        <section className="leaderboard__board" aria-label="Puzzles played">
          <h2 className="leaderboard__board-heading">
            All time
            <span className="leaderboard__board-dates">Most puzzles first</span>
          </h2>
          {entries.length === 0 ? (
            <p className="leaderboard__status">Nobody has played yet.</p>
          ) : (
            <>
              <p className="leaderboard__columns">
                <span>Puzzles</span>
                <span>Since</span>
              </p>
              <ol
                className="leaderboard__list"
                tabIndex={0}
                aria-label={`Puzzles played, top ${entries.length}`}
              >
                {entries.map((entry) => (
                  <TotalRow key={entry.playerId} entry={entry} isYou={entry.playerId === playerId} />
                ))}
                {self && (
                  <>
                    <li className="leaderboard__gap" aria-hidden="true">
                      ⋯
                    </li>
                    <TotalRow entry={self} isYou />
                  </>
                )}
              </ol>
            </>
          )}
        </section>
      )}

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today’s puzzle
      </button>
    </main>
  );
}

/** One player: how many puzzles they have played, and since when. */
function TotalRow({ entry, isYou }: { entry: TotalEntry; isYou: boolean }) {
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
      <span className="leaderboard__score">
        {entry.puzzles}
        <span className="sr-only"> {entry.puzzles === 1 ? "puzzle" : "puzzles"} played</span>
      </span>
      <span className="leaderboard__detail">
        <span className="leaderboard__meta" />
        {entry.firstPlayed && (
          <span className="leaderboard__best">Since {formatDateLabel(entry.firstPlayed)}</span>
        )}
      </span>
    </li>
  );
}
