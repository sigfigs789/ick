/**
 * Streak freezes: missed days that do not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * a few days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So playing earns saved freezes
 * (`bankedFreezes`): one on every FREEZE_PLAYS-th day played, each on its own
 * day, whether or not those days ran in a row (`freezePlays` counts them, and
 * a broken streak does not reset the count), and a bonus one on each day a
 * streak reaches FIRST_CAP_STREAK or BONUS_FREEZE_STREAK days played -- the
 * streak count, which frozen days do not add to. They are held up to a cap set by the longest streak the
 * player has ever had (see `streakFreezeCap`): one from a 2 day streak, two
 * from a 10 day one. The cap is permanent: a player who once reached 10 days
 * can hold two on every streak after.
 *
 * There is no free missed day: every missed day spends a saved freeze or ends
 * the streak. Saved freezes are spent one per missed day, and only when there
 * are enough to cover the whole gap -- a gap they cannot cover resets the
 * streak and the freezes go with it, though the cap stays.
 *
 * So the day after a covered day is a day a streak can be lost if no saved
 * freeze is left, and that is when `atRisk` is true and the streak shows ⏳.
 * Otherwise it shows 🧊 while a saved freeze is covering (see
 * `savedFreezeCovering` and components/StreakDisplay.tsx). Playing turns it
 * back to fire.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 *
 * A weekend can be earned as rest days (from REST_DAY_START). The week runs
 * Monday to Sunday, and its Saturday and Sunday are the weekend. Play
 * REST_DAY_PLAYS of the week's puzzles before a weekend day, each on its own
 * day, and that day, left unplayed, spends no freeze and ends no streak. The
 * first such week, 2026-10-25 to 11-01, also took in the Sunday before its
 * Monday, as the weekly board's did (see game/week.ts). So
 * three days played Monday to Friday rest the Saturday and the Sunday, and a
 * Saturday played as the third rests the Sunday after it. A Sunday played
 * ends its week, so it counts towards no weekend. A weekend is not saved like
 * a freeze: it is that week's or nothing, so it cannot be stockpiled. A
 * weekend not earned is two ordinary days, and a weekend day played counts
 * like any other day. While an earned weekend day is unplayed the streak shows
 * 😴 (see `resting` and components/RestDayBadge.tsx). Every rule below that
 * counts missed days skips rest days (`missedDays`).
 */

import { addDays, dayOfWeek, daysSinceEpoch } from "./date";
import type { FreezeCount, StreakState } from "./types";
import { weekStart } from "./week";

/**
 * How long a covered day is remembered. Only the current month is ever asked
 * about (perfect month), so two months is room to spare without the list
 * growing for ever.
 */
const FROZEN_DATES_KEPT_DAYS = 62;

/**
 * The first Saturday that can be a rest day, opening the first weekend that
 * can. Earlier weekends were missed like any day.
 */
export const REST_DAY_START = "2026-10-31";

/** Puzzles played on their own day in a week, before a weekend day, that earn it off. */
export const REST_DAY_PLAYS = 3;

/** What a lazy weekend is, said the same wherever it's explained (the 😴 pie, the come-back line). */
export const LAZY_WEEKEND_RULE = "Play any 3 days this week and your streak is paused through the weekend.";

const SUNDAY = 0;
const SATURDAY = 6;

/**
 * How long a played day is remembered: the current week and the last, which
 * is more than `isRestDay` ever asks about -- a Sunday asks about at most the
 * seven days before it.
 */
const PLAYED_DATES_KEPT_DAYS = 14;

/**
 * The Saturday of the week (Monday to Sunday) that `date` falls in. A Sunday
 * ends its week -- but for the one week that starts on a Sunday, the first
 * Monday week (see game/week.ts), which it opens.
 */
export function weekSaturday(date: string): string {
  const dow = dayOfWeek(date);
  if (dow !== SUNDAY) return addDays(date, SATURDAY - dow);
  return addDays(date, weekStart(date) === date ? SATURDAY : -1);
}

/**
 * The Saturday whose weekend playing `date` counts towards: its own week's,
 * or on a Sunday, which ends its week, the next week's.
 */
export function earningSaturday(date: string): string {
  return dayOfWeek(date) === SUNDAY ? addDays(date, 6) : weekSaturday(date);
}

/**
 * The days of `saturday`'s week, from its first day to `saturday`, that were
 * played on their own day: all that can count towards its weekend.
 */
