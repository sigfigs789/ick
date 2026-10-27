/**
 * Achievements: milestones read off a player's own record, shown on the Stats
 * page (see components/StatsPage.tsx).
 *
 * Each one is worked out from the stored puzzles and the streak, walking the
 * history in date order so it knows the puzzle that earned it. Once earned it is
 * kept (see `syncAchievements`): a word's score can still move after the day --
 * a hand override, a live fold rejection -- and a badge that disappears because
 * the scoring was corrected under it would be a punishment for nothing the
 * player did.
 *
 * Device-local, like the rest of the record: the transfer carries the puzzles
 * and the streak, and the badges are worked out again from those.
 */

import achievementRates from "../data/achievement-rates.json";
import { addDays, dayOfWeek, todayDateString } from "./date";
import { maxGuessesFor } from "./constants";
import { handleFor } from "./handle";
import { isUnattestedZipf, rarityForZipf, rarityScore } from "./dictionary";
import { dropForDate } from "./drop";
import { modeIsChosen } from "./mode";
import { nextMonthStart } from "./month";
import { loadPlayerId } from "./player";
import { isWinningRarity } from "./rank";
import { CURRENT_TIERS } from "./stats";
import { loadStreak, playedHistory, playedOnItsDay } from "./storage";
import { takesPlayerMessages } from "./playerMessages";
import { suggestedWords, type SuggestedWordRecord } from "./suggestions";
import type { AcceptedWord, DailyProgress, Rarity, StreakState } from "./types";

export type AchievementGroup =
  | "Getting started"
  | "Rarity"
  | "Streaks"
  | "Collections"
  | "Style"
  | "Word scouting";

export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = [
  "Getting started",
  "Rarity",
  "Streaks",
  "Collections",
  "Style",
  "Word scouting",
];

/** What an achievement needs to know about the player. */
export interface AchievementRecord {
  /** Every stored puzzle with a banked word, by date. */
  history: readonly DailyProgress[];
  /** The dates played on their own day, either mode. */
  onItsDay: readonly string[];
  streak: Pick<StreakState, "currentStreak" | "longestStreak" | "lastCompletedDate">;
  /** The words this player has suggested (see game/suggestions.ts). */
  suggestions?: readonly SuggestedWordRecord[];
  /**
   * How many days this player's word was the day's best -- the word the line
   * under the next puzzle names, unattested words included (see
   * `fetchWordOfTheDayWins`). Absent until the server has said.
   */
  bestWordWins?: number;
}

/**
 * Where a check landed: the date of the puzzle that earned it (or `today` when
 * the record cannot say which), and for a count, how far along it is.
 */
interface Check {
  earnedOn: string | null;
  progress?: { current: number; target: number };
}

export interface Achievement {
  id: string;
  group: AchievementGroup;
  icon: string;
  title: string;
  description: string;
  check: (record: AchievementRecord, today: string) => Check;
  /**
   * Earned through the suggestion box, so left off a host that has none (see
   * game/playerMessages.ts) rather than shown as a badge nobody there can get.
   */
  viaSuggestions?: true;
  /**
   * What simply playing on counts toward, for one earned by coming back (see
   * game/comeBack.ts): the current streak, days played, or words banked.
   */
  byPlaying?: "streak" | "days" | "words";
}

export interface AchievementStatus {
  achievement: Achievement;
  /** The date it was earned, or null while locked. */
  earnedOn: string | null;
  /** For a count still locked: how far along. */
  progress?: { current: number; target: number };
}

const MYTHIC_OR_BETTER: readonly Rarity[] = ["Mythic", "Legend"];

/** The four top tiers, one word each, for Royal flush. */
const ROYAL_FLUSH: readonly Rarity[] = ["Legend", "Mythic", "Elusive", "Extremely Rare"];

/**
 * `record` as the share of players holding each badge counts it: with every
 * Legend no corpus measures counted as no tier at all. That 10.00 is the
 * stand-in score for a word nothing attests (see `isUnattestedZipf`), not a
 * find, and it is the easiest Legend there is. The player still earns and keeps
 * badges from those words -- this only keeps them out of the "12% of players"
 * under each badge, so the share says how hard the badge is to earn on words
 * the data says are rare.
 */
export function countedRecord(record: AchievementRecord): AchievementRecord {
  return {
    ...record,
    history: record.history.map((progress) =>
      progress.acceptedWords.some(isUnattestedLegend)
        ? {
            ...progress,
            acceptedWords: progress.acceptedWords.map((word) =>
              isUnattestedLegend(word) ? { ...word, ...NO_TIER } : word
            ),
          }
        : progress
    ),
  };
}

/**
 * A word that counts as no tier: Quotidian is the retired bottom tier, which no
 * badge asks for, and a Zipf of 8 scores nothing on any scale.
 */
const NO_TIER = { rarity: "Quotidian", zipf: 8 } as const;

function isUnattestedLegend(word: AcceptedWord): boolean {
  return word.rarity === "Legend" && isUnattestedZipf(word.zipf);
}

/** The first puzzle with a word that passes `test`. */
function firstWord(test: (rarity: Rarity) => boolean): Achievement["check"] {
  return ({ history }) => {
    const hit = history.find((progress) => progress.acceptedWords.some((w) => test(w.rarity)));
    return { earnedOn: hit?.date ?? null };
  };
}

/** The first puzzle `passes` is true of. */
function firstPuzzle(passes: (progress: DailyProgress) => boolean): Achievement["check"] {
  return ({ history }) => ({ earnedOn: history.find(passes)?.date ?? null });
}

/** A running count over the history, earned on the puzzle that reaches `target`. */
function countTo(
  target: number,
  countIn: (progress: DailyProgress) => number
): Achievement["check"] {
  return ({ history }) => {
    let current = 0;
    for (const progress of history) {
      current += countIn(progress);
      if (current >= target) return { earnedOn: progress.date };
    }
    return { earnedOn: null, progress: { current, target } };
  };
}

/** Distinct days played, earned on the `target`th. */
function daysPlayed(target: number): Achievement["check"] {
  return ({ history }) => {
    const days = new Set<string>();
    for (const progress of history) {
      days.add(progress.date);
      if (days.size >= target) return { earnedOn: progress.date };
    }
    return { earnedOn: null, progress: { current: days.size, target } };
  };
}

/**
 * A streak of `target` days. The streak only keeps its length and its end, so
 * the day is known while the current streak is the one that reached it; for an
 * old streak, today is the best the record can do.
 */
function streakOf(target: number): Achievement["check"] {
  return ({ streak }, today) => {
    if (streak.longestStreak < target) {
      return { earnedOn: null, progress: { current: streak.longestStreak, target } };
    }
    if (streak.currentStreak >= target && streak.lastCompletedDate) {
      return { earnedOn: addDays(streak.lastCompletedDate, target - streak.currentStreak) };
    }
    return { earnedOn: today };
  };
}

