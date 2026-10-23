import { useEffect, useMemo, useState } from "react";
import { fetchFoundWords, repriceFoundWords, type FoundWord } from "../game/leaderboard";
import { pageCache } from "../game/pageCache";
import { addDays } from "../game/date";
import { dropForDate } from "../game/drop";
import { formatRarityScore, learnableWordForDrop } from "../game/dictionary";
import { bestFind } from "../game/yesterdaysBest";
import { useGameMode } from "../hooks/useGameMode";
import { rarityClassName } from "./rarityStyles";

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
 * The rarest word anybody found on yesterday's drop, behind a button under
 * today's drop.
 *
 * Yesterday's drop is not today's, so the word spoils nothing here and costs
 * nothing to see -- the button is there so the word is something to open, the
 * way the word of the day was, rather than a line read in passing. Opened, it
 * shows the word, its score and who found it first. Priced by the reader's own
 * mode like the finds page, so the score here and the one on /found-words agree.
 *
 * The button needs no request, so it is on screen from the first paint and
 * never pushes the input down when the feed lands. Opened while the feed loads,
 * on a failed read, or for a day nobody found anything, it names the word
 * yesterday's drop offered instead (the one its finished puzzle revealed, see
 * dictionary.learnableWordForDrop), with no finder.
 */
export function YesterdaysBest({ date }: Props) {
  const yesterday = addDays(date, -1);
  const [words, setWords] = useState<readonly FoundWord[] | undefined>(() =>
    yesterdayCache.get(yesterday),
  );
  const [mode] = useGameMode();
  const [open, setOpen] = useState(false);

  // A new day is a new word, and it starts behind the button like the last one.
  useEffect(() => setOpen(false), [yesterday]);

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

  if (!open) {
    return (
      <div className="yesterdays-best">
        <button
          type="button"
          className="yesterdays-best__button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Yesterday's Best Word
        </button>
      </div>
    );
  }

  const scoredOn = found?.foundOn || yesterday;
  return (
    <div className="yesterdays-best">
      <p className="yesterdays-best__label">
        Yesterday's best on {"“"}
        {yesterdayDrop}
        {"”"}
      </p>
      <p className="yesterdays-best__word">
        {best.word}
        {/* The score alone, wearing its tier's colours, as the word of the day
            showed it. The tier is named for a screen reader, so nothing rests
            on the colour by itself. */}
        <span className={`yesterdays-best__score ${rarityClassName(best.rarity, scoredOn)}`}>
          {formatRarityScore(best.zipf, scoredOn)}
          <span className="sr-only"> {best.rarity}</span>
        </span>
      </p>
      <p className="yesterdays-best__finder">{finderLine(found)}</p>
    </div>
  );
}

/** Who got there first, or what the word is when nobody's finds can be read. */
function finderLine(found: FoundWord | undefined): string {
  if (!found) return "The best word the drop offered";
  const others = found.finders > 1 ? ` · ${found.finders} players found it` : "";
  if (found.firstFinder) return `First found by ${found.firstFinder}${others}`;
  return found.finders === 1 ? "Found by 1 player" : `Found by ${found.finders} players`;
}
