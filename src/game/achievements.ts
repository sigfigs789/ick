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

import { addDays, todayDateString } from "./date";
import { maxGuessesFor } from "./constants";
import { modeIsChosen } from "./mode";
import { nextMonthStart } from "./month";
import { isWinningRarity } from "./rank";
import { CURRENT_TIERS } from "./stats";
import { playedHistory, playedOnItsDay } from "./storage";
import { takesPlayerMessages } from "./playerMessages";
import { suggestedWords, type SuggestedWordRecord } from "./suggestions";
import type { DailyProgress, Rarity, StreakState } from "./types";

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
}

export interface AchievementStatus {
  achievement: Achievement;
  /** The date it was earned, or null while locked. */
  earnedOn: string | null;
  /** For a count still locked: how far along. */
  progress?: { current: number; target: number };
}

const MYTHIC_OR_BETTER: readonly Rarity[] = ["Mythic", "Legend"];

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

/** Every guess spent, each one Rare or better. */
function cleanSweep(progress: DailyProgress): boolean {
  return (
    progress.completed &&
    progress.acceptedWords.length >= maxGuessesFor(progress.date) &&
    progress.acceptedWords.every((word) => isWinningRarity(word.rarity))
  );
}

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
    if (!progress.acceptedWords.some((word) => isWinningRarity(word.rarity))) continue;
    const modes = wonBy.get(progress.date) ?? new Set();
    modes.add(progress.mode);
    wonBy.set(progress.date, modes);
    if (modes.size === 2) return { earnedOn: progress.date };
  }
  return { earnedOn: null };
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
  },
  {
    id: "days-50",
    group: "Getting started",
    icon: "🗓️",
    title: "Devotee",
    description: "Play on 50 different days.",
    check: daysPlayed(50),
  },
  {
    id: "days-100",
    group: "Getting started",
    icon: "🏛️",
    title: "Fixture",
    description: "Play on 100 different days.",
    check: daysPlayed(100),
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
    id: "streak-7",
    group: "Streaks",
    icon: "🔥",
    title: "One week",
    description: "Reach a 7 day streak.",
    check: streakOf(7),
  },
  {
    id: "streak-30",
    group: "Streaks",
    icon: "🌕",
    title: "One month",
    description: "Reach a 30 day streak.",
    check: streakOf(30),
  },
  {
    id: "streak-100",
    group: "Streaks",
    icon: "💯",
    title: "Centurion",
    description: "Reach a 100 day streak.",
    check: streakOf(100),
  },
  {
    id: "streak-365",
    group: "Streaks",
    icon: "🏆",
    title: "Year of ink",
    description: "Reach a 365 day streak.",
    check: streakOf(365),
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
    id: "words-100",
    group: "Collections",
    icon: "📚",
    title: "Hundred words",
    description: "Bank 100 words.",
    check: countTo(100, (progress) => progress.acceptedWords.length),
  },
  {
    id: "clean-sweep",
    group: "Style",
    icon: "🧹",
    title: "Clean sweep",
    description: "Finish a puzzle with every guess Rare or better.",
    check: firstPuzzle(cleanSweep),
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
    id: "both-ways",
    group: "Style",
    icon: "🔀",
    title: "Both ways",
    description: "Find a Rare or better word in the same puzzle in Standard and Freeform.",
    check: bothWays,
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

/** This browser's achievements, keeping any newly earned for good. */
export function syncAchievements(streak: StreakState): AchievementStatus[] {
  const record: AchievementRecord = {
    history: playedHistory(),
    onItsDay: playedOnItsDay().map((progress) => progress.date),
    streak,
    suggestions: suggestedWords(),
  };
  const kept = readEarned();
  const statuses = achievementStatuses(record, kept, todayDateString());
  const earned = Object.fromEntries(
    statuses.flatMap(({ achievement, earnedOn }) => (earnedOn ? [[achievement.id, earnedOn]] : []))
  );
  if (Object.keys(earned).length !== Object.keys(kept).length) writeEarned({ ...kept, ...earned });
  return statuses;
}
