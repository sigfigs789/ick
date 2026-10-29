/**
 * Milestones on the days-played board: the emoji a player's tally of days earns
 * them, worn beside the count on the board (see LeaderboardPage.tsx) and on the
 * climb card (see DaysClimbCelebration.tsx).
 *
 * Spaced to land often early and rarely late: a week, a month, fifty, then the
 * hundred -- the first players are closing on it -- and on past it to two
 * hundred and a full year, so the board still has somewhere to go once the
 * leaders are through 100.
 */

export interface DaysMilestone {
  /** The days that earn it. */
  days: number;
  emoji: string;
  /** What it is called, for a tooltip and a screen reader. */
  label: string;
}

/** Every milestone, fewest days first. */
export const DAYS_MILESTONES: readonly DaysMilestone[] = [
  { days: 7, emoji: "🌱", label: "A week played" },
  { days: 30, emoji: "🌙", label: "A month played" },
  { days: 50, emoji: "⭐", label: "50 days played" },
  { days: 100, emoji: "💯", label: "100 days played" },
  { days: 200, emoji: "💎", label: "200 days played" },
  { days: 365, emoji: "👑", label: "A year played" },
];

/** The highest milestone a tally has reached, or null below the first. */
export function daysMilestone(days: number): DaysMilestone | null {
  let reached: DaysMilestone | null = null;
  for (const milestone of DAYS_MILESTONES) {
    if (days >= milestone.days) reached = milestone;
  }
  return reached;
}

/** The milestone a tally has just reached, on the very day it lands. */
export function daysMilestoneReached(days: number): DaysMilestone | null {
  return DAYS_MILESTONES.find((milestone) => milestone.days === days) ?? null;
}
