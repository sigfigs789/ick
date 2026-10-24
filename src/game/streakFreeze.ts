/**
 * Streak freezes: missed days that do not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * a few days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So a streak earns saved freezes
 * (`bankedFreezes`) early: the first on its third day played, then one on
 * every seventh day played -- the streak count, which frozen days do not add
 * to -- held up to a cap set by the longest streak the player has ever had
 * (see `streakFreezeCap`). The cap is permanent: a player who once reached 14
 * days can hold two on every streak after.
 *
 * There is no free missed day: every missed day spends a saved freeze, is made
 * up (below), or ends the streak. Saved freezes are spent one per missed day,
 * earliest first -- a gap they cannot cover and that is too long to make up
 * resets the streak and the freezes go with it, though the cap stays.
 *
 * So the day after a covered day is a day a streak can be put in danger if no
 * saved freeze is left, and that is when `atRisk` is true and the streak shows ⏳.
 * Otherwise it shows 🧊 while a saved freeze is covering (see
 * `savedFreezeCovering` and components/StreakDisplay.tsx). Playing turns it
 * back to fire.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 *
 * A Saturday can be earned as a rest day (from REST_DAY_START): play
 * REST_DAY_PLAYS of the week's puzzles, Sunday to Friday, each on its own day,
 * and that Saturday left unplayed spends no freeze and ends no streak. It is
 * not saved like a freeze: it is that Saturday's or nothing, so it cannot be
 * stockpiled. A Saturday not earned is an ordinary day, and a Saturday played
 * counts like any other day. While an earned Saturday is unplayed the streak
 * shows 😴 (see `resting` and components/RestDayBadge.tsx). Every
 * rule below that counts missed days skips rest days (`missedDays`).
 *
 * A gap the saved freezes cannot cover does not end the streak at once. The
 * last missed day past the freezes -- yesterday, or Friday past a rest day --
 * can still be made up by playing its puzzle out of the archive (`catchUpDays`,
 * `recordCatchUp`). While it is owed the streak shows ⚠️ (`endangered`), and
 * it ends the day after, when the missed day falls out of that window.
 * A made-up day is like a frozen one: it keeps the streak alive but does not
 * add to it, since it was not played on its own day.
 */

import { addDays, dayOfWeek, daysSinceEpoch } from "./date";
import type { FreezeCount, StreakState } from "./types";

/**
 * How long a covered day is remembered. Only the current month is ever asked
 * about (perfect month), so two months is room to spare without the list
 * growing for ever.
 */
const FROZEN_DATES_KEPT_DAYS = 62;

/** The first Saturday that can be a rest day. Earlier Saturdays were missed like any day. */
export const REST_DAY_START = "2026-10-31";

/** Puzzles played on their own day, Sunday to Friday, that earn that Saturday off. */
export const REST_DAY_PLAYS = 3;

const SATURDAY = 6;

/**
 * How long a played day is remembered: the current week and the last, which
 * is all `isRestDay` ever asks about.
 */
const PLAYED_DATES_KEPT_DAYS = 14;

/** The Saturday ending the week (Sunday to Saturday) that `date` falls in. */
export function weekSaturday(date: string): string {
  return addDays(date, SATURDAY - dayOfWeek(date));
}

/** The days of `saturday`'s week, Sunday to Friday, that were played on their own day. */
export function weekPlays(streak: StreakState, saturday: string): number {
  const sunday = addDays(saturday, -6);
  return (streak.playedDates ?? []).filter((d) => d >= sunday && d < saturday).length;
}

/**
 * Whether `date` is a rest day: a Saturday the week's play has earned, which
 * a streak can skip for free.
 */
export function isRestDay(streak: StreakState, date: string): boolean {
  return (
    date >= REST_DAY_START && dayOfWeek(date) === SATURDAY && weekPlays(streak, date) >= REST_DAY_PLAYS
  );
}