/** Every day of one calendar month played on its own day. */
function perfectMonth({ onItsDay }: AchievementRecord): Check {
  const played = new Set(onItsDay);
  const months = [...new Set(onItsDay.map((date) => date.slice(0, 7)))].sort();
  for (const month of months) {
    const last = addDays(nextMonthStart(`${month}-01`), -1);
    let day = `${month}-01`;
    let whole = true;
    while (day <= last) {
      if (!played.has(day)) {
        whole = false;
        break;
      }
      day = addDays(day, 1);
    }
    if (whole) return { earnedOn: last };
  }
  return { earnedOn: null };
}

/** A word in every tier a player can reach today. */
function fullSpectrum({ history }: AchievementRecord): Check {
  const seen = new Set<Rarity>();
  for (const progress of history) {
    for (const word of progress.acceptedWords) {
      if (CURRENT_TIERS.includes(word.rarity)) seen.add(word.rarity);
    }
    if (seen.size === CURRENT_TIERS.length) return { earnedOn: progress.date };
  }
  return { earnedOn: null, progress: { current: seen.size, target: CURRENT_TIERS.length } };
}

/** Every guess spent, each one passing `test`. */
function everyGuess(test: (rarity: Rarity) => boolean) {
  return (progress: DailyProgress): boolean =>
    progress.completed &&
    progress.acceptedWords.length >= maxGuessesFor(progress.date) &&
    progress.acceptedWords.every((word) => test(word.rarity));
}

function hasWin(progress: DailyProgress): boolean {
  return progress.acceptedWords.some((word) => isWinningRarity(word.rarity));
}

/** A finished win with not one guess turned away. */
function cleanCopy(progress: DailyProgress): boolean {
  return progress.completed && progress.rejectedAttempts.length === 0 && hasWin(progress);
}

/** The puzzle's retry spent, and a Rare or better word found all the same. */
function secondChance(progress: DailyProgress): boolean {
  return Boolean(progress.retryUsed) && hasWin(progress);
}

/** A word as long as "sesquipedalian" or longer. */
const LONG_WORD = "sesquipedalian".length;

/** Every guess spent, and only the last one Rare or better. */
function downToTheWire(progress: DailyProgress): boolean {
  const words = progress.acceptedWords;
  if (!progress.completed || words.length < maxGuessesFor(progress.date)) return false;
  return (
    isWinningRarity(words[words.length - 1].rarity) &&
    words.slice(0, -1).every((word) => !isWinningRarity(word.rarity))
  );
}

/** The same day's puzzle won in Standard and in Freeform. */
function bothWays({ history }: AchievementRecord): Check {
  const wonBy = new Map<string, Set<string>>();
  for (const progress of history) {
    if (!modeIsChosen(progress.date) || !progress.mode) continue;
    if (!hasWin(progress)) continue;
    const modes = wonBy.get(progress.date) ?? new Set();
    modes.add(progress.mode);
    wonBy.set(progress.date, modes);
    if (modes.size === 2) return { earnedOn: progress.date };
  }
  return { earnedOn: null };
}

/**
 * A puzzle played after its own day, out of the archive. Only a puzzle that
 * says when it was played counts: an old save with no timestamp cannot tell an
 * archive day from a day played on time.
 */
function fromTheArchive({ history, onItsDay }: AchievementRecord): Check {
  const onTime = new Set(onItsDay);
  const hit = history.find(
    (progress) => Boolean(progress.firstWordAt ?? progress.completedAt) && !onTime.has(progress.date)
  );
  return { earnedOn: hit?.date ?? null };
}

/** The earliest of a suggestion date, over the suggestions that have one. */
function firstSuggestion(
  dateOf: (suggestion: SuggestedWordRecord) => string | undefined
): Achievement["check"] {
  return ({ suggestions = [] }) => {
    const dates = suggestions.flatMap((s) => dateOf(s) ?? []).sort();
    return { earnedOn: dates[0] ?? null };
  };
}

function countOf(rarities: readonly Rarity[]) {
  return (progress: DailyProgress) =>
    progress.acceptedWords.filter((word) => rarities.includes(word.rarity)).length;
}

/** Every tier, weakest first, for "this tier or better". */
const TIER_ORDER: readonly Rarity[] = [
  "Quotidian",
  "Common",
  "Uncommon",
  "Rare",
  "Extremely Rare",
  "Elusive",
  "Mythic",
  "Legend",
];

function atLeast(floor: Rarity): (rarity: Rarity) => boolean {
  const min = TIER_ORDER.indexOf(floor);
  return (rarity) => TIER_ORDER.indexOf(rarity) >= min;
}

/** A word's score, on the date its puzzle is scored under. */
function scoreOf(word: AcceptedWord, date: string): number {
  return rarityScore(word.zipf, date);
}

/** The best word of one puzzle, by score. */
function bestScored(progress: DailyProgress): AcceptedWord | undefined {
  let best: AcceptedWord | undefined;
  for (const word of progress.acceptedWords) {
    if (!best || scoreOf(word, progress.date) > scoreOf(best, progress.date)) best = word;
  }
  return best;
}

/**
 * The puzzles played on their own day, grouped by date in date order: both
 * modes of one day count as that day.
 */
