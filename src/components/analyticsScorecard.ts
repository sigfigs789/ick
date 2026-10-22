import type { AnalyticsReport, Cohort, GameplayReport, Rate, WeekActives } from "../game/review";
import { addDays, SHARE_SOURCES } from "./analyticsFormat";

/**
 * The scorecard /analyticsV2 draws: six categories, each with the bands for a
 * small daily browser word game (going nowhere, promising, great shape) and
 * where the game stands against them.
 *
 * The bands are rules of thumb the maintainer was handed, not anything measured
 * here. They leave gaps -- next-day return of 15% is past going nowhere but
 * short of promising's 25% -- and a number in a gap is called "In between"
 * rather than rounded into a band. A number past promising but short of great
 * is still promising.
 *
 * The numbers come from `analytics_overview` over the last eight weeks (see
 * `SCORECARD_DAYS`), and D1, D7 and D30 from `analytics_gameplay`: strict day-N
 * returns. Until that function is in the database, D1 is read from the
 * overview's days and D7 and D30 from its weekly cohorts -- "back the week
 * after arriving", "back in the fourth week after" -- and each says so.
 */

export type Standing = "nowhere" | "between" | "promising" | "great";

export const STANDING_NAMES: Record<Standing, string> = {
  nowhere: "Going nowhere",
  between: "In between",
  promising: "Promising",
  great: "Great shape",
};

export interface ScorecardRow {
  metric: string;
  /** The table's three bands, as written. */
  bands: { nowhere: string; promising: string; great: string };
  /** The number, as shown, or null when there is too little to judge. */
  value: string | null;
  standing: Standing | null;
  /** What the number is over, under it: "of 412 new players". */
  detail: string;
  /** How it is measured, when that is not the metric's plain meaning. */
  howMeasured: string;
  /** What is missing, when there is no standing. */
  needs?: string;
}

/** The closed days the scorecard reads: eight weeks of puzzles before today's. */
export const SCORECARD_DAYS = 56;

/** The window to fetch for the scorecard: those eight weeks, and today's puzzle after them. */
export function scorecardWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -SCORECARD_DAYS), to: today };
}

/**
 * The marks a number is banded by: under `nowhere` is going nowhere, from
 * `promising` is promising, from `great` is great, and anything between the
 * first two is in between.
 */
interface Marks {
  nowhere: number;
  promising: number;
  great: number;
}

/** A share as a whole percent, the way it is shown, so a "25%" is never judged under 25%. */
function percent(share: number): number {
  return Math.round(share * 100);
}

function stand(share: number, marks: Marks): Standing {
  const n = percent(share);
  if (n >= percent(marks.great)) return "great";
  if (n >= percent(marks.promising)) return "promising";
  if (n >= percent(marks.nowhere)) return "between";
  return "nowhere";
}

