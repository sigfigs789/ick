import { useState, type ReactNode } from "react";
import { addDays, formatDateLabel } from "../game/date";
import { dropForDate } from "../game/drop";
import { formatRarityScore } from "../game/dictionary";
import { handleFor } from "../game/handle";
import { loadPlayerId, selfName } from "../game/player";
import { finderTotal, orderedFinders, otherPlayers } from "../game/yesterdaysBest";
import { useYesterdaysBest } from "../hooks/useYesterdaysBest";
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
 * The rarest word anybody found on the previous day's drop, under the puzzle
 * being played -- today's or an archived one.
 *
 * The previous day's drop is not this one, so naming its best word spoils nothing here
 * -- it shows the ceiling players actually reached, which is the thing to beat.
 * Which word that is, ties and all, is worked out by `useYesterdaysBest`.
 *
 * Names the finders -- the reader first, when they were one: one or two by
 * name, and for three or more the first and "N other players", which opens the
 * rest as a list. Falls back to a bare count if they can't be read.
 *
 * Says nothing at all while loading, on a failed read, or for a day nobody
 * found anything: it is a footnote to the puzzle, and a spinner or an error
 * under the guesses would be louder than the line itself. Held back until the
 * finders have answered too, so it fades in once, whole, rather than gaining
 * its "Found by" a beat later and reflowing.
 */
export function YesterdaysBest({ date, isToday }: Props) {
  const yesterday = addDays(date, -1);
  const resolved = useYesterdaysBest(yesterday);

  // Which word's list of other finders is open, so another day's starts shut.
  const [openFor, setOpenFor] = useState<string | undefined>();

  if (!resolved) return null;

  const { best, finderIds } = resolved;
  const findersKey = `${yesterday}:${best.word}`;
  const selfId = loadPlayerId()?.toLowerCase() ?? null;
  const ids = finderIds ? orderedFinders(finderIds, selfId) : [];
  const total = finderIds ? finderTotal(finderIds, best.finders) : best.finders;
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
