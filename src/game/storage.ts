import { addDays, toDateString, todayDateString } from "./date";
import { modeForDate, modeIsChosen, type GameMode } from "./mode";
import { maxGuessesFor } from "./constants";
import { rarityFor, rarityScore, scoringLoaded, usesRetunedTiers } from "./dictionary";
import { isEliteRarity, isWinningRarity } from "./rank";
import type { AcceptedWord, DailyProgress, StreakState } from "./types";
import {
  applyFreezes,
  backdateFreezes,
  continuesInto,
  earnFreeze,
  recordFreezes,
  recordPlayed,
  startStreak,
} from "./streakFreeze";

/**
 * The two key families a player's record lives under.
 *
 * Exported for the transfer path (see game/transfer.ts), which copies them to
 * another browser as raw strings. It reads and writes them without going
 * through the functions here on purpose: what it moves is a saved record, not a
 * game in progress, and it must not be reshaped on the way by whatever
 * migration `loadProgress` happens to be running this month.
 *
 * Note for anyone adding a third key family, or a second suffix beside
 * Freeform's: the transfer copies whole keys under this prefix, suffix and all,
 * so a new *shape* under the same prefix moves for free -- but a new prefix
 * does not, and has to be named there as well or it silently stays behind.
 */
export const PROGRESS_PREFIX = "ick:progress:";

/**
 * Where one puzzle's progress lives, which from MODE_CHOICE_START depends on
 * which mode it is being played in.
 *
 * Standard keeps the bare key this game has always used, so nothing already
 * saved moves and no migration is needed -- every puzzle before the switch was
 * played in exactly one way, and that one way is what the bare key holds.
 * Freeform gets a suffix, and with it its own four guesses, its own retry and
 * its own record of the day. That is the point of two modes rather than one with
 * a setting: switching is meant to be something you can do mid-morning without
 * spending the guesses you already made.
 *
 * The suffix is Freeform's rather than Standard's because Standard is the one
 * with history behind it. Naming the new thing costs nothing; renaming the old
 * one costs every save in every browser.
 */
function progressKey(date: string, mode: GameMode = modeForDate(date)): string {
  return modeIsChosen(date) && mode === "freeform"
    ? `${PROGRESS_PREFIX}${date}:freeform`
    : PROGRESS_PREFIX + date;
}

/**
 * Read a progress key back: the puzzle it belongs to, and the mode it was played
 * in. The inverse of `progressKey`, for the two scans that walk every save this
 * browser holds and have only the keys to go on.
 */
function readProgressKey(key: string): { date: string; mode: GameMode } {
  const rest = key.slice(PROGRESS_PREFIX.length);
  const [date, suffix] = rest.split(":");
  if (suffix === "freeform") return { date, mode: "freeform" };
  // An unsuffixed key in the chosen era is Standard's, always -- the suffix is
  // Freeform's marker and nothing else writes one. Deliberately not
  // `modeForDate`, which would read the switch's *current* position and so
  // relabel every Standard day the moment the player flipped it. Before the
  // choice date there is no suffix to carry and the calendar is the whole
  // answer: the trial week is freeform, everything before it standard.
  return { date, mode: modeIsChosen(date) ? "standard" : modeForDate(date) };
}
export const STREAK_KEY = "ick:streak";
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