/** The streak with `date` remembered as played on its own day. */
export function recordPlayed(streak: StreakState, date: string): StreakState {
  const keepFrom = addDays(date, -PLAYED_DATES_KEPT_DAYS);
  const kept = (streak.playedDates ?? []).filter((d) => d >= keepFrom && d !== date);
  return { ...streak, playedDates: [...kept, date].sort() };
}

/**
 * The days strictly between `after` and `before` that a streak needed played:
 * every day in the gap but the rest days and the days made up since.
 */
export function missedDays(streak: StreakState, after: string, before: string): string[] {
  const gap = Math.max(0, daysSinceEpoch(before, after) - 1);
  return Array.from({ length: gap }, (_, i) => addDays(after, i + 1)).filter(
    (d) => !isRestDay(streak, d) && !wasCaughtUp(streak, d)
  );
}

/**
 * How many missed days past the saved freezes can still be made up: the last
 * one that needed playing -- yesterday, skipping a rest day.
 */
export const CATCH_UP_DAYS = 1;

/** How long a made-up day is remembered: long enough to outlast any gap it bridged. */
const CAUGHT_UP_DATES_KEPT_DAYS = 14;

/** Whether `date` was missed and then made up by playing its puzzle late. */
export function wasCaughtUp(streak: StreakState, date: string): boolean {
  return (streak.caughtUpDates ?? []).includes(date);
}

/**
 * The missed days that playing their puzzle now would make up, earliest first:
 * the ones a live streak's saved freezes cannot cover, while there are no more
 * than CATCH_UP_DAYS of them. Empty when nothing is owed, or when too much is
 * and the streak is lost.
 */
export function catchUpDays(streak: StreakState, today: string): string[] {
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= today) return [];
  const owed = missedDays(streak, covered, today).slice(streak.bankedFreezes ?? 0);
  return owed.length <= CATCH_UP_DAYS ? owed : [];
}

/**
 * Whether the streak is lost unless missed days are made up: the saved
 * freezes are spent and a day they could not cover is still owed. The game
 * and the streak board show ⚠️ for it.
 */
export function endangered(streak: StreakState, today: string): boolean {
  return catchUpDays(streak, today).length > 0;
}

/**
 * The streak with `date` made up, when `date` is a day it owes (see
 * `catchUpDays`); otherwise unchanged.
 */
export function recordCatchUp(streak: StreakState, date: string, today: string): StreakState {
  if (!catchUpDays(streak, today).includes(date)) return streak;
  const keepFrom = addDays(today, -CAUGHT_UP_DATES_KEPT_DAYS);
  const kept = (streak.caughtUpDates ?? []).filter((d) => d >= keepFrom);
  return { ...streak, caughtUpDates: [...kept, date].sort() };
}

/** The first saved freeze is earned on a streak's third day played. */
const FIRST_FREEZE_DAY = 3;

/** After that, one is earned on every seventh day played in a streak. */
const DAYS_PER_EARNED_FREEZE = 7;

/**
 * The most saved freezes a player whose longest streak is `days` can hold:
 * none in the first two days, one from 3 days, two from 14. A freeze earned
 * past the cap is not kept.
 *
 * It was three from 28 days until 2026-10-24. A player already holding three
 * keeps them -- nothing here takes a saved freeze away, and earning only ever
 * adds up to the cap -- so they show as 3/2 until they spend one.
 */
export function freezeCap(days: number): number {
  if (days >= 14) return 2;
  if (days >= FIRST_FREEZE_DAY) return 1;
  return 0;
}

/** The cap for this player: set by the longest streak they have ever had. */
export function streakFreezeCap(streak: StreakState): number {
  return freezeCap(Math.max(streak.longestStreak, streak.currentStreak));
}

/** Saved freezes after the streak reaches `currentStreak` played days. */
export function earnFreeze(streak: StreakState): StreakState {
  const banked = streak.bankedFreezes ?? 0;
  const days = streak.currentStreak;
  if (days === 0 || (days !== FIRST_FREEZE_DAY && days % DAYS_PER_EARNED_FREEZE !== 0)) {
    return streak;
  }
  const earned = Math.min(banked + 1, streakFreezeCap(streak));
  return earned > banked ? { ...streak, bankedFreezes: earned } : streak;
}

