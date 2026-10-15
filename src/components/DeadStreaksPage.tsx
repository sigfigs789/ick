import { useCallback, useEffect, useState } from "react";
import { fetchDeadStreaks, type DeadStreakEntry } from "../game/leaderboard";
import { formatDateLabel } from "../game/date";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";

/**
 * The dead-streaks board, at /dead-streaks: players with two or more days
 * played whose streak ended and who never came back, longest streak first.
 *
 * Built from the streak board's own row and list styles, so the two read alike.
 */
export function DeadStreaksPage() {
  const [entries, setEntries] = useState<DeadStreakEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback((fresh = false) => {
    setState("loading");
    fetchDeadStreaks(undefined, { fresh })
      .then((loaded) => {
        setEntries(loaded);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Dead streaks</h1>
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
        <section className="leaderboard__board" aria-label="Dead streaks">
          <h2 className="leaderboard__board-heading">
            Lost and never back
            <span className="leaderboard__board-dates">Longest streak first</span>
          </h2>
          {entries.length === 0 ? (
            <p className="leaderboard__status">No dead streaks yet.</p>
          ) : (
            <>
              <p className="leaderboard__columns">
                <span>Longest streak</span>
                <span>Lost streak</span>
              </p>
              <ol
                className="leaderboard__list"
                tabIndex={0}
                aria-label={`Dead streaks, top ${entries.length}`}
              >
                {entries.map((entry) => (
                  <DeadStreakRow key={entry.playerId} entry={entry} />
                ))}
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

/** One player: their longest streak, the one they lost, and when they left. */
function DeadStreakRow({ entry }: { entry: DeadStreakEntry }) {
  return (
    <li className="leaderboard__row">
      <span className="leaderboard__rank">{entry.rank}</span>
      <span className="leaderboard__name">{entry.name}</span>
      <span className="leaderboard__score">
        {entry.best > 1 && <span aria-hidden="true">🪦 </span>}
        {entry.best}
        <span className="sr-only"> {entry.best === 1 ? "day" : "days"} longest streak</span>
      </span>
      <span className="leaderboard__detail">
        <span className="leaderboard__meta">
          {entry.days} {entry.days === 1 ? "day" : "days"} played · last{" "}
          {formatDateLabel(entry.lastPlayed)}
        </span>
        <span className="leaderboard__best">Lost {entry.lost}</span>
      </span>
    </li>
  );
}
