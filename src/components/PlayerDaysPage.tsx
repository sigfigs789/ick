import { useCallback, useEffect, useState } from "react";
import { fetchTotalBoard, type TotalBoard, type TotalEntry } from "../game/leaderboard";
import { formatDateLabel } from "../game/date";
import { loadPlayerId } from "../game/player";
import { daysMilestone } from "../game/daysMilestones";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";

/**
 * The days-played board, at /player-days: every player, most days played
 * first, either mode, each wearing the highest milestone their tally has
 * reached (see game/daysMilestones.ts).
 *
 * Its own page, linked from /help, rather than a pill on the leaderboard: the
 * leaderboard is the daily round, and this is a standing tally beside it.
 * Built from the other boards' row and list styles, so they read alike.
 */
export function PlayerDaysPage() {
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
          <h1 className="page-head__title">Days played</h1>
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
        <section className="leaderboard__board" aria-label="Days played">
          <h2 className="leaderboard__board-heading">
            All time
            <span className="leaderboard__board-dates">Most days first</span>
          </h2>
          {entries.length === 0 ? (
            <p className="leaderboard__status">Nobody has played yet. Play today to be first.</p>
          ) : (
            <>
              <p className="leaderboard__columns">
                <span>Days played</span>
                <span>Since</span>
              </p>
              <ol
                className="leaderboard__list"
                tabIndex={0}
                aria-label={`Days played, top ${entries.length}`}
              >
                {entries.map((entry) => (
                  <DaysRow key={entry.playerId} entry={entry} isYou={entry.playerId === playerId} />
                ))}
                {self && (
                  <>
                    <li className="leaderboard__gap" aria-hidden="true">
                      ⋯
                    </li>
                    <DaysRow entry={self} isYou />
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

/**
 * One player: who, how many days they have played with the milestone that
 * tally has reached, and since when.
 */
function DaysRow({ entry, isYou }: { entry: TotalEntry; isYou: boolean }) {
  const isLeader = entry.rank === 1;
  const milestone = daysMilestone(entry.puzzles);
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
        {/* None under a week. */}
        {milestone && (
          <span aria-hidden="true" title={milestone.label}>
            {milestone.emoji}{" "}
          </span>
        )}
        {entry.puzzles}
        <span className="sr-only">
          {" "}
          {entry.puzzles === 1 ? "day" : "days"} played
          {milestone ? `, ${milestone.label.toLowerCase()} milestone` : ""}
        </span>
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
