import { addDays, toDateString, todayDateString } from "./date";
import { maxGuessesFor } from "./constants";
import { rarityFor, rarityScore, usesRetunedTiers } from "./dictionary";
import { isEliteRarity, isWinningRarity } from "./rank";
import type { AcceptedWord, DailyProgress, StreakState } from "./types";

const PROGRESS_PREFIX = "ick:progress:";
const STREAK_KEY = "ick:streak";
const EMPTY_STREAK: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompleted: 0,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadProgress(date: string): DailyProgress | null {
  const progress = safeParse<DailyProgress>(localStorage.getItem(PROGRESS_PREFIX + date));
  if (!progress) return null;

  // Keep progress saved under a former top-tier name playable across renames.
  // The deep-tail top rank has been "Elusive", then "Mythic", and is now
  // "Legend" -- with "Elusive" since revived for a mid-ladder tier, so its
  // migration is date-gated below. Also refresh words saved with the former
  // unknown-frequency fallbacks now that the dictionary uses 1.4.
  let migrated = false;
  const acceptedWords = progress.acceptedWords.map((word) => {
    if (word.zipf === 0.1 || word.zipf === 0.3 || word.zipf === 0.5) {
      const current = rarityFor(word.word, date);
      if (current) {
        migrated = true;
        return { word: word.word, ...current };
      }
    }
    // "Elusive" named the deep-tail top rank long before Mythic and then Legend
    // did -- and it is a live tier name again from NARROW_BANDS_START, this time
    // for the band between Extremely Rare and Mythic. So only a save from a
    // puzzle predating that cutover can mean the retired top rank; on a puzzle
    // that uses the retuned tiers, Elusive is exactly what the player earned and
    // promoting it would hand out a Legend nobody found.
    if ((word.rarity as string) === "Elusive" && !usesRetunedTiers(date)) {
      migrated = true;
      return { ...word, rarity: "Legend" as const };
    }
    // The deep-tail top rank was renamed Mythic -> Legend at the 2026-08-16
    // cutover, but the 2026-08-15 system still labels its deep tail Mythic. Only
    // promote a saved deep-tail (Zipf < 1) Mythic when the puzzle's own date
    // actually uses the Legend tier -- never the latest system's measured Mythic
    // band (Zipf >= 1).
    if (
      (word.rarity as string) === "Mythic" &&
      word.zipf < 1 &&
      rarityFor(word.word, date)?.rarity === "Legend"
    ) {
      migrated = true;
      return { ...word, rarity: "Legend" as const };
    }
    return word;
  });
  const loaded = { ...progress, acceptedWords };
  if (migrated) saveProgress(loaded);
  return loaded;
}

/**
 * How far past midnight a puzzle still counts as played on its own day.
 *
 * A late-night session is an ordinary way to play a daily game, and finishing at
 * 1am should not cost the day. The live path already works this way and always
 * has: `useDailyPuzzle` reads the date once when the page loads, so a session
 * opened at 23:50 keeps submitting to that puzzle all night. This is the same
 * grace, applied to the record after the fact.
 *
 * Four hours rather than two: it covers "a couple of hours" with room to spare,
 * and 4am is a natural edge -- earlier than anyone's morning routine, so a
 * puzzle touched then belongs to last night's session far more plausibly than to
 * the new day.
 *
 * The cost, stated rather than hidden: the next day's puzzle drops at local
 * midnight, so this leaves a four-hour window each night in which yesterday's
 * puzzle could be played fresh and still count. That is archive play slipping
 * through, and it is accepted deliberately -- the players it lets in are real and
 * numerous, and the ones it lets cheat have to be awake at 3am to gain one day's
 * score.
 */
const LATE_FINISH_GRACE_HOURS = 4;

/**
 * Every puzzle this browser can show was played on its own day.
 *
 * For the leaderboard's history import: a player who joins the board has often
 * been playing for weeks, and starting them at zero throws away a record that is
 * sitting in localStorage already.
 *
 * What makes a day eligible is evidence that it was played when it dropped,
 * rather than pulled out of the archive later -- archive play is off the board
 * for the same reason it is off the streak. There are two timestamps that can
 * provide it, in order of preference:
 *
 *   - `firstWordAt`, stamped when the first word was accepted. This is the exact
 *     question being asked, and it counts a day the player never finished.
 *   - `completedAt`, the fallback for every puzzle saved before `firstWordAt`
 *     existed. Weaker in one way that the grace window above now covers: it is
 *     stamped on the last guess, which for a late-night session lands after
 *     midnight.
 *
 * A day with neither is skipped. It is not that such a day didn't happen -- it is
 * that the record cannot say when it happened, and guessing in the player's
 * favour is how the archive gets in wholesale.
 *
 * Read through `loadProgress`, so historical words come back with today's rarity
 * migrations applied rather than whatever tier name they were saved under.
 */
export function playedOnItsDay(): DailyProgress[] {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(PROGRESS_PREFIX));
  } catch {
    // Private browsing or disabled storage: there is no history to import, which
    // is not an error worth raising on the path that asks.
    return [];
  }

  const played: DailyProgress[] = [];
  for (const key of keys) {
    const progress = loadProgress(key.slice(PROGRESS_PREFIX.length));
    if (!progress || progress.acceptedWords.length === 0) continue;
    const playedAt = progress.firstWordAt ?? progress.completedAt;
    if (!playedAt) continue;
    if (!playedOnDate(playedAt, progress.date)) continue;
    played.push(progress);
  }
  return played.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Whether a timestamp counts as playing `date`'s puzzle: on the day itself, or
 * in the small hours of the morning after (see LATE_FINISH_GRACE_HOURS).
 *
 * Compared as calendar dates plus an hour rather than by adding milliseconds to
 * a midnight, so the two clock changes a year cannot shift the boundary by an
 * hour. An unparseable stamp is no evidence at all and counts as neither.
 */
