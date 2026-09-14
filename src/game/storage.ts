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
/**
 * How many puzzles this browser has ever scored on -- any day, any date, one
 * accepted word or twelve.
 *
 * Counts puzzles rather than words, because "has played twice" is a question
 * about sittings: four words on one drop is one puzzle, and a player who has
 * only ever played once should not read as experienced for having had a good
 * day. Deliberately weaker than `playedOnItsDay` below, which insists a puzzle
 * was played on its own day and throws out anything it cannot date -- that one
 * decides what may go on a leaderboard, this one only decides whether somebody
 * has seen the game enough to notice its rules changing.
 *
 * Reads the raw JSON rather than going through `loadProgress`: the question is
 * whether there is a word in there, and the rarity migrations that function runs
 * are a lot of work to answer it.
 *
 * Storage that cannot be read reports none, which for the caller means the
 * ordinary once-only announcement rather than the repeat.
 */
export function playedPuzzleCount(): number {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(PROGRESS_PREFIX));
  } catch {
    return 0;
  }
  let played = 0;
  for (const key of keys) {
    const progress = safeParse<DailyProgress>(localStorage.getItem(key));
    if (progress?.acceptedWords?.length) played++;
  }
  return played;
}

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

/** Give back the completion a retry un-finished (see retryWord). */
function decrementCompletionTotal(): void {
  const streak = loadStreak();
  saveStreak({ ...streak, totalCompleted: Math.max(0, streak.totalCompleted - 1) });
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

/**
 * Give back the tier counters a retried word had earned (see retryWord). The
 * mirror of `updateRarityScore`: each counter moves once per puzzle, so a retry
 * that removes the puzzle's only winning or elite word puts it back.
 *
 * Floored at zero. A counter cannot go negative from a save written before
 * either counter existed, and a wrong tally is not worth throwing for.
 */
function rollBackRarityScore({
  shouldDecrementCrushedIt,
  shouldDecrementElite,
}: {
  shouldDecrementCrushedIt: boolean;
  shouldDecrementElite: boolean;
}): void {
  if (!shouldDecrementCrushedIt && !shouldDecrementElite) return;
  const streak = loadStreak();
  saveStreak({
    ...streak,
    crushedIt: Math.max(0, streak.crushedIt - (shouldDecrementCrushedIt ? 1 : 0)),
    elite: Math.max(0, streak.elite - (shouldDecrementElite ? 1 : 0)),
  });
}

/** Keep the player's all-time best rarity score, including archive play. */
function updateHighScore(zipf: number, date: string): void {
  const streak = loadStreak();
  const score = rarityScore(zipf, date);
  if (score <= streak.highScore) return;
  saveStreak({ ...streak, highScore: score });
}

/**
 * Spend this puzzle's one retry on an already-banked word: drop it, hand its
 * guess back, and let the player spend the slot on something else.
 *
 * The case it exists for is the last guess landing on a Common. Four guesses is
 * few enough that a word you regret is most of a day's play, and without this
 * the only recourse is waiting for tomorrow.
 *
 * One per puzzle, which is what keeps it a mulligan rather than a reroll: with
 * unlimited retries a player would simply re-spin every slot until a Legend
 * came up, and the score would stop meaning anything. Any banked word is
 * eligible, not only the newest -- the regret is usually about the *worst* word,
 * and which guess it happened to be is beside the point.
 *
 * Everything the removed word earned this puzzle is handed back with it, so a
 * retry cannot be used to bank a tier twice:
 *
 *   - completion, when the retry un-finishes a finished puzzle. The count is
 *     decremented only if this puzzle had actually incremented it (completed and
 *     won), and re-completing counts it again.
 *   - the crushed-it and elite counters, when the removed word was the only one
 *     on the puzzle holding that tier -- which mirrors exactly when they were
 *     incremented (see updateRarityScore).
 *
 * Two things are deliberately *not* rolled back. The streak banked on the first
 * accepted word, and a day that was played stays played -- taking a streak away
 * for using a feature the game offers is a punishment nobody asked for. And the
 * all-time high score stays: it is a personal best across every puzzle ever
 * played, there is no history kept to recompute it from, and the word was
 * genuinely found before it was set aside.
 *
 * The leaderboard is not rewritten either, because it cannot be: the write is
 * monotonic per day (`greatest(...)` -- see the leaderboard migration), so a
 * retry can only ever raise a board score, never lower one. Between a retry and
 * the replacement word, a player's board total can therefore still include the
 * word they dropped. That is the safe direction to be wrong in, and the
 * alternative is a retraction path built for a score nobody is disputing.
 *
 * Returns `progress` unchanged when the retry is already spent or the word
 * isn't banked, so callers can compare by identity to tell whether it happened.
 */
export function retryWord(progress: DailyProgress, word: string): DailyProgress {
  if (progress.retryUsed) return progress;
  const index = progress.acceptedWords.findIndex((accepted) => accepted.word === word);
  if (index === -1) return progress;

  const removed = progress.acceptedWords[index];
  const acceptedWords = progress.acceptedWords.filter((_, i) => i !== index);
  // Recomputed rather than assumed false: the guess limit is date-gated, and
  // this is the same question `recordAcceptedWord` asks when banking one.
  const completed = acceptedWords.length >= maxGuessesFor(progress.date);
  const countedCompletion = progress.completed && progress.won === true;

  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    retryUsed: true,
    completed,
    // Both are facts about a finished puzzle. A puzzle the retry re-opened has
    // neither until it finishes again.
    won: completed ? acceptedWords.some((w) => isWinningRarity(w.rarity)) : undefined,
    completedAt: completed ? progress.completedAt : undefined,
    // Kept: it records when this puzzle was *played*, which retrying a word does
    // not change, and re-banking a word must not restamp it (see playedOnItsDay).
    firstWordAt: progress.firstWordAt,
  };
  saveProgress(updated);

  if (countedCompletion && !completed) decrementCompletionTotal();
  rollBackRarityScore({
    shouldDecrementCrushedIt:
      isWinningRarity(removed.rarity) && !acceptedWords.some((w) => isWinningRarity(w.rarity)),
    shouldDecrementElite:
      isEliteRarity(removed.rarity) && !acceptedWords.some((w) => isEliteRarity(w.rarity)),
  });

  return updated;
}

/**
 * Give up this puzzle's retry without spending it on a word.
 *
 * The one caller is the reveal under the drop (see DropDisplay): a finished
 * puzzle still holding its retry is a puzzle the player may yet re-open, and
 * showing them the best word first would turn the mulligan into a lookup. So
 * the reveal costs the retry, and this is the payment -- the same flag
 * `retryWord` sets, with none of the roll-back, because no word moved.
 *
 * Returns `progress` unchanged when there was no retry left to give up, so
 * callers can compare by identity to tell whether it happened.
 */
export function forfeitRetry(progress: DailyProgress): DailyProgress {
  if (progress.retryUsed) return progress;
  const updated: DailyProgress = { ...progress, retryUsed: true };
  saveProgress(updated);
  return updated;
}