/**
 * Give a live streak the saved freezes it would hold had freezes existed all
 * along, once. Saved freezes shipped on 2026-10-15 with every streak at none,
 * so a player who had once run 48 days, now on a short new run, had nothing
 * to cover a second missed day. This fills the streak to its cap -- set by the
 * longest streak ever, so it is the cap they have already earned -- however
 * long the current run is, and marks it so it never runs again. Never takes
 * freezes away; a player who spent one since 10-15 gets it back, which is the
 * generous side to err on.
 */
export function backdateFreezes(streak: StreakState): StreakState {
  if (streak.freezesBackdated || streak.currentStreak === 0) return streak;
  const banked = streak.bankedFreezes ?? 0;
  return {
    ...streak,
    bankedFreezes: Math.max(banked, streakFreezeCap(streak)),
    freezesBackdated: true,
  };
}

/** The best streak that makes a lapsed player a returning one: the first freeze's. */
const WELCOME_BACK_MIN_BEST = FIRST_FREEZE_DAY;

/**
 * Days after one welcome-back freeze before the next. A player who comes and
 * goes every week should not find a free freeze waiting each time.
 */
export const WELCOME_BACK_COOLDOWN_DAYS = 30;

export interface WelcomeBack {
  /** The longest streak the player has had. */
  best: number;
  /** The last day they played. */
  lastPlayed: string;
  /** Whether today's first word starts the new streak with a saved freeze. */
  freeze: boolean;
}

/**
 * A player coming back to a streak that has ended, having once run at least
 * three days: someone the game kept for a while and then lost. The streak
 * reset to zero while they were away, and a zero says nothing about the
 * player who earned it, so the play screen greets them with the best they
 * managed and a reason to start again. Null for anyone else -- a new player,
 * a live streak, or a day already played.
 *
 * The reason is a saved freeze for the new streak, given on today's first
 * word (see `startStreak`): a player who has just lost a streak to a missed
 * day is the one most likely to miss another before day 3 earns one. At most
 * one every WELCOME_BACK_COOLDOWN_DAYS.
 */
export function welcomeBack(streak: StreakState, today: string): WelcomeBack | null {
  const lastPlayed = streak.lastCompletedDate;
  const best = Math.max(streak.longestStreak, streak.currentStreak);
  if (streak.currentStreak > 0 || !lastPlayed || lastPlayed >= today) return null;
  if (best < WELCOME_BACK_MIN_BEST) return null;
  const given = streak.welcomeBackFreezeDate;
  const freeze = !given || daysSinceEpoch(today, given) >= WELCOME_BACK_COOLDOWN_DAYS;
  return { best, lastPlayed, freeze };
}

/**
 * The saved freezes a streak starting on `date` begins with: none, as saved
 * freezes belong to the streak that earned them -- unless the player is
 * returning (see `welcomeBack`), when it begins with one.
 */
export function startStreak(
  streak: StreakState,
  date: string
): Pick<StreakState, "bankedFreezes" | "welcomeBackFreezeDate"> {
  if (!welcomeBack(streak, date)?.freeze) {
    return { bankedFreezes: 0, welcomeBackFreezeDate: streak.welcomeBackFreezeDate };
  }
  return { bankedFreezes: 1, welcomeBackFreezeDate: date };
}

/** The last day the streak reaches: the last day played, or a later frozen one. */
export function coveredThrough(streak: StreakState): string | undefined {
  let latest = streak.lastCompletedDate;
  for (const frozen of streak.frozenDates ?? []) {
    if (!latest || frozen > latest) latest = frozen;
  }
  return latest;
}

/**
 * Whether the streak carries on into `date`: nothing but rest days lies
 * between it and the last day it was played or covered.
 */
export function continuesInto(streak: StreakState, date: string): boolean {
  const covered = coveredThrough(streak);
  return covered !== undefined && covered < date && missedDays(streak, covered, date).length === 0;
}

