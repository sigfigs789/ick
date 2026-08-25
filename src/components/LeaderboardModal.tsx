import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatScore } from "../game/dictionary";
import { fetchBoards, type BoardEntry, type Boards } from "../game/leaderboard";
import { loadPlayer, MAX_NAME_LENGTH, savePlayerName, type Player } from "../game/player";
import { resetLabel } from "../game/week";
import { trackLeaderboardJoined } from "../analytics";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the player joins or renames, so the app can post their score. */
  onJoin?: (player: Player) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Both boards, always both on screen.
 *
 * Side by side where there is room, and stacked into one column where there
 * isn't -- one grid, one media query, no tabs. Showing both at once is the point
 * of having two: the interesting thing about a weekly board is how it differs
 * from the all-time one, and a player who has to click between them has to hold
 * the first in their head to see it. On a phone the same two boards become one
 * scrolling column, weekly first, since that is the one a new player can still
 * win.
 */
export function LeaderboardModal({ open, onClose, onJoin }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [boards, setBoards] = useState<Boards | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [player, setPlayer] = useState<Player | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState(false);

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

  // Read the stored player and fetch on open rather than on mount: a player who
  // never opens this never makes the request.
  useEffect(() => {
    if (!open) return;
    setPlayer(loadPlayer());
    setEditingName(false);
    setNameError(false);
    load();
    closeRef.current?.focus();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

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
    // The app posts the score straight away, so a player who joins mid-puzzle
    // appears on the board without waiting for their next word.
    onJoin?.(saved);
    load();
  }

  const showJoinForm = !player || editingName;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="leaderboard-heading">Leaderboard</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close leaderboard"
          >
            ×
          </button>
        </div>

        <div className="leaderboard__boards">
          <Board
            heading="This week"
            caption={`From Monday on. ${resetLabel()}.`}
            entries={boards?.weekly ?? []}
            state={state}
            emptyMessage="Nobody's on the board this week yet. Be first."
            player={player}
            onRetry={load}
          />
          <Board
            heading="All time"
            caption="Every puzzle you've scored on, added up."
            entries={boards?.allTime ?? []}
            state={state}
            emptyMessage="No scores yet."
            player={player}
            onRetry={load}
          />
        </div>

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
                No account, no email. The name lives in this browser, and only today's puzzles
                count.
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
          </p>
        )}
      </div>
    </div>
  );
}

interface BoardProps {
  heading: string;
  caption: string;
  entries: BoardEntry[];
  state: LoadState;
  emptyMessage: string;
  player: Player | null;
  onRetry: () => void;
}

/**
 * One board. Both are loaded by the same request, so both share a single
 * loading and error state rather than each reporting on the fetch separately --
 * which would say the same thing twice.
 */
function Board({ heading, caption, entries, state, emptyMessage, player, onRetry }: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h3 className="leaderboard__board-heading">{heading}</h3>
      <p className="leaderboard__caption">{caption}</p>
      {state === "loading" && (
        <p className="leaderboard__status" aria-live="polite">
          Loading…
        </p>
      )}
      {state === "error" && (
        <p className="leaderboard__status" aria-live="polite">
          Couldn't load.{" "}
          <button type="button" className="leaderboard__retry" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
      {state === "ready" && entries.length === 0 && (
        <p className="leaderboard__status">{emptyMessage}</p>
      )}
      {state === "ready" && entries.length > 0 && (
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