export function loadProgress(date: string, mode?: GameMode): DailyProgress | null {
  const progress = safeParse<DailyProgress>(localStorage.getItem(progressKey(date, mode)));
  if (!progress) return null;

  // Keep progress saved under a former top-tier name playable across renames.
  // The deep-tail top rank has been "Elusive", then "Mythic", and is now
  // "Legend" -- with "Elusive" since revived for a mid-ladder tier, so its
  // migration is date-gated below. Also refresh words saved with the former
  // unknown-frequency fallbacks now that the dictionary uses 1.4.
  // The two migrations that re-price a word need the deferred scoring data
  // (see `scoringReady` in dictionary.ts). Before it is in they wait for the
  // next load rather than save a price made without it; neither is urgent, and
  // the words keep the scores they were saved with meanwhile.
  const canReprice = scoringLoaded(date);
  let migrated = false;
  const acceptedWords = progress.acceptedWords.map((word) => {
    if (canReprice && (word.zipf === 0.1 || word.zipf === 0.3 || word.zipf === 0.5)) {
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
    // Very Common was folded into Common on every puzzle, archived ones
    // included, so a word saved under it reads as Common now.
    if ((word.rarity as string) === "Very Common") {
      migrated = true;
      return { ...word, rarity: "Common" as const };
    }
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
      canReprice &&
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

/**
 * Whether the player banked a word on any puzzle dated before `date`, in either
 * mode -- a returning player, who has seen the scoring a cutover on `date`
 * changes. Raw JSON like `playedPuzzleCount`, for the same reason.
 */
export function playedBefore(date: string): boolean {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(PROGRESS_PREFIX));
  } catch {
    return false;
  }
  return keys.some((key) => {
    if (readProgressKey(key).date >= date) return false;
    return Boolean(safeParse<DailyProgress>(localStorage.getItem(key))?.acceptedWords?.length);
  });
}

/** How many of the player's most recent play days `playedBothModesLately` looks at. */
export const RECENT_PLAY_DAYS = 5;

/**
 * Whether the player has banked a word in both Standard and Freeform across
 * their last `RECENT_PLAY_DAYS` play days (puzzles from MODE_CHOICE_START on
 * with a word in either mode, not calendar days). The guess log offers to copy words across only to such a
 * player: to anyone else the other mode is a game they never chose, or one they
 * have stopped playing. Raw JSON like `playedPuzzleCount`, for the same reason.
 */
export function playedBothModesLately(): boolean {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(PROGRESS_PREFIX));
  } catch {
    return false;
  }
  const modesByDate = new Map<string, Set<GameMode>>();
  for (const key of keys) {
    if (!safeParse<DailyProgress>(localStorage.getItem(key))?.acceptedWords?.length) continue;
    const { date, mode } = readProgressKey(key);
    // Before the choice date the calendar picked the mode, not the player.
    if (!modeIsChosen(date)) continue;
    const modes = modesByDate.get(date) ?? new Set<GameMode>();
    modes.add(mode);
    modesByDate.set(date, modes);
  }
  const recent = [...modesByDate.keys()].sort().reverse().slice(0, RECENT_PLAY_DAYS);
  const seen = new Set(recent.flatMap((date) => [...modesByDate.get(date)!]));
  return seen.size === 2;
}

export function playedOnItsDay(): DailyProgress[] {
  return playedHistory().filter((progress) => {
    const playedAt = progress.firstWordAt ?? progress.completedAt;
    return Boolean(playedAt) && playedOnDate(playedAt!, progress.date);
  });
}

/**
 * Every stored day with at least one accepted word, whenever it was played.
 *
 * The finds feed's view of the history, where `playedOnItsDay` above is the
 * board's: a word found out of the archive was still found on that drop, so it
 * belongs on the drop's feed even though it can never rank.
 */
export function playedHistory(): DailyProgress[] {
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
    const { date, mode } = readProgressKey(key);
    const progress = loadProgress(date, mode);
    if (!progress || progress.acceptedWords.length === 0) continue;
    // The mode comes off the key rather than out of the record, so a day saved
    // before the field existed still lands on the right board.
    played.push(progress.mode ? progress : { ...progress, mode });
  }
  // By date, then by mode, so a day played both ways submits in a stable order.
  return played.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.mode ?? "").localeCompare(b.mode ?? "")
  );
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

/**
 * Sent on `window` after a puzzle's record is saved, so what depends on whether
 * anything has been played -- the header's Stats tab -- can notice the first
 * word without waiting for a navigation.
 */
export const PROGRESS_SAVED_EVENT = "ick:progress-saved";

function saveProgress(progress: DailyProgress): void {
  // Keyed by the record's own mode rather than by the switch's current position:
  // a live lookup can settle after the player has flipped it, and a word banked
  // then belongs to the puzzle it was submitted to.
  localStorage.setItem(progressKey(progress.date, progress.mode), JSON.stringify(progress));
  window.dispatchEvent(new Event(PROGRESS_SAVED_EVENT));
}