function onItsDayPuzzles({ history, onItsDay }: AchievementRecord): [string, DailyProgress[]][] {
  const played = new Set(onItsDay);
  const byDate = new Map<string, DailyProgress[]>();
  for (const progress of history) {
    if (!played.has(progress.date)) continue;
    byDate.set(progress.date, [...(byDate.get(progress.date) ?? []), progress]);
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * `target` days in a row, each played on its own day with a puzzle `passes` is
 * true of. One day without one starts the count again.
 */
function runOf(
  target: number,
  passes: (progress: DailyProgress) => boolean
): Achievement["check"] {
  return (record) => {
    let run = 0;
    let best = 0;
    let last: string | null = null;
    for (const [date, puzzles] of onItsDayPuzzles(record)) {
      if (!puzzles.some(passes)) {
        run = 0;
        last = null;
        continue;
      }
      run = last !== null && addDays(last, 1) === date ? run + 1 : 1;
      last = date;
      best = Math.max(best, run);
      if (run >= target) return { earnedOn: date };
    }
    return { earnedOn: null, progress: { current: best, target } };
  };
}

/** A word of `tier` or better in the puzzle. */
function hasTier(tier: Rarity) {
  const test = atLeast(tier);
  return (progress: DailyProgress): boolean =>
    progress.acceptedWords.some((word) => test(word.rarity));
}

/** Every guess spent and the puzzle finished, with nothing turned away. */
function flawless(progress: DailyProgress): boolean {
  return progress.completed && progress.rejectedAttempts.length === 0;
}

/** Every guess spent, each scoring higher (`up`) or lower than the one before. */
function eachGuess(up: boolean) {
  return (progress: DailyProgress): boolean => {
    const words = progress.acceptedWords;
    if (!progress.completed || words.length < maxGuessesFor(progress.date)) return false;
    return words.every((word, i) => {
      if (i === 0) return true;
      const change = scoreOf(word, progress.date) - scoreOf(words[i - 1], progress.date);
      return up ? change > 0 : change < 0;
    });
  };
}

const climber = eachGuess(true);

/** Climber, with the last guess a Legend -- after the hardest big wall ever freed. */
function dawnWall(progress: DailyProgress): boolean {
  const words = progress.acceptedWords;
  return climber(progress) && words[words.length - 1].rarity === "Legend";
}

/**
 * The lowest score `tier` starts at on `date`'s scale, found by walking the
 * Zipf scale down until a word would be that tier. Cached per date.
 */
const floorCache = new Map<string, number>();
function tierFloorScore(tier: Rarity, date: string): number {
  const key = `${tier}|${date}`;
  const cached = floorCache.get(key);
  if (cached !== undefined) return cached;
  const reaches = atLeast(tier);
  let floor = 10;
  for (let zipf = 8; zipf >= -2; zipf -= 0.01) {
    if (reaches(rarityForZipf(zipf, date))) {
      floor = rarityScore(zipf, date);
      break;
    }
  }
  floorCache.set(key, floor);
  return floor;
}

/**
 * `days` days in a row played on their own day whose best words average a
 * `tier` score or better. A day's best is its best word across both modes.
 */
function averageOf(days: number, tier: Rarity): Achievement["check"] {
  return (record) => {
    const window: { date: string; score: number; floor: number }[] = [];
    let best = 0;
    for (const [date, puzzles] of onItsDayPuzzles(record)) {
      const last = window[window.length - 1];
      if (last && addDays(last.date, 1) !== date) window.length = 0;
      const score = Math.max(
        0,
        ...puzzles.map((p) => {
          const word = bestScored(p);
          return word ? scoreOf(word, date) : 0;
        })
      );
      window.push({ date, score, floor: tierFloorScore(tier, date) });
      if (window.length > days) window.shift();
      best = Math.max(best, window.length);
      if (window.length < days) continue;
      const sum = (pick: (d: (typeof window)[number]) => number) =>
        window.reduce((total, d) => total + pick(d), 0);
      if (sum((d) => d.score) >= sum((d) => d.floor)) return { earnedOn: date };
    }
    return { earnedOn: null, progress: { current: Math.min(best, days - 1), target: days } };
  };
}

/** Two Mythic or better words in one puzzle, one starting with the drop, one ending with it. */
function bookends(progress: DailyProgress): boolean {
  const drop = (progress.drop || dropForDate(progress.date)).toLowerCase();
  const mythic = progress.acceptedWords.filter((word) =>
    atLeast("Mythic")(word.rarity)
  );
  return mythic.some(
    (start) =>
      start.word.toLowerCase().startsWith(drop) &&
      mythic.some((end) => end !== start && end.word.toLowerCase().endsWith(drop))
  );
}

/** A `tier` or better word in the puzzles of `target` different days of the week. */
function tourOf(target: number, tier: Rarity = "Legend"): Achievement["check"] {
  return ({ history }) => {
    const days = new Set<number>();
    for (const progress of history) {
      if (!hasTier(tier)(progress)) continue;
      days.add(dayOfWeek(progress.date));
      if (days.size >= target) return { earnedOn: progress.date };
    }
    return { earnedOn: null, progress: { current: days.size, target } };
  };
}

/** Two puzzles `passes` is true of, on different days less than `days` apart. */
function twiceWithin(
  days: number,
  passes: (progress: DailyProgress) => boolean
): Achievement["check"] {
  return ({ history }) => {
    let last: string | null = null;
    for (const progress of history) {
      if (!passes(progress)) continue;
      if (last && last !== progress.date && addDays(last, days) > progress.date) {
        return { earnedOn: progress.date };
      }
      last = progress.date;
    }
    return { earnedOn: null };
  };
}

/** A word starting with the drop, Mythic or better. */
function headStart(progress: DailyProgress): boolean {
  const drop = (progress.drop || dropForDate(progress.date)).toLowerCase();
  return progress.acceptedWords.some(
    (word) => word.word.toLowerCase().startsWith(drop) && atLeast("Mythic")(word.rarity)
  );
}

/** Three words sharing one tier, Elusive or better. */
function threeOfAKind(progress: DailyProgress): boolean {
  return (["Elusive", "Mythic", "Legend"] as const).some(
    (tier) => progress.acceptedWords.filter((word) => word.rarity === tier).length >= 3
  );
}

/**
 * The words of one puzzle, lowercased. A word with no spelling -- the rates
 * script's stand-in for one the board did not keep -- is left out.
 */
function wordsOf(progress: DailyProgress): string[] {
  return progress.acceptedWords.flatMap((word) => word.word.toLowerCase() || []);
}

/** The first puzzle with a word that passes `test`. */
function anyWord(test: (word: string, progress: DailyProgress) => boolean): Achievement["check"] {
  return firstPuzzle((progress) => wordsOf(progress).some((word) => test(word, progress)));
}

/** Every guess spent, the words taken together passing `test`. */
function finishedWith(test: (words: string[]) => boolean): Achievement["check"] {
  return firstPuzzle(
    (progress) =>
      progress.completed &&
      wordsOf(progress).length >= maxGuessesFor(progress.date) &&
      test(wordsOf(progress))
  );
}

/** Each word after the first passing `test` against the one before it. */
function eachAfter(test: (before: string, word: string) => boolean) {
  return (words: string[]) => words.every((word, i) => i === 0 || test(words[i - 1], word));
}

/** `target` different letters seen, over every word banked, `lettersOf` each. */
function lettersSeen(target: number, lettersOf: (word: string) => string): Achievement["check"] {
  return ({ history }) => {
    const seen = new Set<string>();
    for (const progress of history) {
      for (const word of wordsOf(progress)) {
        for (const letter of lettersOf(word)) if (/[a-z]/.test(letter)) seen.add(letter);
      }
      if (seen.size >= target) return { earnedOn: progress.date };
    }
    return { earnedOn: null, progress: { current: seen.size, target } };
  };
}

/** Played on its own day on a day of the week in `days`, every one of them. */
function onItsDayOfWeek(days: readonly number[]): Achievement["check"] {
  return ({ onItsDay }) => {
    const seen = new Set<number>();
    for (const date of [...onItsDay].sort()) {
      if (days.includes(dayOfWeek(date))) seen.add(dayOfWeek(date));
      if (seen.size === days.length) return { earnedOn: date };
    }
    return { earnedOn: null, progress: { current: seen.size, target: days.length } };
  };
}

/** A Saturday and the Sunday after it, both played on their own day. */
function wholeWeekend({ onItsDay }: AchievementRecord): Check {
  const played = new Set(onItsDay);
  const sunday = [...played]
    .sort()
    .find((date) => dayOfWeek(date) === 0 && played.has(addDays(date, -1)));
  return { earnedOn: sunday ?? null };
}

/** The same word banked on two different days. */
function sameWordTwice({ history }: AchievementRecord): Check {
  const firstOn = new Map<string, string>();
  for (const progress of history) {
    for (const word of wordsOf(progress)) {
      const first = firstOn.get(word);
      if (first && first !== progress.date) return { earnedOn: progress.date };
      if (!first) firstOn.set(word, progress.date);
    }
  }
  return { earnedOn: null };
}

/** Two words in one puzzle made of the same letters (a puzzle never banks one word twice). */
function hasAnagrams(progress: DailyProgress): boolean {
  const keys = wordsOf(progress).map((word) => [...word].sort().join(""));
  return new Set(keys).size < keys.length;
}

/** The drop found twice in one word. */
function dropTwice(word: string, progress: DailyProgress): boolean {
  const drop = (progress.drop || dropForDate(progress.date)).toLowerCase();
  return word.indexOf(drop) !== word.lastIndexOf(drop);
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first-word",
    group: "Getting started",
    icon: "✒️",
    title: "First ink",
    description: "Bank your first word.",
    check: firstPuzzle((progress) => progress.acceptedWords.length > 0),
  },
  {
    id: "first-win",
    group: "Getting started",
    icon: "🎯",
    title: "On the board",
    description: "Find a Rare or better word.",
    check: firstWord(isWinningRarity),
  },
  {
    id: "days-10",
    group: "Getting started",
    icon: "📅",
    title: "Regular",
    description: "Play on 10 different days.",
    check: daysPlayed(10),
    byPlaying: "days",
  },
  {
    id: "days-50",
    group: "Getting started",
    icon: "🗓️",
    title: "Devotee",
    description: "Play on 50 different days.",
    check: daysPlayed(50),
    byPlaying: "days",
  },
  {
    id: "days-100",
    group: "Getting started",
    icon: "🏛️",
    title: "Fixture",
    description: "Play on 100 different days.",
    check: daysPlayed(100),
    byPlaying: "days",
  },
  {
    id: "days-365",
    group: "Getting started",
    icon: "📔",
    title: "Almanac",
    description: "Play on 365 different days.",
    check: daysPlayed(365),
    byPlaying: "days",
  },
  {
    id: "archive-play",
    group: "Getting started",
    icon: "🕰️",
    title: "Time traveller",
    description: "Play a past puzzle from the archive.",
    check: fromTheArchive,
  },
  {
    id: "first-extremely-rare",
    group: "Rarity",
    icon: "🔍",
    title: "Sharp eye",
    description: "Find an Extremely Rare word.",
    check: firstWord((rarity) => rarity === "Extremely Rare"),
  },
  {
    id: "first-elusive",
    group: "Rarity",
    icon: "🪙",
    title: "Gold strike",
    description: "Find an Elusive word.",
    check: firstWord((rarity) => rarity === "Elusive"),
  },
  {
    id: "first-mythic",
    group: "Rarity",
    icon: "🐉",
    title: "Myth maker",
    description: "Find a Mythic word.",
    check: firstWord((rarity) => rarity === "Mythic"),
  },
  {
    id: "first-legend",
    group: "Rarity",
    icon: "👑",
    title: "Living legend",
    description: "Find a Legend.",
    check: firstWord((rarity) => rarity === "Legend"),
  },
  {
    id: "double-mythic",
    group: "Rarity",
    icon: "🔱",
    title: "Double myth",
    description: "Find two Mythic or better words in one puzzle.",
    check: firstPuzzle((progress) => countOf(MYTHIC_OR_BETTER)(progress) >= 2),
  },
  {
    id: "double-legend",
    group: "Rarity",
    icon: "⚡",
    title: "Lightning twice",
    description: "Find two Legends in one puzzle.",
    check: firstPuzzle((progress) => countOf(["Legend"])(progress) >= 2),
  },
  {
    id: "full-spectrum",
    group: "Rarity",
    icon: "🌈",
    title: "Full spectrum",
    description: "Find a word in every tier, Common to Legend.",
    check: fullSpectrum,
  },
  {
    id: "pantheon",
    group: "Rarity",
    icon: "🌌",
    title: "Pantheon",
    description: "Finish a puzzle with every guess Mythic or better.",
    check: firstPuzzle(everyGuess((rarity) => MYTHIC_OR_BETTER.includes(rarity))),
  },
  {
    id: "perfect-ink",
    group: "Rarity",
    icon: "💎",
    title: "Perfect ink",
    description: "Finish with every guess Mythic or better, no guess turned away and no retry.",
    check: firstPuzzle(
      (progress) =>
        everyGuess((rarity) => MYTHIC_OR_BETTER.includes(rarity))(progress) &&
        flawless(progress) &&
        !progress.retryUsed
    ),
  },
  {
    id: "three-of-a-kind",
    group: "Rarity",
    icon: "🎲",
    title: "Three of a kind",
    description: "Find three words of the same tier in one puzzle, Elusive or better.",
    check: firstPuzzle(threeOfAKind),
  },
  {
    // Shipped as Royal flush; the id stays so a badge already kept keeps its name.
    id: "royal-flush",
    group: "Rarity",
    icon: "🃏",
    title: "Four of a kind",
    description: "Finish a puzzle with every guess a Legend.",
    check: firstPuzzle(everyGuess((rarity) => rarity === "Legend")),
  },
  {
    id: "top-four",
    group: "Rarity",
    icon: "♠️",
    title: "Royal flush",
    description: "Find a Legend, a Mythic, an Elusive and an Extremely Rare word in one puzzle.",
    check: firstPuzzle((progress) =>
      ROYAL_FLUSH.every((tier) => progress.acceptedWords.some((word) => word.rarity === tier))
    ),
  },
  {
    id: "halfway-tour",
    group: "Rarity",
    icon: "🧭",
    title: "Halfway tour",
    description: "Find a Mythic or better word on 4 different days of the week.",
    check: tourOf(4, "Mythic"),
  },
  {
    id: "grand-tour",
    group: "Rarity",
    icon: "🗺️",
    title: "Grand tour",
    description: "Find a Legend in a Monday's puzzle, a Tuesday's, and every day's through Sunday.",
    check: tourOf(7),
  },
  {
    id: "word-of-the-day",
    group: "Rarity",
    icon: "🏅",
    title: "Word of the day",
    description: "Find the day's best word.",
    // The tally says how many days, not which, so the day it is first seen.
    check: ({ bestWordWins = 0 }, today) => ({ earnedOn: bestWordWins > 0 ? today : null }),
  },
  {
    id: "streak-3",
    group: "Streaks",
    icon: "🎩",
    title: "Hat trick",
    description: "Reach a 3 day streak.",
    check: streakOf(3),
    byPlaying: "streak",
  },
  {
    id: "streak-7",
    group: "Streaks",
    icon: "🔥",
    title: "One week",
    description: "Reach a 7 day streak.",
    check: streakOf(7),
    byPlaying: "streak",
  },
  {
    id: "streak-30",
    group: "Streaks",
    icon: "🌕",
    title: "One month",
    description: "Reach a 30 day streak.",
    check: streakOf(30),
    byPlaying: "streak",
  },
  {
    id: "streak-100",
    group: "Streaks",
    icon: "💯",
    title: "Centurion",
    description: "Reach a 100 day streak.",
    check: streakOf(100),
    byPlaying: "streak",
  },
  {
    id: "streak-365",
    group: "Streaks",
    icon: "🏆",
    title: "Year of ink",
    description: "Reach a 365 day streak.",
    check: streakOf(365),
    byPlaying: "streak",
  },
  {
    id: "perfect-month",
    group: "Streaks",
    icon: "🗝️",
    title: "Perfect month",
    description: "Play every day of a calendar month on its own day.",
    check: perfectMonth,
  },
  {
    id: "extremely-rare-week",
    group: "Streaks",
    icon: "🔎",
    title: "Keen week",
    description: "Find an Extremely Rare or better word 7 days in a row.",
    check: runOf(7, hasTier("Extremely Rare")),
  },
  {
    id: "elusive-trio",
    group: "Streaks",
    icon: "🥉",
    title: "Golden trio",
    description: "Find an Elusive or better word 3 days in a row.",
    check: runOf(3, hasTier("Elusive")),
  },
  {
    id: "elusive-week",
    group: "Streaks",
    icon: "🥇",
    title: "Golden week",
    description: "Find an Elusive or better word 7 days in a row.",
    check: runOf(7, hasTier("Elusive")),
  },
  {
    id: "mythic-pair",
    group: "Streaks",
    icon: "🪄",
    title: "Mythic pair",
    description: "Find a Mythic or better word 2 days in a row.",
    check: runOf(2, hasTier("Mythic")),
  },
  {
    id: "mythic-week",
    group: "Streaks",
    icon: "🐲",
    title: "Mythic week",
    description: "Find a Mythic or better word 7 days in a row.",
    check: runOf(7, hasTier("Mythic")),
  },
  {
    id: "legend-week",
    group: "Streaks",
    icon: "✌️",
    title: "Twice in a week",
    description: "Find a Legend on 2 days within a week.",
    check: twiceWithin(7, hasTier("Legend")),
  },
  {
    id: "legend-streak",
    group: "Streaks",
    icon: "🌠",
    title: "Legend streak",
    description: "Find a Legend 5 days in a row.",
    check: runOf(5, hasTier("Legend")),
  },
  {
    id: "double-sweep",
    group: "Streaks",
    icon: "🧺",
    title: "Double sweep",
    description: "Finish with every guess Rare or better 2 days in a row.",
    check: runOf(2, everyGuess(isWinningRarity)),
  },
  {
    id: "sweep-week",
    group: "Streaks",
    icon: "🧽",
    title: "Sweep week",
    description: "Finish with every guess Rare or better 7 days in a row.",
    check: runOf(7, everyGuess(isWinningRarity)),
  },
  {
    id: "steady-hand",
    group: "Streaks",
    icon: "✋",
    title: "Steady hand",
    description: "Finish 2 days in a row without a guess turned away.",
    check: runOf(2, flawless),
  },
  {
    id: "ironclad",
    group: "Streaks",
    icon: "🛡️",
    title: "Ironclad",
    description: "Finish 7 days in a row without a guess turned away.",
    check: runOf(7, flawless),
  },
  {
    id: "honor-roll",
    group: "Streaks",
    icon: "🎖️",
    title: "Honor roll",
    description: "Average an Extremely Rare score or better with your best word over 5 days in a row.",
    check: averageOf(5, "Extremely Rare"),
  },
  {
    id: "elusive-average",
    group: "Streaks",
    icon: "🎓",
    title: "Master's average",
    description: "Average an Elusive score or better with your best word over 10 days in a row.",
    check: averageOf(10, "Elusive"),
  },
  {
    id: "mythic-10",
    group: "Collections",
    icon: "✨",
    title: "Rare air",
    description: "Find 10 Mythic or better words.",
    check: countTo(10, countOf(MYTHIC_OR_BETTER)),
  },
  {
    id: "mythic-50",
    group: "Collections",
    icon: "📜",
    title: "Lexicon hunter",
    description: "Find 50 Mythic or better words.",
    check: countTo(50, countOf(MYTHIC_OR_BETTER)),
  },
  {
    id: "mythic-100",
    group: "Collections",
    icon: "🏺",
    title: "Hall of myths",
    description: "Find 100 Mythic or better words.",
    check: countTo(100, countOf(MYTHIC_OR_BETTER)),
  },
  {
    id: "legend-10",
    group: "Collections",
    icon: "🌟",
    title: "Legendarium",
    description: "Find 10 Legends.",
    check: countTo(10, countOf(["Legend"])),
  },
  {
    id: "words-100",
    group: "Collections",
    icon: "📚",
    title: "Hundred words",
    description: "Bank 100 words.",
    check: countTo(100, (progress) => progress.acceptedWords.length),
    byPlaying: "words",
  },
  {
    id: "words-500",
    group: "Collections",
    icon: "🗃️",
    title: "Five hundred words",
    description: "Bank 500 words.",
    check: countTo(500, (progress) => progress.acceptedWords.length),
    byPlaying: "words",
  },
  {
    id: "words-1000",
    group: "Collections",
    icon: "🏰",
    title: "Thousand words",
    description: "Bank 1,000 words.",
    check: countTo(1000, (progress) => progress.acceptedWords.length),
    byPlaying: "words",
  },
  {
    id: "clean-sweep",
    group: "Style",
    icon: "🧹",
    title: "Clean sweep",
    description: "Finish a puzzle with every guess Rare or better.",
    check: firstPuzzle(everyGuess(isWinningRarity)),
  },
  {
    id: "straight-in",
    group: "Style",
    icon: "🏹",
    title: "Straight in",
    description: "Make the first word of a puzzle Rare or better.",
    check: firstPuzzle(
      (progress) =>
        progress.acceptedWords.length > 0 && isWinningRarity(progress.acceptedWords[0].rarity)
    ),
  },
  {
    id: "clean-copy",
    group: "Style",
    icon: "📝",
    title: "Clean copy",
    description: "Finish a puzzle with a Rare or better word and no guess turned away.",
    check: firstPuzzle(cleanCopy),
  },
  {
    id: "down-to-the-wire",
    group: "Style",
    icon: "⏱️",
    title: "Down to the wire",
    description: "Find a Rare or better word with your last guess, after every other fell short.",
    check: firstPuzzle(downToTheWire),
  },
  {
    id: "second-chance",
    group: "Style",
    icon: "🔁",
    title: "Second chance",
    description: "Spend a puzzle's retry and still find a Rare or better word.",
    check: firstPuzzle(secondChance),
  },
  {
    id: "sesquipedalian",
    group: "Style",
    icon: "📏",
    title: "Sesquipedalian",
    description: `Bank a word of ${LONG_WORD} letters or more, as long as "sesquipedalian".`,
    check: firstPuzzle((progress) => progress.acceptedWords.some((w) => w.word.length >= LONG_WORD)),
  },
  {
    id: "both-ways",
    group: "Style",
    icon: "🔀",
    title: "Both ways",
    description: "Find a Rare or better word in the same puzzle in Standard and Freeform.",
    check: bothWays,
  },
  {
    id: "no-misses",
    group: "Style",
    icon: "✅",
    title: "No misses",
    description: "Finish a puzzle with every guess Extremely Rare or better.",
    check: firstPuzzle(everyGuess(atLeast("Extremely Rare"))),
  },
  {
    id: "gauntlet",
    group: "Style",
    icon: "⚔️",
    title: "Gauntlet",
    description: "Finish with every guess Elusive or better and no guess turned away.",
    check: firstPuzzle(
      (progress) => everyGuess(atLeast("Elusive"))(progress) && flawless(progress)
    ),
  },
  {
    id: "climber",
    group: "Style",
    icon: "🧗",
    title: "Climber",
    description: "Score higher with every guess than the one before.",
    check: firstPuzzle(climber),
  },
  {
    id: "dawn-wall",
    group: "Style",
    icon: "🏔️",
    title: "The Dawn Wall",
    description: "Score higher with every guess than the one before, ending on a Legend.",
    check: firstPuzzle(dawnWall),
  },
  {
    id: "rappel",
    group: "Style",
    icon: "🪢",
    title: "Rappel",
    description: "Score lower with every guess than the one before.",
    check: firstPuzzle(eachGuess(false)),
  },
  {
    id: "double-sesquipedalian",
    group: "Style",
    icon: "📐",
    title: "Double sesquipedalian",
    description: `Bank two words of ${LONG_WORD} letters or more in one puzzle.`,
    check: firstPuzzle(
      (progress) => progress.acceptedWords.filter((w) => w.word.length >= LONG_WORD).length >= 2
    ),
  },
  {
    id: "small-but-mighty",
    group: "Style",
    icon: "🐜",
    title: "Small but mighty",
    description: "Find a Mythic or better word of 6 letters or fewer.",
    check: firstPuzzle((progress) =>
      progress.acceptedWords.some(
        (word) => word.word.length <= 6 && atLeast("Mythic")(word.rarity)
      )
    ),
  },
  {
    id: "head-start",
    group: "Style",
    icon: "🏁",
    title: "Head start",
    description: "Find a Mythic or better word that starts with the drop.",
    check: firstPuzzle(headStart),
  },
  {
    id: "bookends",
    group: "Style",
    icon: "🔖",
    title: "Bookends",
    description: "Find a Mythic or better word that starts with the drop and one that ends with it, in one puzzle.",
    check: firstPuzzle(bookends),
  },
  {
    id: "alphabet-10",
    group: "Collections",
    icon: "🥣",
    title: "Alphabet soup",
    description: "Bank words starting with 10 different letters.",
    check: lettersSeen(10, (word) => word.slice(0, 1)),
  },
  {
    id: "alphabet-13",
    group: "Collections",
    icon: "🐦",
    title: "Sesame Street",
    description: "Bank words starting with 13 different letters, half the alphabet.",
    check: lettersSeen(13, (word) => word.slice(0, 1)),
  },
  {
    id: "alphabet-26",
    group: "Collections",
    icon: "🔠",
    title: "A to Z",
    description: "Bank words starting with every letter of the alphabet.",
    check: lettersSeen(26, (word) => word.slice(0, 1)),
  },
  {
    id: "pangram",
    group: "Collections",
    icon: "🦊",
    title: "The quick brown fox",
    description: "Use every letter of the alphabet across the words you bank.",
    check: lettersSeen(26, (word) => word),
  },
  {
    id: "triple-letter",
    group: "Style",
    icon: "📺",
    title: "Three's Company",
    description: "Bank a word with one letter in it three times.",
    check: anyWord((word) => /(.).*\1.*\1/.test(word)),
  },
  {
    id: "short-king",
    group: "Style",
    icon: "🤴",
    title: "Short King",
    description: "Bank a word of 4 letters or fewer.",
    check: anyWord((word) => word.length <= 4),
  },
  {
    id: "x-word",
    group: "Style",
    icon: "❌",
    title: "X marks the spot",
    description: "Bank a word with an X.",
    check: anyWord((word) => word.includes("x")),
  },
  {
    id: "old-macdonald",
    group: "Style",
    icon: "🐄",
    title: "Old MacDonald",
    description: "Bank a word with E, I and O in that order. E-I-E-I-O!",
    check: anyWord((word) => /e.*i.*o/.test(word)),
  },
  {
    id: "double-dip",
    group: "Style",
    icon: "🥔",
    title: "Double dip",
    description: "Bank a word with the drop in it twice.",
    check: anyWord(dropTwice),
  },
  {
    id: "the-ick",
    group: "Style",
    icon: "🤢",
    title: "The Ick",
    description: "Bank a word with ICK in it.",
    check: anyWord((word) => word.includes("ick")),
  },
  {
    id: "cats-and-dogs",
    group: "Style",
    icon: "🐈",
    title: "Cats & Dogs",
    description: "Bank a word with CAT or DOG in it.",
    check: anyWord((word) => /cat|dog/.test(word)),
  },
  {
    id: "tenet",
    group: "Style",
    icon: "⏪",
    title: "Tenet",
    description: "Bank a palindrome, a word that reads the same backwards.",
    check: anyWord((word) => word.length >= 3 && word === [...word].reverse().join("")),
  },
  {
    id: "rhythm-nation",
    group: "Style",
    icon: "🥁",
    title: "Rhythm Nation",
    description: "Bank a word with no A, E, I, O or U.",
    check: anyWord((word) => !/[aeiou]/.test(word)),
  },
  {
    id: "q-without-u",
    group: "Style",
    icon: "🦆",
    title: "Q without U",
    description: "Bank a word with a Q that isn't followed by a U.",
    check: anyWord((word) => /q(?!u)/.test(word)),
  },
  {
    id: "peter-piper",
    group: "Style",
    icon: "🌶️",
    title: "Peter Piper",
    description: "Finish a puzzle with every word starting with the same letter.",
    check: finishedWith((words) => new Set(words.map((word) => word.slice(0, 1))).size === 1),
  },
  {
    id: "abcs",
    group: "Style",
    icon: "🔤",
    title: "Now I know my ABCs",
    description: "Finish a puzzle with your words in alphabetical order.",
    check: finishedWith(eachAfter((before, word) => before < word)),
  },
  {
    id: "chain-gang",
    group: "Style",
    icon: "⛓️",
    title: "Chain Gang",
    description: "Finish a puzzle with each word starting on the last letter of the one before.",
    check: finishedWith(eachAfter((before, word) => before.slice(-1) === word.slice(0, 1))),
  },
  {
    id: "honey-i-blew-up-the-kid",
    group: "Style",
    icon: "🎈",
    title: "Honey, I Blew Up the Kid",
    description: "Finish a puzzle with each word longer than the one before.",
    check: finishedWith(eachAfter((before, word) => word.length > before.length)),
  },
  {
    id: "voldemort",
    group: "Style",
    icon: "🧙",
    title: "I am Lord Voldemort",
    description: "Bank two words made of the same letters in one puzzle.",
    check: firstPuzzle(hasAnagrams),
  },
  {
    id: "basic",
    group: "Style",
    icon: "🍔",
    title: "Basic",
    description: "Finish a puzzle with every guess Common.",
    check: firstPuzzle(everyGuess((rarity) => rarity === "Common")),
  },
  {
    id: "groundhog-day",
    group: "Collections",
    icon: "🦫",
    title: "Groundhog Day",
    description: "Bank the same word on two different days.",
    check: sameWordTwice,
  },
  {
    id: "weekend-at-bernies",
    group: "Streaks",
    icon: "🕶️",
    title: "Weekend at Bernie's",
    description: "Play a Saturday and the Sunday after it, each on its own day.",
    check: wholeWeekend,
  },
  {
    id: "eight-days-a-week",
    group: "Getting started",
    icon: "🎸",
    title: "Eight Days a Week",
    description: "Play on every day of the week, each puzzle on its own day.",
    check: onItsDayOfWeek([0, 1, 2, 3, 4, 5, 6]),
  },
  {
    id: "word-suggested",
    group: "Word scouting",
    icon: "💡",
    title: "Word scout",
    description: "Suggest a word for the dictionary.",
    check: firstSuggestion((s) => s.suggestedOn),
    viaSuggestions: true,
  },
  {
    id: "suggestion-accepted",
    group: "Word scouting",
    icon: "📖",
    title: "In the dictionary",
    description: "Have a word you suggested accepted, so everybody can play it.",
    check: firstSuggestion((s) => s.acceptedOn),
    viaSuggestions: true,
  },
];

/** How many players have ever guessed, and how many of them hold each badge. */
export interface AchievementRates {
  players: number;
  earned: Record<string, number>;
  /** The handle of the one player holding a badge, for each badge only one holds. */
  sole?: Record<string, string>;
}

/** The bundled counts, from scripts/achievement-rates.mts. */
const snapshot: AchievementRates = achievementRates;

/** The live counts from /api/achievements, once this session has them. */
let liveRates: AchievementRates | null = null;
let ratesRequest: Promise<AchievementRates | null> | null = null;

function isRates(body: unknown): body is AchievementRates {
  if (!body || typeof body !== "object") return false;
  const { players, earned } = body as Partial<AchievementRates>;
  return typeof players === "number" && Boolean(earned) && typeof earned === "object";
}

/**
 * Ask the server how many players hold each badge, once a session (a failed
 * ask is tried again by the next caller). Never needed: until it answers, and
 * if it never does, the bundled snapshot stands in.
 */
export function fetchAchievementRates(): Promise<AchievementRates | null> {
  ratesRequest ??= fetch("/api/achievements")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      if (!isRates(body)) throw new Error("no rates");
      liveRates = body;
      return liveRates;
    })
    .catch(() => {
      ratesRequest = null;
      return null;
    });
  return ratesRequest;
}

