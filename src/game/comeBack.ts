/**
 * What coming back tomorrow is worth, said at the moment a player is most
 * likely to leave: once today's word is banked.
 *
 * Nothing on a played puzzle used to look forward. The streak sat there as a
 * number and the freezes as a badge, so a player finished, shared or didn't,
 * and had no reason in front of them to return -- which is what D1 measures.
 * `streakGoal` names the one reward most worth returning for: a freeze it
 * earns, a weekend off, or the best streak it is closing in on.
 */

import { holdersOf, type AchievementStatus } from "./achievements";
import { maxGuessesFor } from "./constants";
import { addDays } from "./date";
import { freezeCap, freezeRules, LAZY_WEEKEND_RULE, restDayProgress } from "./streakFreeze";
import type { StreakState } from "./types";

/** Whether a streak reaching `days` played days earns a saved freeze (see streakFreeze.earnFreeze). */
function earnsFreezeOn(days: number): boolean {
  return days === 3 || (days > 0 && days % 7 === 0);
}

/** What a lazy Sunday is, for the line promising one once Friday is too late. */
const LAZY_SUNDAY_RULE =
  "Play any 3 days by Saturday and snooze through Sunday: skipping it can't break your streak.";

/**
 * The one reason to come back tomorrow, for a streak that has already been
 * played today. "Play tomorrow to make it a 5-day streak" is never said: that
 * playing tomorrow grows the streak is a given, and a second line under it
 * only buried the reward that was actually news.
 *
 * Only something still to earn is named, never something already earned.
 * Soonest first: of the next freeze that would fit under the cap, a lazy
 * weekend (see `restDayProgress` in game/streakFreeze.ts) and beating the
 * best streak, whichever lands in the fewest days played. A tie goes to the
 * freeze, the thing they keep, then to the lazy weekend, which lapses with
 * its week. A lazy weekend is only promised while the week has days enough
 * left to earn it, and once unlocked is not mentioned again.
 *
 * A new player, whose best streak is a single day, hears none of those: a
 * freeze, a weekend off and a best to beat mean nothing before a streak has
 * started. They get the achievement alone (see `NEW_PLAYER_BEST`).
 *
 * When none of those lands within its window (`SOON_DAYS`: two days played for
 * a freeze or the best streak, one for a lazy weekend), it points at an
 * achievement still locked instead (see `achievementGoal`), skipping a streak
 * or days-played one more than `NEAR_DAYS` away. With nothing at all left to
 * earn, it is null and nothing is said.
 *
 * A freeze past the cap is not kept, so it is not promised. A player already
 * holding one hears which it would be -- a 2nd, a 3rd -- since "your next
 * freeze" reads as the one they have. And a player whose cap is full hears
 * that the cap rises, since that is what the wait is for: the day it rises
 * also earns the freeze that fills it.
 */
export function streakGoal(
  streak: StreakState,
  today: string,
  locked: readonly AchievementStatus[] = []
): string | null {
  return comeBackGoal(streak, today, locked)?.line ?? null;
}

/** What a reward is, for a player who selects the line naming it. */
export interface GoalExplainer {
  title: string;
  text: string;
}

/**
 * `streakGoal`'s line, with what the reward it names is where that is not
 * plain from the line itself: a 🧊 freeze, a lazy weekend, or an achievement.
 * Beating the best streak needs no explaining.
 */
export function comeBackGoal(
  streak: StreakState,
  today: string,
  locked: readonly AchievementStatus[] = []
): { line: string; explainer?: GoalExplainer } | null {
  const days = streak.currentStreak;
  const next = days + 1;
  const best = Math.max(streak.longestStreak, days);
  if (best <= NEW_PLAYER_BEST) return achievementGoal(locked, streak, today);
  const banked = streak.bankedFreezes ?? 0;
  const keeps = (on: number) => earnsFreezeOn(on) && banked < freezeCap(Math.max(best, on));

  // Only up to two are ever earned, so the next is at most the 2nd. (A player
  // still holding three from the old limit has a full cap, so is never told one.)
  const nth = ["", "", "2nd", "3rd"][banked + 1];
  const capFull = banked > 0 && banked >= freezeCap(best);

  // Each reward with the days played until it lands, and its rank in a tie.
  const goals: { away: number; rank: number; soon: number; line: string; explainer?: GoalExplainer }[] = [];

  // A full cap only rises at 14 days, and a kept freeze is never more than
  // four weeks out.
  for (let freezeDay = next; freezeDay <= next + 28; freezeDay++) {
    if (!keeps(freezeDay)) continue;
    const away = freezeDay - days;
    let line: string;
    if (away === 1) {
      if (capFull) line = `Tomorrow your 🧊 freeze limit goes up to ${banked + 1}, and you earn a freeze to fill it.`;
      else if (nth) line = `Tomorrow earns a ${nth} 🧊 streak freeze.`;
      else line = "Tomorrow earns a 🧊 freeze, which saves your streak on a day you miss.";
    } else if (capFull) {
      line = `${away} days until your 🧊 freeze limit goes up to ${banked + 1}.`;
    } else {
      line = `${away} days to ${nth ? `a ${nth}` : "your next"} 🧊 streak freeze.`;
    }
    const explainer = { title: "Streak freezes", text: freezeRules(days, freezeCap(best)) };
    goals.push({ away, rank: 0, soon: SOON_DAYS.freeze, line, explainer });
    break;
  }

  // Only for a streak worth resting: a lost one has nothing for the weekend to keep.
  const rest = days > 0 ? restDayProgress(streak, today) : null;
  if (rest && rest.needed > 0) {
    const line = rest.sundayOnly
      ? rest.needed === 1
        ? "Play tomorrow for a lazy Sunday 😴"
        : `${rest.needed} more days by Saturday unlocks a lazy Sunday 😴`
      : rest.needed === 1
        ? "Play tomorrow and unlock a lazy weekend 😴"
        : `Play ${rest.needed} more days this week and unlock a lazy weekend 😴`;
    const explainer = rest.sundayOnly
      ? { title: "Lazy Sunday", text: LAZY_SUNDAY_RULE }
      : { title: "Lazy weekend", text: LAZY_WEEKEND_RULE };
    goals.push({ away: rest.needed, rank: 1, soon: SOON_DAYS.lazyWeekend, line, explainer });
  }

  if (best > days) {
    goals.push({
      away: best - days + 1,
      rank: 2,
      soon: SOON_DAYS.best,
      line: `${best - days + 1} days to beat your best streak of ${best}.`,
    });
  }

  goals.sort((x, y) => x.away - y.away || x.rank - y.rank);
  const soon = goals.find((goal) => goal.away <= goal.soon);
  if (soon) return { line: soon.line, explainer: soon.explainer };
  const soonest = goals[0];
  const achievement = achievementGoal(locked, streak, today);
  if (achievement) return achievement;
  return soonest ? { line: soonest.line, explainer: soonest.explainer } : null;
}