export function newProgress(date: string, drop: string): DailyProgress {
  return {
    date,
    drop,
    // Stamped so the record says which rules it was played under, rather than
    // being re-derived from a switch that has moved since. Only from the chosen
    // era: before it, a date already decides its own mode.
    ...(modeIsChosen(date) ? { mode: modeForDate(date) } : {}),
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
  localStorage.removeItem(progressKey(date));
  return newProgress(date, drop);
}

export function loadStreak(): StreakState {
  const stored = { ...EMPTY_STREAK, ...safeParse<StreakState>(localStorage.getItem(STREAK_KEY)) };
  // Saved freezes the streak would have earned before they existed, granted
  // once and before the missed days are counted, so a player already in a gap
  // today is covered by them.
  const streak = backdateFreezes(withPlayedDates(stored));
  // Missed days are covered by saved freezes, one each, if there are enough;
  // otherwise the streak resets (see game/streakFreeze.ts).
  const current = applyFreezes(streak, todayDateString());
  if (current !== stored) saveStreak(current);
  return current;
}

/**
 * The streak with its played days filled in from the stored puzzles, once,
 * for a save from before they were kept: the days already played this week
 * count towards Saturday off (see `isRestDay` in game/streakFreeze.ts).
 */
function withPlayedDates(streak: StreakState): StreakState {
  if (streak.playedDates) return streak;
  const dates = playedOnItsDay().map((progress) => progress.date);
  if (streak.lastCompletedDate) dates.push(streak.lastCompletedDate);
  return dates.sort().reduce(recordPlayed, { ...streak, playedDates: [] });
}

function saveStreak(streak: StreakState): void {
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

/**
 * The day the welcome-back card was last closed (see
 * components/WelcomeBackCard.tsx). A date rather than a flag: closing it hides
 * it for that day only, across reloads, and a later return greets again.
 * Device-local, so it is not carried by a transfer.
 */
const WELCOME_BACK_DISMISSED_KEY = "ick:welcome-back-dismissed";

export function welcomeBackDismissedOn(): string | null {
  try {
    return localStorage.getItem(WELCOME_BACK_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissWelcomeBack(date: string): void {
  try {
    localStorage.setItem(WELCOME_BACK_DISMISSED_KEY, date);
  } catch {
    // The card is still closed for this session (component state).
  }
}

/**
 * The first valid word advances today's streak, if a visit has not already
 * (see recordVisit). The player can
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
    advanceStreak(progress.date);
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
 * Count today towards the streak for a player who opened the site and stayed
 * a moment (see VISIT_STREAK_DELAY_MS in hooks/useDailyPuzzle.ts), word or no
 * word. Returns whether this visit was the one that counted it, which is when
 * the streak rolls up on screen.
 */
export function recordVisit(date: string): boolean {
  return advanceStreak(date);
}

/**
 * Advance the streak once a day: on the first visit long enough to count, or
 * on today's first valid word if that comes first. Returns whether it moved.
 */
function advanceStreak(date: string): boolean {
  const streak = loadStreak();

  if (date !== todayDateString()) return false;

  if (streak.lastCompletedDate === date) return false; // already counted

  // Yesterday may have been covered by a freeze rather than played, or been a
  // rest day skipped.
  const continuesStreak = continuesInto(streak, date);
  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  const updated: StreakState = {
    ...streak,
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastCompletedDate: date,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
    // Saved freezes belong to the streak that earned them; a new one starts
    // with none, or with a welcome-back freeze for a returning player.
    ...(continuesStreak ? { bankedFreezes: streak.bankedFreezes } : startStreak(streak, date)),
  };
  // Recorded after the day's freeze is earned, so the day shows what it ended with.
  saveStreak(recordPlayed(recordFreezes(earnFreeze(updated), date), date));
  return true;
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
 * Put new scores on words already banked, keeping everything else about them.
 *
 * The one caller is a fold rejected live at /folded-live (see
 * game/liveFoldRejections.ts): the word stays where it was and only its price
 * moves. Allowed on a finished puzzle too, unlike banking a word -- the puzzle
 * is not being played further, it is being corrected. A rejected fold can only
 * make a word rarer, so the counters that move are the ones a better word earns.
 *
 * Returns `progress` unchanged when no word's score moved.
 */
export function rescoreAcceptedWords(
  progress: DailyProgress,
  rescored: ReadonlyMap<string, AcceptedWord>
): DailyProgress {
  let changed = false;
  const acceptedWords = progress.acceptedWords.map((word) => {
    const next = rescored.get(word.word);
    if (!next || (next.zipf === word.zipf && next.rarity === word.rarity)) return word;
    changed = true;
    return { ...word, zipf: next.zipf, rarity: next.rarity };
  });
  if (!changed) return progress;

  const hadWinning = progress.acceptedWords.some((w) => isWinningRarity(w.rarity));
  const hadElite = progress.acceptedWords.some((w) => isEliteRarity(w.rarity));
  const hasWinning = acceptedWords.some((w) => isWinningRarity(w.rarity));
  const hasElite = acceptedWords.some((w) => isEliteRarity(w.rarity));
  const updated: DailyProgress = {
    ...progress,
    acceptedWords,
    won: progress.completed ? hasWinning : progress.won,
  };
  saveProgress(updated);

  for (const word of acceptedWords) updateHighScore(word.zipf, progress.date);
  updateRarityScore({
    shouldIncrementCrushedIt: hasWinning && !hadWinning,
    shouldIncrementElite: hasElite && !hadElite,
  });
  if (progress.completed && hasWinning && progress.won !== true) incrementCompletionTotal();

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