/** For tests: forget the live counts. */
export function resetAchievementRates(live: AchievementRates | null = null): void {
  liveRates = live;
  ratesRequest = null;
}

/**
 * The counts to show: the live ones, never below the bundled snapshot.
 *
 * A badge is kept for good, so a count only ever grows, and the snapshot
 * (scripts/achievement-rates.mts) is a floor under it. That keeps the share
 * right for the players the server has not heard from -- everyone before the
 * game sent its badges, until the backfill, and anyone who never updates.
 */
function ratesNow(): AchievementRates {
  const live = liveRates;
  if (!live) return snapshot;
  const earned = { ...snapshot.earned };
  for (const [id, count] of Object.entries(live.earned)) {
    earned[id] = Math.max(earned[id] ?? 0, Number(count) || 0);
  }
  return { players: Math.max(live.players, snapshot.players), earned, sole: { ...snapshot.sole, ...live.sole } };
}

/** How many players hold `id`, by the counts shown: 0 for one never counted. */
export function holdersOf(id: string): number {
  return ratesNow().earned[id] ?? 0;
}

/**
 * The one player holding `id`, when only one does and the counts name them:
 * `self` when that is this browser.
 */
export function soleHolder(
  id: string,
  rates: AchievementRates = ratesNow()
): { name: string; self: boolean } | null {
  const name = rates.earned[id] === 1 ? rates.sole?.[id] : undefined;
  return name ? { name, self: name === ownHandle() } : null;
}

