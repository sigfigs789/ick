/**
 * The player's best day ever and best week ever, celebrated on the finish that
 * sets them (see components/PersonalBestCelebration.tsx and the README's
 * "Header celebrations").
 *
 * A day's score is its total (see dictionary.totalRarityScore, scored at that
 * day's own date) and a week's is the weekly board's: the best WEEK_BEST_DAYS
 * days of the week (see game/week.ts and game/totals.ts). The arithmetic is the
 * boards' so that the number on the card is one the player can find again on
 * the weekly board.
 *
 * Asked only once today's puzzle is finished, as the rising average is, because
 * that is when today's total stops moving. Only days played on their own date
 * count, and only those on today's board (see mode.countsOnBoard): Freeform
 * skips the fold and scores higher, so a Freeform afternoon is not a Standard
 * record to beat, nor one to set.
 *
 * "Ever" needs something to beat: a player's first day is not their best day
 * ever, and their first week is not their best week ever. And a record has to
 * be worth a party -- MIN_BEST_DAY and MIN_BEST_WEEK keep a beginner's slow
 * climb from throwing one every evening.
 *
 * Read from this browser's own record, like the week and month totals, so it
 * works for somebody who never joined a board.
 */

import { totalRarityScore } from "./dictionary";
import { countsOnBoard, modeForDate, type GameMode } from "./mode";
import { playedOnItsDay } from "./storage";
import type { DailyProgress } from "./types";
import { WEEK_BEST_DAYS, weekStart } from "./week";

/** The lowest day total a best day ever is celebrated at. */
export const MIN_BEST_DAY = 30;
/** The lowest week total a best week ever is celebrated at. */
export const MIN_BEST_WEEK = 120;

const WEEK_CELEBRATED_KEY = "ick:bestWeekCelebrated";

export interface PersonalBest {
  /** Which record fell. A week beats a day when both fall on one finish. */
  kind: "day" | "week";
  /** The new best, to the hundredth. */
  score: number;
  /** The best before it, to the hundredth. */
  previous: number;
}

/**
 * The record `date`'s finish set, if any: the best week ever when it set both.
 * Null when neither fell, when `date`'s puzzle is not finished on its own date,
 * or when the week's record was already celebrated this week.
 */
export function personalBestOn(
  date: string,
  mode: GameMode = modeForDate(date)
): PersonalBest | null {
  const days = playedOnItsDay().filter(
    (progress) => progress.date <= date && countsOnBoard(mode, progress.date, progress.mode)
  );
  const today = days.find((progress) => progress.date === date && progress.completed);
  if (!today) return null;
  const todayScore = totalRarityScore(today.acceptedWords, date);
  const earlier = days.filter((progress) => progress.date < date);

  const week = bestWeek(date, todayScore, earlier);
  if (week) return week;
  return bestDay(todayScore, earlier);
}

function bestDay(
  todayScore: number,
  earlier: DailyProgress[]
): PersonalBest | null {
  if (earlier.length === 0 || todayScore < MIN_BEST_DAY) return null;
  const previous = Math.max(
    ...earlier.map((progress) => totalRarityScore(progress.acceptedWords, progress.date))
  );
  return todayScore > previous ? { kind: "day", score: todayScore, previous } : null;
}

function bestWeek(
  date: string,
  todayScore: number,
  earlier: DailyProgress[]
): PersonalBest | null {
  const thisWeek = weekStart(date);
  if (weekCelebrated() === thisWeek) return null;
  const weeks = new Map<string, number[]>();
  for (const progress of earlier) {
    const start = weekStart(progress.date);
    const scores = weeks.get(start) ?? [];
    scores.push(totalRarityScore(progress.acceptedWords, progress.date));
    weeks.set(start, scores);
  }
  const before = weeks.get(thisWeek) ?? [];
  weeks.delete(thisWeek);
  if (weeks.size === 0) return null;

  const score = bestDaysTotal([...before, todayScore]);
  // Today's finish has to be what set it: a day outside the week's best four
  // moved nothing, and a record that stood before today is not today's news.
  if (score < MIN_BEST_WEEK || score <= bestDaysTotal(before)) return null;
  const previous = Math.max(...[...weeks.values()].map(bestDaysTotal));
  return score > previous ? { kind: "week", score, previous } : null;
}

/**
 * Remember that the week `date` falls in has had its record celebrated: a week
 * that keeps climbing is one party, not one every evening of it.
 */
export function markBestWeekCelebrated(date: string): void {
  try {
    localStorage.setItem(WEEK_CELEBRATED_KEY, weekStart(date));
  } catch {
    // Storage that cannot be written means a second card later that week, at worst.
  }
}

function weekCelebrated(): string | null {
  try {
    return localStorage.getItem(WEEK_CELEBRATED_KEY);
  } catch {
    return null;
  }
}

/** The best WEEK_BEST_DAYS of `scores`, summed and rounded once, as game/totals.ts does. */
function bestDaysTotal(scores: number[]): number {
  const total = [...scores]
    .sort((a, b) => b - a)
    .slice(0, WEEK_BEST_DAYS)
    .reduce((sum, score) => sum + score, 0);
  return Math.round(total * 100) / 100;
}