/**
 * The streak as it stands on `today`: the missed days since the streak was
 * last covered are covered by saved freezes, one each, earliest first. Up to
 * CATCH_UP_DAYS left over are owed, to be made up (see `catchUpDays`); any
 * more and the streak resets. Rest days and made-up days are not missed days.
 * Unchanged when nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= today) return streak;

  const missed = missedDays(streak, covered, today);
  if (missed.length === 0) return streak;
  const banked = streak.bankedFreezes ?? 0;
  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  const cap = streakFreezeCap(streak);
  if (missed.length - banked > CATCH_UP_DAYS) {
    const missedDates = missed.filter((d) => d >= keepFrom);
    // The freezes went with the streak, from the first missed day.
    const lost = missedDates.map((d): [string, FreezeCount] => [d, { banked: 0, cap }]);
    return {
      ...streak,
      currentStreak: 0,
      bankedFreezes: 0,
      freezeHistory: keptHistory({ ...streak.freezeHistory, ...Object.fromEntries(lost) }, keepFrom),
    };
  }

  // The freezes cover the earliest missed days; any left over are owed.
  const frozen = missed.slice(0, banked);
  if (frozen.length === 0) return streak;
  // Each covered day spent one, so it ends the day with one fewer than the last.
  const spent = frozen
    .map((d, i): [string, FreezeCount] => [d, { banked: banked - i - 1, cap }])
    .filter(([d]) => d >= keepFrom);
  return {
    ...streak,
    bankedFreezes: banked - frozen.length,
    frozenDates: [...(streak.frozenDates ?? []), ...frozen].filter((d) => d >= keepFrom),
    freezeHistory: keptHistory({ ...streak.freezeHistory, ...Object.fromEntries(spent) }, keepFrom),
  };
}

function keptHistory(
  history: Record<string, FreezeCount>,
  keepFrom: string
): Record<string, FreezeCount> {
  return Object.fromEntries(Object.entries(history).filter(([d]) => d >= keepFrom));
}

/** The streak with the saved freezes it holds now recorded as `date`'s. */
export function recordFreezes(streak: StreakState, date: string): StreakState {
  const keepFrom = addDays(date, -FROZEN_DATES_KEPT_DAYS);
  const count = { banked: streak.bankedFreezes ?? 0, cap: streakFreezeCap(streak) };
  return {
    ...streak,
    freezeHistory: keptHistory({ ...streak.freezeHistory, [date]: count }, keepFrom),
  };
}

/**
 * The saved freezes and cap the streak held at the end of `date`, for a past
 * puzzle. A day with no record -- before records were kept, or never played
 * nor covered -- shows the ones held now, as every day did before.
 */
export function freezesOn(streak: StreakState, date: string | undefined): FreezeCount {
  const recorded = date === undefined ? undefined : streak.freezeHistory?.[date];
  return recorded ?? { banked: streak.bankedFreezes ?? 0, cap: streakFreezeCap(streak) };
}

/**
 * Whether a saved freeze is what is keeping the streak alive today: a day
 * other than a rest day has gone unplayed since the last played day, and
 * today has not been played yet.
 */
export function savedFreezeCovering(streak: StreakState, today: string): boolean {
  if (streak.currentStreak === 0 || !streak.lastCompletedDate) return false;
  if (streak.lastCompletedDate >= today) return false;
  return missedDays(streak, streak.lastCompletedDate, today).length > 0;
}

/**
 * Whether the last day before today that needed playing -- yesterday, or
 * Friday when yesterday was a rest day -- went unplayed and was covered by a
 * freeze or made up, and today is not played yet: only a saved freeze stands
 * between the streak and missing today. The streak board's `covered`.
 */
export function missedYesterday(streak: StreakState, today: string): boolean {
  let day = addDays(today, -1);
  while (isRestDay(streak, day)) day = addDays(day, -1);
  return (
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== today &&
    (wasFrozen(streak, day) || wasCaughtUp(streak, day))
  );
}