/** This browser's handle on the board, if it has joined. */
function ownHandle(): string | null {
  const playerId = loadPlayerId();
  return playerId ? handleFor(playerId) : null;
}

/** The percentage of players who have ever guessed that hold `id`, if counted. */
function shareOf(id: string, rates: AchievementRates): number | null {
  const count = rates.earned[id];
  if (count === undefined || rates.players === 0) return null;
  return (100 * count) / rates.players;
}

/** "4.3%" under ten, "46%" above: a tenth matters only where the share is small. */
function formatShare(share: number): string {
  return `${share < 10 ? share.toFixed(1).replace(/\.0$/, "") : Math.round(share)}%`;
}

/**
 * How many of the players who have ever guessed hold `id`, as the Stats page
 * shows under each badge: "46% of players", or for a badge only one player
 * holds, their name -- "Only earned by StormyFox47" -- or "Only earned by you!" to that player. Null for a badge nobody has
 * counted yet.
 */
export function earnedShareLabel(id: string, rates: AchievementRates = ratesNow()): string | null {
  const holder = soleHolder(id, rates);
  if (holder) return holder.self ? "Only earned by you!" : `Only earned by ${holder.name}`;
  const share = shareOf(id, rates);
  if (share === null) return null;
  if (share === 0) return "No player yet";
  if (share < 1) return "Under 1% of players";
  return `${formatShare(share)} of players`;
}