/** The best streak at or below which a player is new, and only hears of an achievement. */
const NEW_PLAYER_BEST = 1;

/** How many days played ahead each reward still leads the line over an achievement. */
const SOON_DAYS = { freeze: 2, lazyWeekend: 1, best: 2 } as const;

/** How many days played ahead an achievement is worth naming as nearly there. */
const NEAR_DAYS = 3;

/**
 * Days of coming back until playing alone earns `status`, or null for one
 * that takes more than turning up (a Mythic, a clean sweep).
 */
function daysToEarn({ achievement, progress }: AchievementStatus, streak: StreakState, today: string): number | null {
  if (!progress) return null;
  const left = progress.target - progress.current;
  switch (achievement.byPlaying) {
    case "streak":
      return progress.target - streak.currentStreak;
    case "days":
      return left;
    case "words":
      return Math.ceil(left / maxGuessesFor(addDays(today, 1)));
    default:
      return null;
  }
}

/**
 * A number in [0, 1) fixed for `today`: FNV-1a, then murmur3's finalizer so
 * that dates a day apart land far apart rather than next to each other.
 */
function dailyDraw(today: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < today.length; i++) {
    h ^= today.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** How an achievement line opens, one drawn per day so the line doesn't read the same every time. */
export const ACHIEVEMENT_VERBS = [
  "Shoot for",
  "Go for",
  "Chase",
  "Hunt down",
  "Unlock",
  "Grab",
  "Claim",
  "Snag",
  "Nab",
  "Score",
  "Bag",
  "Crush",
  "Conquer",
  "Snatch",
  "Seize",
  "Pounce on",
] as const;

/**
 * An achievement still locked, to shoot for: the one coming back earns
 * soonest, if that is within `NEAR_DAYS` (a tie going to the easier, then to
 * the earlier listed);
 * otherwise one drawn at random for the day, weighted by how many players hold
 * it, so the easier ones come up more often without any one being named every
 * day. Each counts as held by one more than it is, so a badge nobody holds yet
 * can still come up. The draw is fixed per day, so the line does not change
 * between visits.
 *
 * A streak or days-played achievement is only named within `NEAR_DAYS`: one
 * weeks away is no reason to come back tomorrow. With no other left to draw,
 * it is null.
 */
function achievementGoal(
  locked: readonly AchievementStatus[],
  streak: StreakState,
  today: string
): { line: string; explainer: GoalExplainer } | null {
  const candidates = locked
    .map((status) => ({
      status,
      days: daysToEarn(status, streak, today),
      weight: holdersOf(status.achievement.id) + 1,
    }))
    .filter(
      ({ status, days }) =>
        (status.achievement.byPlaying !== "streak" && status.achievement.byPlaying !== "days") ||
        (days !== null && days <= NEAR_DAYS)
    );
  if (candidates.length === 0) return null;
  const near = candidates
    .filter(({ days }) => days !== null && days <= NEAR_DAYS)
    .sort((x, y) => x.days! - y.days! || y.weight - x.weight)[0];
  let pick = near;
  if (!pick) {
    let left = dailyDraw(today) * candidates.reduce((sum, { weight }) => sum + weight, 0);
    pick = candidates.find(({ weight }) => (left -= weight) < 0) ?? candidates[candidates.length - 1];
  }
  const { achievement, progress } = pick.status;
  const along = progress && progress.current > 0 ? ` (${progress.current}/${progress.target} so far)` : "";
  // Drawn apart from the achievement, so the same one doesn't always get the same verb.
  const verb = ACHIEVEMENT_VERBS[Math.floor(dailyDraw(`${today}:verb`) * ACHIEVEMENT_VERBS.length)];
  return {
    line: `${verb} ${achievement.icon} "${achievement.title}" Achievement!`,
    explainer: { title: achievement.title, text: `${achievement.description}${along}` },
  };
}
