import { useEffect, useMemo, useState } from "react";
import {
  fetchBestWordWins,
  fetchFoundWords,
  fetchWordFinders,
  repriceFoundWords,
  type FoundWord,
} from "../game/leaderboard";
import { pageCache } from "../game/pageCache";
import { bestCandidates, pickBest } from "../game/yesterdaysBest";
import { useGameMode } from "./useGameMode";

/**
 * A day's finds, read once a visit: the line comes back with the puzzle after a
 * trip to another page without asking again. Shares the found-words feed's
 * request, so the CDN answers it from the copy it already holds.
 */
const wordsCache = pageCache<readonly FoundWord[]>();

/** The best word's finders, keyed by day and word, kept the same way. */
const findersCache = pageCache<readonly string[]>();

/** A settled tie's winning word, keyed by day and the tied words. */
const tieCache = pageCache<string>();

/**
 * Requests on their way, by what they ask for. The footnote under the puzzle
 * and the news card over it (see App.tsx) both read the same day at the same
 * moment, and one request answers both.
 */
const inFlight = new Map<string, Promise<unknown>>();

function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = run().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

const readWords = (day: string) => shared(`words:${day}`, () => fetchFoundWords(day));
const readFinders = (word: string, day: string) =>
  shared(`finders:${day}:${word}`, () => fetchWordFinders(word, day));
const readWins = (day: string) => shared(`wins:${day}`, () => fetchBestWordWins(day));

export interface ResolvedBest {
  /** The day the word was found on. */
  day: string;
  /** The day's best word, priced by the reader's mode. */
  best: FoundWord;
  /** Its finders, first finder first; null when they couldn't be read. */
  finderIds: readonly string[] | null;
}

/**
 * The rarest word anybody found on `day`, with its finders -- or undefined
 * while that is still being worked out, on a failed read, for a day nobody
 * found anything, and when `day` is undefined.
 *
 * Priced by the reader's own mode like the finds page, so the score here and
 * the badge on /found-words agree.
 *
 * Two words showing the same top score are a tie, settled by `pickBest`: the
 * word of the player the line has named least often, then the longer word,
 * then a coin toss. That needs each tied word's first finder and the tally of
 * past best words, so the answer waits for both; if either can't be read the
 * tie falls through to length and the toss rather than holding it back.
 *
 * Held back until the finders have answered too, so a reader gets the word and
 * who found it at once rather than the one a beat after the other.
 */
export function useYesterdaysBest(day: string | undefined): ResolvedBest | undefined {
  const [words, setWords] = useState<readonly FoundWord[] | undefined>(() =>
    day ? wordsCache.get(day) : undefined,
  );
  const [mode] = useGameMode();

  useEffect(() => {
    let current = true;
    setWords(day ? wordsCache.get(day) : undefined);
    if (!day) return;
    readWords(day)
      .then((found) => {
        wordsCache.set(day, found);
        if (current) setWords(found);
      })
      .catch(() => {
        // Nothing to say; the cached copy, if any, stays.
      });
    return () => {
      current = false;
    };
  }, [day]);

  const candidates = useMemo(
    () => (words ? bestCandidates(repriceFoundWords(words)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the trigger
    [words, mode],
  );
  const tieKey =
    day && candidates.length > 1
      ? `${day}:${candidates
          .map((found) => found.word)
          .sort()
          .join(",")}`
      : undefined;
  // The settled tie, tagged with its key like the finders below.
  const [tie, setTie] = useState<{ key: string; word: string } | undefined>(() => {
    const word = tieKey ? tieCache.get(tieKey) : undefined;
    return tieKey && word ? { key: tieKey, word } : undefined;
  });

  useEffect(() => {
    if (!tieKey || !day) return;
    let current = true;
    const cached = tieCache.get(tieKey);
    if (cached) {
      setTie({ key: tieKey, word: cached });
      return;
    }
    const tied = candidates;
    Promise.all([
      Promise.all(
        tied.map((found) =>
          readFinders(found.word, day)
            .then((ids) => {
              findersCache.set(`${day}:${found.word}`, ids);
              return ids;
            })
            .catch(() => findersCache.get(`${day}:${found.word}`) ?? []),
        ),
      ),
      readWins(day).catch(() => ({}) as Record<string, number>),
    ]).then(([finderLists, wins]) => {
      const holders = new Map<string, string>();
      tied.forEach((found, i) => {
        const first = finderLists[i][0];
        if (first) holders.set(found.word, first.toLowerCase());
      });
      const word = pickBest(tied, day, holders, wins)?.word;
      if (!word) return;
      tieCache.set(tieKey, word);
      if (current) setTie({ key: tieKey, word });
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the tied words
  }, [tieKey]);

  const best = tieKey
    ? tie?.key === tieKey
      ? candidates.find((found) => found.word === tie.word)
      : undefined
    : candidates[0];
  const findersKey = day && best ? `${day}:${best.word}` : undefined;
  // The finders for the word they were read for: ids null when they couldn't
  // be read. Tagged with their key, so a new word never borrows the last
  // word's names while its own are on their way.
  const [finders, setFinders] = useState<
    { key: string; ids: readonly string[] | null } | undefined
  >(() => {
    const ids = findersKey ? findersCache.get(findersKey) : undefined;
    return findersKey && ids ? { key: findersKey, ids } : undefined;
  });

  useEffect(() => {
    if (!day || !best || !findersKey) return;
    let current = true;
    const cached = findersCache.get(findersKey);
    if (cached) setFinders({ key: findersKey, ids: cached });
    readFinders(best.word, day)
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

  return useMemo(
    () =>
      day && best && finders && finders.key === findersKey
        ? { day, best, finderIds: finders.ids }
        : undefined,
    [day, best, finders, findersKey],
  );
}