/**
 * Whether nobody else held `id` when this session asked. Only the live count
 * can say so: the snapshot is a day's guess, and a zero there may be stale.
 * Read when the badge is earned, before this player's own report is counted --
 * the counts are fetched as the page opens.
 */
export function firstToEarn(id: string): boolean {
  return liveRates !== null && !ratesNow().earned[id];
}

/** Below this share a badge is rare enough to say "only". */
const ONLY_BELOW = 10;

/**
 * Badges for days played, where a small share says how new the game is rather
 * than how hard the badge is: "only 8% of players" have played ten days when
 * most players started last month.
 */
const NO_ONLY = new Set(["days-10", "days-50", "days-100", "days-365"]);

/**
 * The line under a lone badge on the card that celebrates it (see
 * components/AchievementCelebration.tsx): the first to earn it, or how many
 * players have -- "Earned by 23% of players.", and "Earned by only 4.3% of
 * players." for a rare one. Null when there is nothing worth saying.
 */
export function celebrationShareLine(id: string, rates: AchievementRates = ratesNow()): string | null {
  if (firstToEarn(id)) return "You're the first player to earn it!";
  const share = shareOf(id, rates);
  if (!share) return null;
  if (share < 1) return "Earned by fewer than 1% of players.";
  const only = share < ONLY_BELOW && !NO_ONLY.has(id) ? "only " : "";
  return `Earned by ${only}${formatShare(share)} of players.`;
}

