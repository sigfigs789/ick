import { useEffect, useMemo, useState } from "react";
import { fetchFoundWords, repriceFoundWords, type FoundWord } from "../game/leaderboard";
import { pageCache } from "../game/pageCache";
import { addDays } from "../game/date";
import { dropForDate } from "../game/drop";
import { learnableWordForDrop } from "../game/dictionary";
import { bestFind } from "../game/yesterdaysBest";
import { useGameMode } from "../hooks/useGameMode";
import { RarityBadge } from "./RarityBadge";

interface Props {
  /** Today's puzzle date; the line reports the day before it. */
  date: string;
}

/**
 * Yesterday's finds, read once a visit: the line comes back with the puzzle
 * after a trip to another page without asking again. Shares the found-words
 * feed's request, so the CDN answers it from the copy it already holds.
 */
const yesterdayCache = pageCache<readonly FoundWord[]>();

/**
 * The rarest word anybody found on yesterday's drop, under today's drop.
 *
 * Yesterday's drop is not today's, so naming its best word spoils nothing here
 * -- it shows the ceiling players actually reached, which is the thing to beat.
 * Priced by the reader's own mode like the finds page, so the badge here and
 * the one on /found-words agree.
 *
 * Always says something. While the feed loads, on a failed read, or for a day
 * nobody found anything, it names the word yesterday's drop offered instead
 * (the one its finished puzzle revealed, see dictionary.learnableWordForDrop),
 * without a finder count. That word is known before any request, so the line
 * is on screen from the first paint and never pushes the input down when the
 * feed lands -- at most the word in it changes.
 */
export function YesterdaysBest({ date }: Props) {
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

  const yesterdayDrop = dropForDate(yesterday);
  const found = useMemo(
    () => (words ? bestFind(repriceFoundWords(words)) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the trigger
    [words, mode],
  );
  // A full dictionary scan, so only when the day (or the mode pricing it) moves.
  const offered = useMemo(
    () => (found ? undefined : learnableWordForDrop(yesterdayDrop, yesterday)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the trigger
    [found, yesterdayDrop, yesterday, mode],
  );
  const best = found ?? offered;
  if (!best) return null;

  return (
    <p className="yesterdays-best">
      <span className="yesterdays-best__label">
        Yesterday's best for {"“"}
        {yesterdayDrop}
        {"”"}
      </span>{" "}
      <span className="yesterdays-best__word">{best.word}</span>{" "}
      <RarityBadge rarity={best.rarity} zipf={best.zipf} date={found?.foundOn || yesterday} />
      {found && (
        <span className="yesterdays-best__finders">
          {found.finders === 1 ? "found by 1 player" : `found by ${found.finders} players`}
        </span>
      )}
    </p>
  );
}