/**
 * Whether the streak is endangered if `today` goes unplayed: the last day that
 * needed playing was covered and no saved freeze is left, so tomorrow it is
 * ⚠️ and has to be made up. Never on a rest day, which cannot end a streak.
 * The streak board's `atRisk`.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return (
    !isRestDay(streak, today) && missedYesterday(streak, today) && (streak.bankedFreezes ?? 0) === 0
  );
}

/**
 * Whether today is a rest day the streak is taking: a live streak on an
 * earned Saturday not played yet. The game and the streak board show 😴 for it.
 */
export function resting(streak: StreakState, today: string): boolean {
  return isRestDay(streak, today) && streak.currentStreak > 0 && streak.lastCompletedDate !== today;
}

/**
 * The week's days played towards Saturday off, for the weekday badge (see
 * components/RestDayBadge.tsx), and whether three can still be reached --
 * counting today if it is not played yet. Shown even when they cannot, so a
 * player learns of it for next week. Null on a Saturday, which shows 😴
 * itself, and before rest days began.
 */
export function weekdayRestProgress(
  streak: StreakState,
  today: string
): { played: number; reachable: boolean } | null {
  const dow = dayOfWeek(today);
  if (dow === SATURDAY || weekSaturday(today) < REST_DAY_START) return null;
  const played = weekPlays(streak, weekSaturday(today));
  const playedToday = (streak.playedDates ?? []).includes(today);
  const daysLeft = SATURDAY - dow - (playedToday ? 1 : 0);
  return { played, reachable: REST_DAY_PLAYS - played <= daysLeft };
}

/**
 * The next Saturday after `date` and what earning it off still takes, for a
 * player who has played `date`: the plays still needed by Friday (0 once it
 * is earned). Null when it can no longer be earned -- too few days are left
 * in the week -- or `date` is itself a Saturday, whose week is over.
 */
export function restDayProgress(
  streak: StreakState,
  date: string
): { saturday: string; needed: number } | null {
  if (dayOfWeek(date) === SATURDAY) return null;
  const saturday = weekSaturday(date);
  if (saturday < REST_DAY_START) return null;
  const needed = Math.max(0, REST_DAY_PLAYS - weekPlays(streak, saturday));
  const daysLeft = daysSinceEpoch(saturday, date) - 1;
  return needed <= daysLeft ? { saturday, needed } : null;
}

/**
 * The streak as it stood on its last played day, which is what the streak
 * board is sent (see game/leaderboard.ts). The board works out the rest from
 * that day alone: the run is alive while the days missed since -- less the
 * earned Saturday, if one lies between -- are no more than the freezes saved
 * then, and ⚠️ for CATCH_UP_DAYS more. So the saved count is the one from
 * before any were spent on the gap -- every covered day since the last played
 * day took one -- plus the days made up since.
 */
export function streakReport(streak: StreakState): {
  current: number;
  best: number;
  saved: number;
  lastPlayed: string;
  /** The Saturday after the last played day, when that week's play earned it off. */
  restDay?: string;
} | null {
  const lastPlayed = streak.lastCompletedDate;
  if (streak.currentStreak === 0 || !lastPlayed) return null;
  // A day made up since counts as one more saved: the board sees only the days
  // missed since the last played day, and a made-up day is one it need not end on.
  const coveredSince = [...(streak.frozenDates ?? []), ...(streak.caughtUpDates ?? [])].filter(
    (d) => d > lastPlayed
  ).length;
  return {
    current: streak.currentStreak,
    best: Math.max(streak.longestStreak, streak.currentStreak),
    saved: (streak.bankedFreezes ?? 0) + coveredSince,
    lastPlayed,
    // Only the first Saturday after the last played day can be earned: no
    // later week has been played.
    ...(dayOfWeek(lastPlayed) !== SATURDAY && isRestDay(streak, weekSaturday(lastPlayed))
      ? { restDay: weekSaturday(lastPlayed) }
      : {}),
  };
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