function shown(share: number, signed = false): string {
  const n = percent(share);
  if (!signed) return `${n}%`;
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The report's days from `from` to `to`, both ends counted. */
function days(report: AnalyticsReport, from: string, to: string) {
  return report.daily.filter((d) => d.date >= from && d.date <= to);
}

const RETENTION = {
  d1: { metric: "D1 retention", bands: { nowhere: "Under 15%", promising: "25–35%", great: "40%+" }, marks: { nowhere: 0.15, promising: 0.25, great: 0.4 } },
  d7: { metric: "D7 retention", bands: { nowhere: "Under 5%", promising: "10–15%", great: "20%+" }, marks: { nowhere: 0.05, promising: 0.1, great: 0.2 } },
  d30: { metric: "D30 retention", bands: { nowhere: "Under 2%", promising: "5–8%", great: "10%+" }, marks: { nowhere: 0.02, promising: 0.05, great: 0.1 } },
} as const;

/** Day N retention, strictly: of the players who arrived in the 28 days before day N closed, the share back on day N. */
export function strictRetentionRow(day: "d1" | "d7" | "d30", rate: Rate): ScorecardRow {
  const least = 50;
  const n = day.slice(1);
  const ok = rate.cohort >= least;
  const { metric, bands, marks } = RETENTION[day];
  return {
    metric,
    bands,
    value: ok ? shown(rate.returned / rate.cohort) : null,
    standing: ok ? stand(rate.returned / rate.cohort, marks) : null,
    detail: `${plural(rate.returned, "player")} of ${plural(rate.cohort, "new player")} came back on day ${n}`,
    howMeasured: `New players who arrived over 28 days and played again exactly ${n} ${n === "1" ? "day" : "days"} after their first.`,
    needs: ok ? undefined : `${least} new players whose day ${n} is over`,
  };
}

/** D1: of the new players whose next puzzle is over, the share who played it. Last four weeks. */
export function d1Row(report: AnalyticsReport, today: string): ScorecardRow {
  const least = 20;
  // A day's next-day count is final once the puzzle after it is over.
  const span = days(report, addDays(today, -29), addDays(today, -2));
  const arrived = span.reduce((sum, d) => sum + d.groups.new.players, 0);
  const back = span.reduce((sum, d) => sum + d.groups.new.nextDay, 0);
  const ok = arrived >= least;
  return {
    metric: "D1 retention",
    bands: { nowhere: "Under 15%", promising: "25–35%", great: "40%+" },
    value: ok ? shown(back / arrived) : null,
    standing: ok ? stand(back / arrived, { nowhere: 0.15, promising: 0.25, great: 0.4 }) : null,
    detail: `${plural(back, "player")} of ${plural(arrived, "new player")} played their second day's puzzle`,
    howMeasured: "New players over the last four weeks who played the very next puzzle.",
    needs: ok ? undefined : `${least} new players whose next puzzle is over`,
  };
}

/** Cohorts whose `k`th week after arriving is over, newest first, up to four of them. */
function closedCohorts(cohorts: Cohort[], k: number): Cohort[] {
  // weeks[k - 1] is final once the week after it has started counting.
  return cohorts.filter((c) => c.weeks.length > k).slice(0, 4);
}

function cohortRow(
  cohorts: Cohort[],
  k: number,
  row: Pick<ScorecardRow, "metric" | "bands" | "howMeasured">,
  marks: Marks,
): ScorecardRow {
  const least = 50;
  const closed = closedCohorts(cohorts, k);
  const arrived = closed.reduce((sum, c) => sum + c.players, 0);
  const back = closed.reduce((sum, c) => sum + c.weeks[k - 1].players, 0);
  const ok = arrived >= least;
  return {
    ...row,
    value: ok ? shown(back / arrived) : null,
    standing: ok ? stand(back / arrived, marks) : null,
    detail: `${plural(back, "player")} of ${plural(arrived, "arrival")} over ${plural(closed.length, "week")}`,
    needs: ok ? undefined : `${least} arrivals whose week ${k} is over`,
  };
}

/** D7, read as the share of arrivals who turned up the week after the week they arrived. */
export function d7Row(report: AnalyticsReport): ScorecardRow {
  return cohortRow(
    report.cohorts,
    1,
    {
      metric: "D7 retention",
      bands: { nowhere: "Under 5%", promising: "10–15%", great: "20%+" },
      howMeasured:
        "Nearest the report has: of players arriving in a week, the share who played any day of the week after. " +
        "A whole week to come back in, so it reads higher than a strict day-7 return. Last four arrival weeks.",
    },
    { nowhere: 0.05, promising: 0.1, great: 0.2 },
  );
}

/** D30, read as the share of arrivals who turned up in the fourth week after the week they arrived. */
export function d30Row(report: AnalyticsReport): ScorecardRow {
  return cohortRow(
    report.cohorts,
    4,
    {
      metric: "D30 retention",
      bands: { nowhere: "Under 2%", promising: "5–8%", great: "10%+" },
      howMeasured:
        "Nearest the report has: of players arriving in a week, the share who played any day of the fourth week " +
        "after (days 22 to 34 or so). A whole week to come back in, so it reads higher than a strict day-30 return. " +
        "Last four arrival weeks old enough to have one.",
    },
    { nowhere: 0.02, promising: 0.05, great: 0.1 },
  );
}

/** DAU trend: average daily active players (banked a word) over the last four weeks against the four before. */
export function dauRow(report: AnalyticsReport, today: string): ScorecardRow {
  // Today's puzzle is still filling up, so the weeks end yesterday.
  const recent = days(report, addDays(today, -28), addDays(today, -1));
  const before = days(report, addDays(today, -56), addDays(today, -29));
  const avg = (span: typeof recent) => span.reduce((sum, d) => sum + d.groups.all.guessed, 0) / span.length;
  const ok = recent.length === 28 && before.length === 28 && avg(before) > 0;
  const change = ok ? avg(recent) / avg(before) - 1 : 0;
  return {
    metric: "DAU trend over 8 weeks",
    bands: { nowhere: "Flat or falling", promising: "Growing 5–10%/mo", great: "Growing 20%+/mo" },
    value: ok ? `${shown(change, true)}/mo` : null,
    standing: ok ? stand(change, { nowhere: 0.02, promising: 0.05, great: 0.2 }) : null,
    detail: ok
      ? `${Math.round(avg(recent)).toLocaleString("en-US")} active players a day, from ` +
        `${Math.round(avg(before)).toLocaleString("en-US")} the four weeks before`
      : "",
    howMeasured:
      "Average daily active players (banked a word) over the last four weeks, to yesterday, against the four weeks before. " +
      "Under +2% counts as flat.",
    needs: ok ? undefined : "eight full weeks of puzzles",
  };
}

/**
 * Sharing: how often a guesser shares, and whether share links bring new
 * players. The table gives no numbers for this row, so the marks are the
 * page's own: under 5% of guessing days shared is rare, 10% is consistent, and
 * great is share links bringing 10% or more of the new players.
 */
export function sharingRow(report: AnalyticsReport, today: string): ScorecardRow {
  const least = 50;
  const span = days(report, addDays(today, -28), addDays(today, -1));
  const guessed = span.reduce((sum, d) => sum + d.groups.all.guessed, 0);
  const shared = span.reduce((sum, d) => sum + d.groups.all.shared, 0);
  const newPlayers = report.sources.reduce((sum, s) => sum + s.players, 0);
  const fromShares = report.sources.filter((s) => SHARE_SOURCES.has(s.source)).reduce((sum, s) => sum + s.players, 0);
  const ok = guessed >= least;
  const rate = ok ? shared / guessed : 0;
  const drive = newPlayers > 0 ? fromShares / newPlayers : 0;
  const standing: Standing | null = !ok
    ? null
    : percent(drive) >= 10
      ? "great"
      : stand(rate, { nowhere: 0.05, promising: 0.1, great: Infinity });
  return {
    metric: "Players sharing results",
    bands: { nowhere: "Rarely", promising: "Consistent sharing", great: "Shares drive measurable new players" },
    value: ok ? shown(rate) : null,
    standing,
    detail:
      `of guessing days shared (last four weeks); share links brought ` +
      `${plural(fromShares, "new player")}, ${shown(drive)} of the last eight weeks' ${newPlayers.toLocaleString("en-US")}`,
    howMeasured:
      "The table gives no numbers here, so these are the page's own: rarely is under 5% of guessing days shared, " +
      "consistent is 10% or more, and great shape is share links bringing 10% or more of new players.",
    needs: ok ? undefined : `${least} guessing days in the last four weeks`,
  };
}

/** Weekly regulars: of each full week's guessers, the share who banked a word on 4 or more of its puzzles. */
export function regularsRow(weekly: WeekActives[]): ScorecardRow {
  const least = 20;
  // weekly[0] is the week still counting up.
  const weeks = weekly.slice(1, 5);
  const played = weeks.reduce((sum, w) => sum + w.played.oneDay + w.played.twoToThree + w.played.fourPlus, 0);
  const regulars = weeks.reduce((sum, w) => sum + w.played.fourPlus, 0);
  const ok = played >= least;
  return {
    metric: "Weekly regulars*",
    bands: { nowhere: "Under 10%", promising: "20–30%", great: "40%+" },
    value: ok ? shown(regulars / played) : null,
    standing: ok ? stand(regulars / played, { nowhere: 0.1, promising: 0.2, great: 0.4 }) : null,
    detail: `${plural(regulars, "regular")} of ${plural(played, "weekly guesser")} over ${plural(weeks.length, "full week")}`,
    howMeasured:
      "*Of each week's players who banked a word, the share who did on 4 or more of its 7 puzzles. " +
      "Last four full weeks, Sunday to Saturday.",
    needs: ok ? undefined : `${least} guessers over the last full weeks`,
  };
}

/** The whole scorecard, in the table's order. */
export function scorecard(report: AnalyticsReport, gameplay: GameplayReport | null, today: string): ScorecardRow[] {
  const r = gameplay?.retention;
  return [
    r ? strictRetentionRow("d1", r.d1) : d1Row(report, today),
    r ? strictRetentionRow("d7", r.d7) : d7Row(report),
    r ? strictRetentionRow("d30", r.d30) : d30Row(report),
    dauRow(report, today),
    sharingRow(report, today),
    regularsRow(report.weekly),
  ];
}
