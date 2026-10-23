import { useEffect, useMemo, useState } from "react";
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
import { bestFind, foundByLabel, namedFinder } from "../game/yesterdaysBest";
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
 * Names a finder -- the reader first, when they were one -- once the word's
 * finders arrive, and falls back to a bare count if they can't be read.
 *
 * Says nothing at all while loading, on a failed read, or for a day nobody
 * found anything: it is a footnote to the puzzle, and a spinner or an error
 * under the guesses would be louder than the line itself.
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
  // Undefined while the finders are on their way, null when they couldn't be read.
  const [finders, setFinders] = useState<readonly string[] | null | undefined>(() =>
    findersKey ? findersCache.get(findersKey) : undefined,
  );

  useEffect(() => {
    if (!best || !findersKey) return;
    let current = true;
    setFinders(findersCache.get(findersKey));
    fetchWordFinders(best.word, yesterday)
      .then((ids) => {
        findersCache.set(findersKey, ids);
        if (current) setFinders(ids);
      })
      .catch(() => {
        if (current) setFinders((cached) => cached ?? null);
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the word
  }, [findersKey]);

  if (!best) return null;

  const selfId = loadPlayerId()?.toLowerCase() ?? null;
  const named = finders ? namedFinder(finders, best.finders, selfId) : undefined;
  let foundBy: string | undefined;
  if (named) foundBy = foundByLabel(named.self ? selfName(named.id) : handleFor(named.id), named.others);
  else if (finders !== undefined)
    foundBy = `Found by ${best.finders} ${best.finders === 1 ? "player" : "players"}`;

  const scoreDate = best.foundOn || yesterday;
  return (
    <p className="yesterdays-best">
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
      {foundBy && <span className="yesterdays-best__finders">{foundBy}</span>}
    </p>
  );
}