/**
 * The badges this device's record earns as the shares count them,
 * `{ id: earnedOn }` -- sent with every score (see game/leaderboard.ts) so the
 * server can count them. Worked out from `countedRecord`, not read from the kept
 * badges: a badge held only through an unattested Legend stays the player's,
 * and stays out of the count. Empty when the record cannot be read: a count is
 * never worth a failed post.
 */
export function countedAchievements(): Record<string, string> {
  try {
    const record = countedRecord(deviceRecord(loadStreak()));
    return Object.fromEntries(
      achievementStatuses(record, {}, todayDateString()).flatMap(({ achievement, earnedOn }) =>
        earnedOn ? [[achievement.id, earnedOn]] : []
      )
    );
  } catch {
    return {};
  }
}

const EARNED_KEY = "ick:achievements";

function readEarned(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EARNED_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeEarned(earned: Record<string, string>): void {
  try {
    localStorage.setItem(EARNED_KEY, JSON.stringify(earned));
  } catch {
    // Unwritable storage only means the badges are worked out again next time.
  }
}

/**
 * Where every achievement stands for `record`, given the ones already kept.
 * Pure: `syncAchievements` is what reads and writes the kept ones.
 */
export function achievementStatuses(
  record: AchievementRecord,
  kept: Readonly<Record<string, string>>,
  today: string
): AchievementStatus[] {
  return ACHIEVEMENTS.filter(
    (achievement) => !achievement.viaSuggestions || takesPlayerMessages()
  ).map((achievement) => {
    const keptOn = kept[achievement.id];
    if (keptOn) return { achievement, earnedOn: keptOn };
    const { earnedOn, progress } = achievement.check(record, today);
    return earnedOn ? { achievement, earnedOn } : { achievement, earnedOn: null, progress };
  });
}

/** This browser's record, as the achievements read it. */
function deviceRecord(streak: StreakState): AchievementRecord {
  return {
    history: playedHistory(),
    onItsDay: playedOnItsDay().map((progress) => progress.date),
    streak,
    suggestions: suggestedWords(),
    bestWordWins: readBestWordWins(),
  };
}

const BEST_WORD_KEY = "ick:best-word-wins";

function readBestWordWins(): number {
  try {
    return Number(localStorage.getItem(BEST_WORD_KEY)) || 0;
  } catch {
    return 0;
  }
}

let bestWordRequest: Promise<number> | null = null;

/**
 * Ask the server how many days this player had the best word, once a session,
 * and keep the count for `syncAchievements`. The same tally the line under the
 * puzzle settles its ties with (see `fetchBestWordWins` in game/leaderboard.ts),
 * shared by every reader through the CDN. Never needed: a failed ask leaves the
 * last count, and the badge, where they were.
 */
export function fetchWordOfTheDayWins(): Promise<number> {
  const playerId = loadPlayerId()?.toLowerCase();
  if (!playerId) return Promise.resolve(readBestWordWins());
  bestWordRequest ??= fetch(
    `/api/leaderboard?bestWins=1&today=${encodeURIComponent(todayDateString())}`
  )
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const wins = (body as { wins?: Record<string, unknown> } | null)?.wins;
      if (!wins || typeof wins !== "object") throw new Error("no wins");
      const count = Number(wins[playerId]) || 0;
      try {
        localStorage.setItem(BEST_WORD_KEY, String(count));
      } catch {
        // Unwritable storage only means asking again next session.
      }
      return count;
    })
    .catch(() => {
      bestWordRequest = null;
      return readBestWordWins();
    });
  return bestWordRequest;
}

