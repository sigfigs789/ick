import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchFoundWords,
  fetchWordFinders,
  repriceFoundWords,
  type FoundWord,
} from "../game/leaderboard";
import { pageCache } from "../game/pageCache";
import { addDays, formatDateLabel } from "../game/date";
import { dropForDate } from "../game/drop";
import { formatRarityScore } from "../game/dictionary";
import { handleFor } from "../game/handle";
import { loadPlayerId, selfName } from "../game/player";
import { bestFind, finderTotal, orderedFinders, otherPlayers } from "../game/yesterdaysBest";
import { useGameMode } from "../hooks/useGameMode";
import { rarityClassName } from "./rarityStyles";

interface Props {
  /** The puzzle being played; the line reports the day before it. */
  date: string;
  /**
   * Whether that puzzle is today's, so the day before is "Yesterday". On an
   * archived puzzle the day before is named by its date instead.
   */
  isToday: boolean;
}

/**
 * Yesterday's finds, read once a visit: the line comes back with the puzzle
 * after a trip to another page without asking again. Shares the found-words
 * feed's request, so the CDN answers it from the copy it already holds.
 */
const yesterdayCache = pageCache<readonly FoundWord[]>();

/** The best word's finders, keyed by day and word, kept the same way. */
const findersCache = pageCache<readonly string[]>();

/**
 * The rarest word anybody found on the previous day's drop, under the puzzle
 * being played -- today's or an archived one.
 *
 * The previous day's drop is not this one, so naming its best word spoils nothing here
 * -- it shows the ceiling players actually reached, which is the thing to beat.
 * Priced by the reader's own mode like the finds page, so the score here and
 * the badge on /found-words agree.
 *
 * Names the finders once they arrive -- the reader first, when they were one:
 * one or two by name, and for three or more the first and "N other players",
 * which opens the rest as a list. Falls back to a bare count if they can't be
 * read.
 *
 * Says nothing at all while loading, on a failed read, or for a day nobody
 * found anything: it is a footnote to the puzzle, and a spinner or an error
 * under the guesses would be louder than the line itself. Held back until the
 * finders have answered too, so it fades in once, whole, rather than gaining
 * its "Found by" a beat later and reflowing.
 */
export function YesterdaysBest({ date, isToday }: Props) {
  const yesterday = addDays(date, -1);
  const [words, setWords] = useState<readonly FoundWord[] | undefined>(() =>
    yesterdayCache.get(yesterday),
  );
  const [mode] = useGameMode();

  useEffect(() => {
    let current = true;
    setWords(yesterdayCache.get(yesterday));
    fetchFoundWords(yesterday)
      .then((found) => {
        yesterdayCache.set(yesterday, found);
        if (current) setWords(found);
      })
      .catch(() => {
        // Nothing to say; the cached copy, if any, stays on screen.
      });
    return () => {
      current = false;
    };
  }, [yesterday]);

  const best = useMemo(
    () => (words ? bestFind(repriceFoundWords(words)) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the trigger
    [words, mode],
  );
  const findersKey = best ? `${yesterday}:${best.word}` : undefined;
  // The finders for the word they were read for: ids null when they couldn't
  // be read. Tagged with their key, so a new word's line never borrows the last
  // word's names while its own are on their way.
  const [finders, setFinders] = useState<
    { key: string; ids: readonly string[] | null } | undefined
  >(() => {
    const ids = findersKey ? findersCache.get(findersKey) : undefined;
    return findersKey && ids ? { key: findersKey, ids } : undefined;
  });

  useEffect(() => {
    if (!best || !findersKey) return;
    let current = true;
    const cached = findersCache.get(findersKey);
    if (cached) setFinders({ key: findersKey, ids: cached });
    fetchWordFinders(best.word, yesterday)
      .then((ids) => {
        findersCache.set(findersKey, ids);
        if (current) setFinders({ key: findersKey, ids });
      })
      .catch(() => {
        if (current)
          setFinders((prev) => (prev?.key === findersKey ? prev : { key: findersKey, ids: null }));
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the word
  }, [findersKey]);

  // Which word's list of other finders is open, so another day's starts shut.
  const [openFor, setOpenFor] = useState<string | undefined>();

  if (!best || !finders || finders.key !== findersKey) return null;

  const selfId = loadPlayerId()?.toLowerCase() ?? null;
  const ids = finders.ids ? orderedFinders(finders.ids, selfId) : [];
  const total = finders.ids ? finderTotal(finders.ids, best.finders) : best.finders;
  const nameOf = (id: string) => (id === selfId ? selfName(id) : handleFor(id));
  const open = openFor === findersKey;
  // Ids past the server's cap, or not yet read when the count was taken.
  const unlisted = total - ids.length;

  let foundBy: ReactNode;
  if (ids.length === 0) {
    foundBy = `Found by ${total} ${total === 1 ? "player" : "players"}`;
  } else if (total === 1) {
    foundBy = `Found by ${nameOf(ids[0])}`;
  } else if (total === 2 && ids.length === 2) {
    foundBy = `Found by ${nameOf(ids[0])} and ${nameOf(ids[1])}`;
  } else if (total === 2) {
    foundBy = `Found by ${nameOf(ids[0])} and ${otherPlayers(1)}`;
  } else {
    foundBy = (
      <>
        Found by {nameOf(ids[0])} and{" "}
        <button
          type="button"
          className="yesterdays-best__others"
          aria-expanded={open}
          onClick={() => setOpenFor(open ? undefined : findersKey)}
        >
          {otherPlayers(total - 1)}
        </button>
      </>
    );
  }

  const scoreDate = best.foundOn || yesterday;
  return (
    // Keyed by day, so stepping to another puzzle fades the new line in afresh.
    <div className="yesterdays-best" key={yesterday}>
      <span className="yesterdays-best__label">
        {isToday ? "Yesterday" : formatDateLabel(yesterday)}'s best for {"“"}
        {dropForDate(yesterday)}
        {"”"}
      </span>{" "}
      <span className="yesterdays-best__word">{best.word}</span>{" "}
      {/* The score beside its tier's dot, without the badge; the tier is
          named for a screen reader. */}
      <span className={`yesterdays-best__score ${rarityClassName(best.rarity, scoreDate)}`}>
        <span className="rarity-badge__dot" aria-hidden="true" />
        {formatRarityScore(best.zipf, scoreDate)}
        <span className="sr-only"> {best.rarity}</span>
      </span>
      <span className="yesterdays-best__finders">{foundBy}</span>
      {open && (
        <ul className="yesterdays-best__list">
          {ids.slice(1).map((id) => (
            <li key={id}>{nameOf(id)}</li>
          ))}
          {unlisted > 0 && <li>and {unlisted} more</li>}
        </ul>
      )}
    </div>
  );
}
