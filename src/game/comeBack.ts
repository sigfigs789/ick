/**
 * What coming back tomorrow is worth, said at the moment a player is most
 * likely to leave: once today's word is banked.
 *
 * Nothing on a played puzzle used to look forward. The streak sat there as a
 * number and the freezes as a badge, so a player finished, shared or didn't,
 * and had no reason in front of them to return -- which is what D1 measures.
 * `streakGoal` names the one reward most worth returning for: a freeze it
 * earns, a Saturday off, or the best streak it is closing in on.
 */

import { addDays } from "./date";
import { freezeCap, restDayProgress } from "./streakFreeze";
import type { StreakState } from "./types";

/** Whether a streak reaching `days` played days earns a saved freeze (see streakFreeze.earnFreeze). */
function earnsFreezeOn(days: number): boolean {
  return days === 3 || (days > 0 && days % 7 === 0);
}

/**
 * The one reason to come back tomorrow, for a streak that has already been
 * played today. "Play tomorrow to make it a 5-day streak" is never said: that
 * playing tomorrow grows the streak is a given, and a second line under it
 * only buried the reward that was actually news.
 *
 * Most motivating first: a freeze tomorrow itself, then Saturday off (see
 * `restDayProgress` in game/streakFreeze.ts) -- earned by tomorrow, already
 * earned on a Friday, or a few days away -- since it lapses with its week
 * while a freeze keeps; then whichever is nearer of the next freeze that would
 * fit under the cap and beating the best streak (a tie goes to the freeze,
 * the thing they keep), then a record run, and only with nothing else to say,
 * that a streak starts tomorrow. Saturday off is only promised while the week
 * has days enough left to earn it.
 *
 * A freeze past the cap is not kept, so it is not promised. A player already
 * holding one hears which it would be -- a 2nd, a 3rd -- since "your next
 * freeze" reads as the one they have. And a player whose cap is full hears
 * that the cap rises, since that is what the wait is for: the day it rises
 * also earns the freeze that fills it.
 */
export function streakGoal(streak: StreakState, today: string): string {
  const days = streak.currentStreak;
  const next = days + 1;
  const best = Math.max(streak.longestStreak, days);
  const banked = streak.bankedFreezes ?? 0;
  const keeps = (on: number) => earnsFreezeOn(on) && banked < freezeCap(Math.max(best, on));

  // Only up to two are ever earned, so the next is at most the 2nd. (A player
  // still holding three from the old limit has a full cap, so is never told one.)
  const nth = ["", "", "2nd", "3rd"][banked + 1];
  const capFull = banked > 0 && banked >= freezeCap(best);

  if (keeps(next)) {
    if (capFull) return `Tomorrow your 🧊 freeze limit goes up to ${banked + 1}, and you earn a freeze to fill it.`;
    if (nth) return `Tomorrow earns a ${nth} 🧊 streak freeze.`;
    return "Tomorrow earns a 🧊 freeze, which saves your streak on a day you miss.";
  }

  // Only for a streak worth resting: a lost one has nothing for Saturday to keep.
  const rest = days > 0 ? restDayProgress(streak, today) : null;
  if (rest?.needed === 0 && rest.saturday === addDays(today, 1)) {
    return "You've earned Saturday off: skip tomorrow and your streak is safe.";
  }
  if (rest?.needed === 1) return "Tomorrow earns Saturday off: skip it and your streak is safe.";
  if (rest && rest.needed > 1) return `${rest.needed} more days by Friday earns Saturday off.`;

  // A full cap only rises at 14 days, and a kept freeze is never more than
  // four weeks out.
  let freezeAway: number | undefined;
  for (let freezeDay = next + 1; freezeDay <= next + 28; freezeDay++) {
    if (keeps(freezeDay)) {
      freezeAway = freezeDay - days;
      break;
    }
  }
  const bestAway = best > days ? best - days + 1 : undefined;

  if (freezeAway !== undefined && (bestAway === undefined || freezeAway <= bestAway)) {
    if (capFull) return `${freezeAway} days until your 🧊 freeze limit goes up to ${banked + 1}.`;
    return `${freezeAway} days to ${nth ? `a ${nth}` : "your next"} 🧊 streak freeze.`;
  }
  if (bestAway !== undefined) return `${bestAway} days to beat your best streak of ${best}.`;
  if (days >= 2) return "This is your longest streak yet.";
  return "Play tomorrow to start a streak.";
}