/** This browser's achievements, keeping any newly earned for good. */
export function syncAchievements(streak: StreakState): AchievementStatus[] {
  const record = deviceRecord(streak);
  const kept = readEarned();
  const statuses = achievementStatuses(record, kept, todayDateString());
  const earned = Object.fromEntries(
    statuses.flatMap(({ achievement, earnedOn }) => (earnedOn ? [[achievement.id, earnedOn]] : []))
  );
  if (Object.keys(earned).length !== Object.keys(kept).length) writeEarned({ ...kept, ...earned });
  return statuses;
}

/** The ids of the achievements earned in `statuses`. */
export function earnedIds(statuses: readonly AchievementStatus[]): Set<string> {
  return new Set(statuses.flatMap(({ achievement, earnedOn }) => (earnedOn ? [achievement.id] : [])));
}

/**
 * The achievements in `statuses` earned since `before` (see earnedIds), for
 * the card that celebrates them (see components/AchievementCelebration.tsx).
 * The suggestion box's two are left out: each is announced where it is earned,
 * by the box itself and by the thank-you for an accepted word.
 */
export function newlyEarned(
  before: ReadonlySet<string>,
  statuses: readonly AchievementStatus[]
): Achievement[] {
  return statuses.flatMap(({ achievement, earnedOn }) =>
    earnedOn && !before.has(achievement.id) && !achievement.viaSuggestions ? [achievement] : []
  );
}

/**
 * The badges a card has announced, per browser. The card only ever announced
 * what a submission earned, so a player with history from before achievements
 * existed -- or from before the card did -- holds badges nobody ever
 * mentioned. Those are welcomed once as the page opens (see
 * `achievementsToCatchUp`) and written here, as is every badge the card names
 * after that, so none is announced twice.
 */
const ANNOUNCED_KEY = "ick:achievements-announced";

export function announcedAchievements(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function markAchievementsAnnounced(ids: Iterable<string>): void {
  const announced = announcedAchievements();
  const before = announced.size;
  for (const id of ids) announced.add(id);
  if (announced.size === before) return;
  try {
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify([...announced]));
  } catch {
    // Unwritable storage only means the welcome may come round again.
  }
}

/** Which group leads when there are more badges to welcome than fit on a card. */
const CATCH_UP_ORDER: readonly AchievementGroup[] = [
  "Rarity",
  "Streaks",
  "Collections",
  "Style",
  "Getting started",
];

/**
 * The badges held but never announced, the most impressive first: rarity
 * ahead of streaks ahead of counts, and within a group the later (harder) one
 * first -- a Legend before a Mythic, a 100-day streak before a 7. The
 * suggestion box's badges are left out, as `newlyEarned` leaves them out.
 */
export function achievementsToCatchUp(
  announced: ReadonlySet<string>,
  statuses: readonly AchievementStatus[]
): Achievement[] {
  const rank = (achievement: Achievement) =>
    CATCH_UP_ORDER.indexOf(achievement.group) * ACHIEVEMENTS.length -
    ACHIEVEMENTS.indexOf(achievement);
  return newlyEarned(announced, statuses).sort((a, b) => rank(a) - rank(b));
}
