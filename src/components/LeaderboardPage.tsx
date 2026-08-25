import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatScore } from "../game/dictionary";
import {
  backfillHistory,
  fetchBoards,
  type BoardEntry,
  type Boards,
} from "../game/leaderboard";
import { loadPlayer, MAX_NAME_LENGTH, savePlayerName, type Player } from "../game/player";
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
  const [player, setPlayer] = useState<Player | null>(() => loadPlayer());
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState(false);
  /** Days imported from this browser's history on joining, for one message. */
  const [imported, setImported] = useState<number | null>(null);

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

  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = savePlayerName(nameDraft);
    if (!saved) {
      setNameError(true);
      return;
    }
    const isRename = player !== null;
    setPlayer(saved);
    setNameDraft("");
    setEditingName(false);
    setNameError(false);
    trackLeaderboardJoined(isRename);
    // Joining brings your history with you: every puzzle this browser remembers
    // finishing on its own day goes up in one request, so a player who has been
    // at this for weeks doesn't start from zero. A rename is not a join, and has
    // nothing to import -- the history is already under the same player id.
    if (!isRename) setImported(backfillHistory(saved));
    load();
  }

  const showJoinForm = !player || editingName;
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
              caption={`From Monday on. ${resetLabel()}.`}
              entries={boards.weekly}
              emptyMessage="Nobody's scored yet this week. Be first."
              player={player}
            />
            <Board
              heading="All time"
              caption="Every puzzle you've scored on, added up."
              entries={boards.allTime}
              emptyMessage="No scores yet."
              player={player}
            />
          </div>
        )}

        {showJoinForm ? (
          <form className="leaderboard__join" onSubmit={submitName}>
            <label htmlFor="leaderboard-name">
              {player ? "Change your name" : "Put your name on the board"}
            </label>
            <div className="leaderboard__join-row">
              <input
                id="leaderboard-name"
                type="text"
                value={nameDraft}
                maxLength={MAX_NAME_LENGTH}
                placeholder={player?.name ?? "Your name"}
                autoComplete="off"
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setNameError(false);
                }}
              />
              <button type="submit" className="leaderboard__join-button">
                {player ? "Save" : "Join"}
              </button>
            </div>
            {nameError ? (
              <p className="leaderboard__note leaderboard__note--error" aria-live="polite">
                That name's too short — two characters or more.
              </p>
            ) : (
              <p className="leaderboard__note">
                No account, no email. The name lives in this browser, and joining brings
                every puzzle you finished on its own day with it.
              </p>
            )}
          </form>
        ) : (
          <p className="leaderboard__note leaderboard__note--playing">
            Playing as <strong>{player.name}</strong>.{" "}
            <button
              type="button"
              className="leaderboard__retry"
              onClick={() => {
                setNameDraft(player.name);
                setEditingName(true);
              }}
            >
              Change name
            </button>
            {imported !== null && (
              <>
                {" "}
                <span className="leaderboard__imported" aria-live="polite">
                  {imported > 0
                    ? `Brought ${imported} past ${imported === 1 ? "puzzle" : "puzzles"} with you.`
                    : "No past puzzles to bring — today's is your first on the board."}
                </span>
              </>
            )}
          </p>
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
  player: Player | null;
}

/** One board, ranked by total score exactly as the database ordered it. */
function Board({ heading, caption, entries, emptyMessage, player }: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">{heading}</h2>
      <p className="leaderboard__caption">{caption}</p>
      {entries.length === 0 ? (
        <p className="leaderboard__status">{emptyMessage}</p>
      ) : (
        <ol className="leaderboard__list">
          {entries.map((entry) => {
            const isYou = player?.id === entry.playerId;
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
