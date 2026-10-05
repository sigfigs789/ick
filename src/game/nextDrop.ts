/**
 * What a finished puzzle says about tomorrow: when the next drop lands, and the
 * one reason to be there for it.
 *
 * Finishing is the moment a player decides whether to come back, and until now
 * the results ended at the share preview. So the panel says when the next drop
 * arrives, and picks a single line from the streak, most motivating first:
 * a new personal best, a best that is close, a freeze nearly earned, or simply
 * the next day's number. One line rather than all of them, so it reads as a
 * nudge and not a dashboard.
 *
 * Puzzles drop at local midnight (see game/date.ts), so the countdown is to the
 * player's own midnight -- no UTC arithmetic.
 */

import { FREEZE_EVERY, MAX_FREEZES } from "./streakFreeze";
import type { StreakState } from "./types";

/** Milliseconds from `now` to the next local midnight, when the next drop lands. */
export function msUntilNextDrop(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/** `6h 12m`, `12m`, or `under a minute`. Rounded up, so it never reads 0m early. */
export function formatCountdown(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${rest}m`;
}

/** "a 7-day" but "an 8-day" and "an 11-day": the article goes by how the number sounds. */
function aDay(n: number): string {
  const spoken = /^8/.test(String(n)) || n === 11 || n === 18 || Math.floor(n / 100) === 11 || Math.floor(n / 100) === 18;
  return `${spoken ? "an" : "a"} ${n}-day`;
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * The reason to come back tomorrow, read off a streak that banked `today`.
 * Null when today has not been played: there is no streak to talk about yet.
 */
export function comebackLine(streak: StreakState, today: string): string | null {
  if (streak.lastCompletedDate !== today || streak.currentStreak === 0) return null;
  const current = streak.currentStreak;
  const tomorrow = current + 1;
  const best = streak.longestStreak;

  if (current === best && best >= 2) {
    return `Play tomorrow for a new best: ${aDay(tomorrow)} streak.`;
  }
  const toBeatBest = best + 1 - current;
  if (best > current && toBeatBest <= 3) {
    return `${toBeatBest} more ${toBeatBest === 1 ? "day" : "days"} to beat your best streak of ${best}.`;
  }
  if ((streak.freezes ?? 0) < MAX_FREEZES) {
    const toFreeze = FREEZE_EVERY - (current % FREEZE_EVERY);
    if (toFreeze <= 3) {
      return `Play tomorrow for ${aDay(tomorrow)} streak. ${days(toFreeze)} to your next streak freeze.`;
    }
  }
  return `Play tomorrow for ${aDay(tomorrow)} streak.`;
}

/** What the player's freezes mean for them, or null with none held. */
export function freezeLine(streak: StreakState, today: string): string | null {
  const freezes = streak.freezes ?? 0;
  if (freezes === 0) return null;
  const held = freezes === 1 ? "1 streak freeze" : `${freezes} streak freezes`;
  if (streak.freezeEarnedOn === today) {
    return `You earned a streak freeze for ${aDay(streak.currentStreak)} streak. You have ${held}: miss a day and your streak survives.`;
  }
  return `You have ${held}: miss a day and your streak survives.`;
}
