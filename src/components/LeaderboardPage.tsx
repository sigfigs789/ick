import { useCallback, useEffect, useState } from "react";
import { formatScore } from "../game/dictionary";
import { RarityBadge } from "./RarityBadge";
import {
  backfillHistory,
  chooseName,
  fetchBoards,
  nameCandidates,
  type BoardEntry,
  type Boards,
  type FoundWord,
  type NameCandidate,
} from "../game/leaderboard";
import { joinBoard, loadPlayerId } from "../game/player";
import { formatDateLabel } from "../game/date";
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
  // The words this browser could be known by, best first. The first is also the
  // default: left alone, the board calls a player by their rarest.
  const candidates = nameCandidates();
  const [chosen, setChosen] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chooseFailed, setChooseFailed] = useState(false);
  const name = chosen ?? candidates[0]?.word ?? null;

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
              // The weekly row leads with this week's find and carries the
              // player's standing name underneath, so it describes the week
              // without costing them the identity a rival recognises them by.
              weekly
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
          <FoundWords words={boards.words} />
        )}

        {playerId ? (
          <div className="leaderboard__you-are">
            <p className="leaderboard__note leaderboard__note--playing">
              {name ? (
                <>
                  You're on the board as <strong>{name}</strong>.
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
            {candidates.length > 1 && (
              <NamePicker
                candidates={candidates}
                current={name}
                busy={choosing}
                failed={chooseFailed}
                onChoose={async (word) => {
                  setChoosing(true);
                  setChooseFailed(false);
                  const ok = await chooseName(playerId, word);
                  setChoosing(false);
                  if (!ok) {
                    setChooseFailed(true);
                    return;
                  }
                  setChosen(word);
                  load();
                }}
              />
            )}
          </div>
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
                  No account, no email, no name to invent — the board calls you by one of
                  your own finds, and you can pick which once you're on. Joining brings
                  every puzzle you played on its own day with it.
                </p>
              </>
            ) : (
              <p className="leaderboard__note">Play a word and you can join the board.</p>
            )}
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
 * The best words other players found recently, rarest first.
 *
 * Its own section below the boards, rather than sharing the top of the page with
 * them. Both are lists of words, and a leaderboard row is a *player* while a
 * find is a *word* -- side by side that distinction is one nobody should have to
 * work out, so the two get separate headings and separate ground.
 *
 * A leaderboard tells you where you came; this tells you what you missed, and
 * "I did not know that was a word" is the thing players actually enjoy. Every
 * entry is somebody's best find of a day.
 *
 * Never today's, and that is not a detail -- the same drop goes to everyone, so a
 * word found today is an answer to today's puzzle. The server draws that line
 * (see api/leaderboard.ts); this component only has to say which days it is
 * showing, so nobody reads it as a live feed and wonders why their own word is
 * missing.
 */
function FoundWords({ words }: { words: FoundWord[] }) {
  return (
    <section className="found-words" aria-label="Words found recently">
      <h2 className="leaderboard__board-heading">Recent finds</h2>
      <p className="leaderboard__caption">
        The best word each player found, from the past week's puzzles. Today's appear as
        they happen, if they're Rare or better.
      </p>
      <ul className="found-words__list">
        {words.map((found) => (
          <li key={found.word} className="found-words__item">
            <span className="found-words__word">{found.word}</span>
            {found.today && <span className="found-words__today">today</span>}
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

interface NamePickerProps {
  candidates: NameCandidate[];
  current: string | null;
  busy: boolean;
  failed: boolean;
  onChoose: (word: string) => void;
}

/**
 * Pick which of your own finds names you.
 *
 * A closed list rather than a text field, and the constraint is the feature: a
 * name you cannot type is a name you had to earn, so there is nothing to police
 * and nothing to impersonate. Ten is enough for the choice to be real.
 *
 * Worth having at all because the default moves: left alone the board calls a
 * player by their rarest word, which changes every time they beat it -- and a
 * name that changes is a player their rivals stop recognising. Choosing is how
 * you stop it.
 */
function NamePicker({ candidates, current, busy, failed, onChoose }: NamePickerProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="leaderboard__retry" onClick={() => setOpen(true)}>
        Choose a different word
      </button>
    );
  }

  return (
    <div className="leaderboard__picker">
      <p className="leaderboard__picker-heading" id="name-picker-heading">
        Your best finds — pick the one you want to be known by
      </p>
      <ul className="leaderboard__picker-list" aria-labelledby="name-picker-heading">
        {candidates.map((candidate) => {
          const isCurrent = candidate.word === current;
          return (
            <li key={candidate.word}>
              <button
                type="button"
                className={`leaderboard__picker-option${
                  isCurrent ? " leaderboard__picker-option--current" : ""
                }`}
                aria-pressed={isCurrent}
                disabled={busy || isCurrent}
                onClick={() => onChoose(candidate.word)}
              >
                <span className="leaderboard__picker-word">{candidate.word}</span>
                <span className="leaderboard__picker-score">{formatScore(candidate.score)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p className="leaderboard__note leaderboard__note--error" aria-live="polite">
          Couldn't change your name just now. Try again in a moment.
        </p>
      )}
      <button type="button" className="leaderboard__retry" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}

interface BoardProps {
  heading: string;
  caption: string;
  entries: BoardEntry[];
  emptyMessage: string;
  playerId: string | null;
  /**
   * Lead each row with the window's rarest word rather than the player's name --
   * on for the weekly board, where that is this week's find. Off for all-time,
   * whose window is everything, so the two would be the same word.
   */
  weekly?: boolean;
}

/** One board, ranked by total score exactly as the database ordered it. */
function Board({
  heading,
  caption,
  entries,
  emptyMessage,
  playerId,
  weekly = false,
}: BoardProps) {
  return (
    <section className="leaderboard__board" aria-label={heading}>
      <h2 className="leaderboard__board-heading">{heading}</h2>
      <p className="leaderboard__caption">{caption}</p>
      {entries.length === 0 ? (
        <p className="leaderboard__status">{emptyMessage}</p>
      ) : (
        <ol className="leaderboard__list">
          {entries.map((entry) => (
            <Row key={entry.playerId} entry={entry} isYou={playerId === entry.playerId} weekly={weekly} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One player's row.
 *
 * The weekly board leads with what they found *this* week and carries their
 * standing name underneath; the all-time board leads with the standing name and
 * carries what it is worth. Same two facts either way, with the board's own
 * subject in front.
 *
 * Both are always drawn. Revealing the standing name on hover would be tidier
 * and would not work: this game is played mostly on phones, where there is no
 * hover, so the identity a player needs in order to recognise a rival would be
 * missing exactly where most of them are. The `title` is a convenience for
 * pointer users, never the only way to see it.
 */
function Row({ entry, isYou, weekly }: { entry: BoardEntry; isYou: boolean; weekly: boolean }) {
  // A player whose best week is their best ever has one word, not two -- saying
  // "known as inkling" under the word `inkling` is noise.
  const sameWord = entry.windowWord === entry.name;
  const lead = weekly ? entry.windowWord : entry.name;
  const leadScore = weekly ? entry.windowScore : entry.nameScore;
  const detail =
    weekly && !sameWord ? `known as ${entry.name}` : `best ${formatScore(entry.nameScore)}`;

  return (
    <li className={`leaderboard__row${isYou ? " leaderboard__row--you" : ""}`}>
      <span className="leaderboard__rank">{entry.rank}</span>
      <span
        className="leaderboard__name"
        title={weekly && !sameWord ? `known as ${entry.name}` : undefined}
      >
        {lead}
        {weekly && <span className="leaderboard__lead-score"> {formatScore(leadScore)}</span>}
        {isYou && <span className="leaderboard__you"> you</span>}
      </span>
      <span className="leaderboard__meta">
        {entry.puzzles} {entry.puzzles === 1 ? "puzzle" : "puzzles"} · {detail}
      </span>
      <span className="leaderboard__score">{entry.score.toFixed(1)}</span>
    </li>
  );
}