function playedOnDate(timestamp: string, date: string): boolean {
  const stamped = new Date(timestamp);
  if (Number.isNaN(stamped.getTime())) return false;
  const stampedDate = toDateString(stamped);
  if (stampedDate === date) return true;
  return (
    stampedDate === addDays(date, 1) && stamped.getHours() < LATE_FINISH_GRACE_HOURS
  );
}

function saveProgress(progress: DailyProgress): void {
  localStorage.setItem(PROGRESS_PREFIX + progress.date, JSON.stringify(progress));
}

export function newProgress(date: string, drop: string): DailyProgress {
  return {
    date,
    drop,
    acceptedWords: [],
    rejectedAttempts: [],
    completed: false,
  };
}

export function loadOrCreateProgress(date: string, drop: string): DailyProgress {
  const existing = loadProgress(date);
  if (existing && existing.drop === drop) return existing;
  return newProgress(date, drop);
}

/** Development-only UI uses this to start the viewed puzzle over. */
export function resetProgress(date: string, drop: string): DailyProgress {
  localStorage.removeItem(PROGRESS_PREFIX + date);
  return newProgress(date, drop);
}

export function loadStreak(): StreakState {
  const streak = { ...EMPTY_STREAK, ...safeParse<StreakState>(localStorage.getItem(STREAK_KEY)) };
  const yesterday = addDays(todayDateString(), -1);

  if (streak.currentStreak > 0 && streak.lastCompletedDate && streak.lastCompletedDate < yesterday) {
    const reset = { ...streak, currentStreak: 0 };
    saveStreak(reset);
    return reset;
  }

  return streak;
}

function saveStreak(streak: StreakState): void {
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

/**
 * The first valid word immediately advances today's streak. The player can
 * still keep guessing up to the day's guess limit, or lock in early, without counting
 * that streak win a second time.
 */
export function recordAcceptedWord(progress: DailyProgress, word: AcceptedWord): DailyProgress {
  if (progress.completed) return progress; // no further official changes once complete
  const hasWinningWord = progress.acceptedWords.some((acceptedWord) =>
    isWinningRarity(acceptedWord.rarity)
  );
  const hasEliteWord = progress.acceptedWords.some((acceptedWord) =>
    isEliteRarity(acceptedWord.rarity)
  );
  const acceptedWords = [...progress.acceptedWords, word];
  const justCompleted = acceptedWords.length >= maxGuessesFor(progress.date);
  const won = acceptedWords.some((acceptedWord) => isWinningRarity(acceptedWord.rarity));

  const now = new Date().toISOString();
  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    completed: justCompleted,
    won: justCompleted ? won : progress.won,
    // Stamped on the first word only, and never overwritten: this records when
    // the puzzle was *played*, which is the thing the leaderboard's history
    // import has to be able to tell (see playedOnItsDay). `completedAt` cannot
    // answer that -- it is set on the last guess, and a day left half-played
    // never gets one.
    firstWordAt: progress.firstWordAt ?? now,
    completedAt: justCompleted ? now : progress.completedAt,
  };
  saveProgress(updated);

  updateHighScore(word.zipf, progress.date);

  updateRarityScore({
    shouldIncrementCrushedIt: isWinningRarity(word.rarity) && !hasWinningWord,
    shouldIncrementElite: isEliteRarity(word.rarity) && !hasEliteWord,
  });

  if (progress.acceptedWords.length === 0) {
    updateStreakOnValidAnswer(progress.date);
  }
  if (justCompleted && won) {
    incrementCompletionTotal();
  }

  return updated;
}

export function recordRejectedAttempt(progress: DailyProgress, rawWord: string): DailyProgress {
  const updated: DailyProgress = {
    ...progress,
    rejectedAttempts: [...progress.rejectedAttempts, rawWord],
  };
  saveProgress(updated);
  return updated;
}

/**
 * Advance the streak as soon as today's first valid word is accepted.
 */
function updateStreakOnValidAnswer(date: string): void {
  const streak = loadStreak();

  if (date !== todayDateString()) return;

  if (streak.lastCompletedDate === date) return; // already counted

  const yesterday = addDays(date, -1);
  const continuesStreak = streak.lastCompletedDate === yesterday;
  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  const updated: StreakState = {
    ...streak,
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastCompletedDate: date,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
  };
  saveStreak(updated);
}

function incrementCompletionTotal(): void {
  const streak = loadStreak();
  saveStreak({ ...streak, totalCompleted: streak.totalCompleted + 1 });
}

/** Rarity scores apply once per puzzle, including archive puzzles. */
function updateRarityScore({
  shouldIncrementCrushedIt,
  shouldIncrementElite,
}: {
  shouldIncrementCrushedIt: boolean;
  shouldIncrementElite: boolean;
}): void {
  if (!shouldIncrementCrushedIt && !shouldIncrementElite) return;
  const streak = loadStreak();
  saveStreak({
    ...streak,
    crushedIt: streak.crushedIt + (shouldIncrementCrushedIt ? 1 : 0),
    elite: streak.elite + (shouldIncrementElite ? 1 : 0),
  });
}

/** Keep the player's all-time best rarity score, including archive play. */
function updateHighScore(zipf: number, date: string): void {
  const streak = loadStreak();
  const score = rarityScore(zipf, date);
  if (score <= streak.highScore) return;
  saveStreak({ ...streak, highScore: score });
}