export function weekPlays(streak: StreakState, saturday: string): number {
  return playsBetween(streak, weekStart(saturday), saturday);
}

/** The days from `from` to `through`, both included, played on their own day. */
function playsBetween(streak: StreakState, from: string, through: string): number {
  return (streak.playedDates ?? []).filter((d) => d >= from && d <= through).length;
}

/**
 * Whether `date` is a rest day: a Saturday or Sunday that the week's play
 * before it, from its first day, earned, which a streak can skip for free.
 */
export function isRestDay(streak: StreakState, date: string): boolean {
  const dow = dayOfWeek(date);
  if (dow !== SATURDAY && dow !== SUNDAY) return false;
  const saturday = weekSaturday(date);
  return (
    saturday >= REST_DAY_START &&
    playsBetween(streak, weekStart(saturday), addDays(date, -1)) >= REST_DAY_PLAYS
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
 * every day in the gap but the rest days.
 */
export function missedDays(streak: StreakState, after: string, before: string): string[] {
  const gap = Math.max(0, daysSinceEpoch(before, after) - 1);
  return Array.from({ length: gap }, (_, i) => addDays(after, i + 1)).filter(
    (d) => !isRestDay(streak, d)
  );
}

/** Days played, each on its own day and not necessarily in a row, that earn a saved freeze. */
export const FREEZE_PLAYS = 4;

/** The streak, in days played, whose day earns a bonus saved freeze and raises the cap to two. */
export const BONUS_FREEZE_STREAK = 10;

/** The streak, in days played, whose day earns a bonus saved freeze and raises the cap to one. */
export const FIRST_CAP_STREAK = 2;

/** The streak days, in days played, that each earn a bonus saved freeze, as the cap rises to fit it. */
const BONUS_STREAK_DAYS = [FIRST_CAP_STREAK, BONUS_FREEZE_STREAK];

/**
 * Days played towards the next saved freeze. A save from before they were
 * counted (2026-11-06) carries on from where its streak stood in the cycle.
 */
export function freezePlays(streak: StreakState): number {
  return streak.freezePlays ?? streak.currentStreak % FREEZE_PLAYS;
}

/** The days played towards the next saved freeze, for the freeze badge's pie. */
export function freezeProgress(streak: StreakState): { played: number; of: number } {
  return { played: freezePlays(streak), of: FREEZE_PLAYS };
}

/** The most saved freezes any player can hold. */
const MAX_FREEZE_CAP = 2;

/**
 * The most saved freezes a player whose longest streak is `days` can hold:
 * none in the first day, one from 2 days, two from 10. A freeze earned past
 * the cap is not kept.
 *
 * It was three from 28 days until 2026-10-24. A player already holding three
 * keeps them -- nothing here takes a saved freeze away, and earning only ever
 * adds up to the cap -- so they show as 3/2 until they spend one.
 */
export function freezeCap(days: number): number {
  if (days >= BONUS_FREEZE_STREAK) return MAX_FREEZE_CAP;
  if (days >= FIRST_CAP_STREAK) return 1;
  return 0;
}

/**
 * How saved freezes work, for the freeze badge's popup: only the rules still
 * ahead of the player. The day-2 and day-10 bonuses are told until this
 * streak has passed them, and the limit rising until `cap` is two.
 */
export function freezeRules(currentStreak: number, cap: number): string {
  const earn =
    `You earn one every ${FREEZE_PLAYS} days you play, in a row or not` +
    (currentStreak < FIRST_CAP_STREAK
      ? `, and a bonus one when your streak reaches ${FIRST_CAP_STREAK} days and again at ${BONUS_FREEZE_STREAK}.`
      : currentStreak < BONUS_FREEZE_STREAK
        ? `, and a bonus one when your streak reaches ${BONUS_FREEZE_STREAK} days.`
        : ".");
  const hold =
    cap === 0
      ? `Reach a ${FIRST_CAP_STREAK} day streak to save 1, and a ${BONUS_FREEZE_STREAK} day streak to save up to ${MAX_FREEZE_CAP}.`
      : cap < MAX_FREEZE_CAP
        ? `You can only save 1 at a time. Reach a ${BONUS_FREEZE_STREAK} day streak to save up to ${MAX_FREEZE_CAP}.`
        : `You can save up to ${MAX_FREEZE_CAP} at a time.`;
  return `A streak freeze 🧊 keeps your streak going if you miss a day. ${earn} ${hold}`;
}

/** The one line the freeze badge's popup needs for a player with this cap. */
export function freezeTip(cap: number): string {
  if (cap === 0) return "Get a freeze tomorrow. It keeps your streak going if you miss a day.";
  if (cap < MAX_FREEZE_CAP) return `Refresh one every ${FREEZE_PLAYS} days. Next cap at ${BONUS_FREEZE_STREAK} days.`;
  return `You can save up to ${MAX_FREEZE_CAP} at a time.`;
}

/** The cap for this player: set by the longest streak they have ever had. */
export function streakFreezeCap(streak: StreakState): number {
  return freezeCap(Math.max(streak.longestStreak, streak.currentStreak));
}

/**
 * The saved freezes earned by a day just played, which brought the streak to
 * `currentStreak`: one if it is the FREEZE_PLAYS-th day played since the
 * last, and one more if the streak has just reached FIRST_CAP_STREAK or
 * BONUS_FREEZE_STREAK, up
 * to the cap. Call once per day played on its own day.
 */
export function earnFreeze(streak: StreakState): StreakState {
  // A save from before the count was kept counts on from the streak as it
  // stood before this day (see `freezePlays`).
  const before = streak.freezePlays ?? Math.max(0, streak.currentStreak - 1) % FREEZE_PLAYS;
  const plays = before + 1;
  const earned =
    (plays >= FREEZE_PLAYS ? 1 : 0) + (BONUS_STREAK_DAYS.includes(streak.currentStreak) ? 1 : 0);
  const banked = streak.bankedFreezes ?? 0;
  const kept = Math.max(banked, Math.min(banked + earned, streakFreezeCap(streak)));
  return {
    ...streak,
    freezePlays: plays % FREEZE_PLAYS,
    ...(kept > banked ? { bankedFreezes: kept } : {}),
  };
}

/**
 * Whether the day played that brings the count to `plays` days played
 * towards a freeze and the streak to `streakDay` earns a saved freeze, before
 * the cap. For the come-back line.
 */
export function earnsFreezeOn(plays: number, streakDay: number): boolean {
  return plays % FREEZE_PLAYS === 0 || BONUS_STREAK_DAYS.includes(streakDay);
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

/** The best streak that makes a lapsed player a returning one. */
const WELCOME_BACK_MIN_BEST = 3;

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
 * day is the one most likely to miss another before play earns one. At most
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
 * last covered are covered by saved freezes, one each, or the streak resets.
 * Rest days are not missed days. Unchanged when nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= today) return streak;

  const missed = missedDays(streak, covered, today);
  if (missed.length === 0) return streak;
  const banked = streak.bankedFreezes ?? 0;
  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  const cap = streakFreezeCap(streak);
  const missedDates = missed.filter((d) => d >= keepFrom);
  if (missed.length > banked) {
    // The freezes went with the streak, from the first missed day.
    const lost = missedDates.map((d): [string, FreezeCount] => [d, { banked: 0, cap }]);
    return {
      ...streak,
      currentStreak: 0,
      bankedFreezes: 0,
      freezeHistory: keptHistory({ ...streak.freezeHistory, ...Object.fromEntries(lost) }, keepFrom),
    };
  }

  // Each covered day spent one, so it ends the day with one fewer than the last.
  const spent = missed
    .map((d, i): [string, FreezeCount] => [d, { banked: banked - i - 1, cap }])
    .filter(([d]) => d >= keepFrom);
  return {
    ...streak,
    bankedFreezes: banked - missed.length,
    frozenDates: [...(streak.frozenDates ?? []), ...missedDates].filter((d) => d >= keepFrom),
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
 * Friday when yesterday was a rest day -- went unplayed and was covered, and
 * today is not played yet: only a saved freeze stands between the streak and
 * missing today. The streak board's `covered`.
 */
export function missedYesterday(streak: StreakState, today: string): boolean {
  let day = addDays(today, -1);
  while (isRestDay(streak, day)) day = addDays(day, -1);
  return streak.currentStreak > 0 && streak.lastCompletedDate !== today && wasFrozen(streak, day);
}

/**
 * Whether the streak is lost if `today` goes unplayed: the last day that
 * needed playing was covered and no saved freeze is left. Never on a rest
 * day, which cannot end a streak. The streak board's `atRisk`.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return (
    !isRestDay(streak, today) && missedYesterday(streak, today) && (streak.bankedFreezes ?? 0) === 0
  );
}

/**
 * Whether today is a rest day the streak is taking: a live streak on a day
 * of an earned weekend not played yet. The game and the streak board show 😴 for it.
 */
export function resting(streak: StreakState, today: string): boolean {
  return isRestDay(streak, today) && streak.currentStreak > 0 && streak.lastCompletedDate !== today;
}

/**
 * The days played towards the next weekend off, for the badge (see
 * components/RestDayBadge.tsx), whether three can still be reached by
 * Saturday -- counting today if it is not played yet -- and whether three now
 * earn only the Sunday, Friday having passed or being out of reach. Shown
 * even when they cannot, so a player learns of it for next week. On a Sunday
 * it is the next week's, which has not begun. Null on an earned Saturday or
 * Sunday, played or not, which shows 😴 itself until the next week begins on
 * Monday, and before rest days began.
 */
export function weekdayRestProgress(
  streak: StreakState,
  today: string
): { played: number; reachable: boolean; sundayOnly: boolean } | null {
  const saturday = earningSaturday(today);
  if (isRestDay(streak, today) || saturday < REST_DAY_START) return null;
  const played = weekPlays(streak, saturday);
  const playedToday = (streak.playedDates ?? []).includes(today);
  // The days still to play through `last`: from the week's first day when that
  // is after today -- a Sunday, before next week's Monday -- else from today
  // unless it is played.
  const opens = weekStart(saturday);
  const first = opens > today ? opens : today;
  const left = (last: string) =>
    Math.max(0, daysSinceEpoch(last, first) + 1 - (first === today && playedToday ? 1 : 0));
  const byFriday = dayOfWeek(today) !== SATURDAY && played + left(addDays(saturday, -1)) >= REST_DAY_PLAYS;
  return {
    played,
    reachable: played + left(saturday) >= REST_DAY_PLAYS,
    sundayOnly: !byFriday,
  };
}

/**
 * The Saturday whose weekend playing `date` counts towards and what earning
 * it off still takes, for a player who has played `date`: the plays still
 * needed (0 once it is earned), and whether they earn only the Sunday, as
 * there are no longer days enough before Saturday. Null when not even the
 * Sunday can be earned: too few days are left through Saturday.
 */
export function restDayProgress(
  streak: StreakState,
  date: string
): { saturday: string; needed: number; sundayOnly: boolean } | null {
  const saturday = earningSaturday(date);
  if (saturday < REST_DAY_START) return null;
  const needed = Math.max(0, REST_DAY_PLAYS - weekPlays(streak, saturday));
  // The days after `date` still to play, through Friday and through Saturday.
  const toFriday = Math.max(0, daysSinceEpoch(saturday, date) - 1);
  const toSaturday = daysSinceEpoch(saturday, date);
  if (needed > toSaturday) return null;
  return { saturday, needed, sundayOnly: needed > toFriday };
}

/**
 * The streak as it stood on its last played day, which is what the streak
 * board is sent (see game/leaderboard.ts). The board works out the rest from
 * that day alone: the run is alive while the days missed since -- less the
 * earned weekend's days, if any lie between -- are no more than the freezes
 * saved then. So the saved count is the one from before any
 * were spent on the gap -- every covered day since the last played day took
 * one.
 */
export function streakReport(streak: StreakState): {
  current: number;
  best: number;
  saved: number;
  lastPlayed: string;
  /**
   * The Saturday of the last played day's week, when that week's play earned
   * its Sunday off -- and the Saturday too, unless it was played: the board
   * rests that day and the Sunday after, the ones not played.
   */
  restDay?: string;
} | null {
  const lastPlayed = streak.lastCompletedDate;
  if (streak.currentStreak === 0 || !lastPlayed) return null;
  const coveredSince = (streak.frozenDates ?? []).filter((d) => d > lastPlayed).length;
  return {
    current: streak.currentStreak,
    best: Math.max(streak.longestStreak, streak.currentStreak),
    saved: (streak.bankedFreezes ?? 0) + coveredSince,
    lastPlayed,
    // Only the weekend of the last played day's week can be earned: no later
    // week has been played. A Sunday played has nothing left of its weekend
    // to rest. Its Sunday is earned whenever its Saturday is, so asking
    // about the Sunday covers both.
    ...(dayOfWeek(lastPlayed) !== SUNDAY && isRestDay(streak, addDays(weekSaturday(lastPlayed), 1))
      ? { restDay: weekSaturday(lastPlayed) }
      : {}),
  };
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
