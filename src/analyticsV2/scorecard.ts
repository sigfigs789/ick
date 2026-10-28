import type { Day, Range, Rate, Report, Week } from "./report";

/**
 * The scorecard: seven categories, each with the three bands a small daily
 * browser word game is held to, and where WordInk stands.
 *
 * The bands are as given, and leave gaps: D1 of 20% is past going nowhere
 * (under 15%) but short of promising (25%). A number in a gap is "In between",
 * not rounded into a band; a number past promising's top but short of great
 * is still promising. Where the table gives words rather than numbers --
 * sharing, and "flat" growth -- the numbers are this page's, and the row says
 * what they are.
 *
 * Every row but activation is over players, the visitors who banked a word.
 * Activation is the step before: of first-time visitors, how many became one.
 *
 * The rows are over the window picked at the top of the page, but for the two
 * that name their own weeks: the DAU trend and weekly regulars.
 */

export type Standing = "nowhere" | "between" | "promising" | "great";

export const STANDING_NAMES: Record<Standing, string> = {
  nowhere: "Going nowhere",
  between: "In between",
  promising: "Promising",
  great: "Great shape",
};

export interface Row {
  metric: string;
  bands: Record<"nowhere" | "promising" | "great", string>;
  /** The number as shown, or null when there is too little to judge. */
  value: string | null;
  /** The same number as the whole percent it is shown as, for comparing one day's scorecard with the next. */
  points: number | null;
  standing: Standing | null;
  /** What the number is over, or what is missing for one. */
  detail: string;
  /** How it is measured. */
  how: string;
}

/** Below `nowhere` is going nowhere, from `promising` promising, from `great` great; between the first two, in between. */
export interface Marks {
  nowhere: number;
  promising: number;
  great: number;
}

export const D1_MARKS: Marks = { nowhere: 0.15, promising: 0.25, great: 0.4 };
export const D7_MARKS: Marks = { nowhere: 0.05, promising: 0.1, great: 0.2 };
/** Coming back within a week is not in the table, so these marks are the page's. */
export const WEEK_MARKS: Marks = { nowhere: 0.25, promising: 0.35, great: 0.5 };
/** Nor is coming back within a month, so these marks are the page's too. */
export const MONTH_MARKS: Marks = { nowhere: 0.3, promising: 0.4, great: 0.55 };
/** Activation is not in the table, so these marks are the page's. */
export const ACTIVATION_MARKS: Marks = { nowhere: 0.3, promising: 0.4, great: 0.6 };
/** Nor is coming back after a break, so these marks are the page's. */
export const BREAK_MARKS: Marks = { nowhere: 0.05, promising: 0.1, great: 0.2 };
/** Sharing has no great mark of its own: great is consistent sharing that also brings players. */
export const SHARE_MARKS: Marks = { nowhere: 0.05, promising: 0.1, great: Infinity };

/** A share as the whole percent it is shown as, so a "25%" is never judged under 25%. */
const whole = (share: number): number => Math.round(share * 100);

export function stand(share: number, marks: Marks): Standing {
  const n = whole(share);
  if (n >= whole(marks.great)) return "great";
  if (n >= whole(marks.promising)) return "promising";
  if (n >= whole(marks.nowhere)) return "between";
  return "nowhere";
}

export function percent(share: number, signed = false): string {
  const n = whole(share);
  if (!signed) return `${n}%`;
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
}

export const count = (n: number): string => n.toLocaleString("en-US");

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Sunday that ends the last full week, Monday to Sunday, before `today`'s. */
export function lastSunday(today: string): string {
  // getUTCDay is 0 on a Sunday, so this steps back to the Monday on or before today, then one more.
  return addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - 1);
}

/** The average of `field` a day over the `n` days ending `end`, or null when the report does not cover them all. */
export function average(daily: Day[], end: string, n: number, field: "players" | "visitors" = "players"): number | null {
  const from = addDays(end, 1 - n);
  const span = daily.filter((d) => d.date >= from && d.date <= end);
  return span.length === n ? span.reduce((sum, d) => sum + d[field], 0) / n : null;
}

/**
 * The numbers the window moves, as the report counted them: the reader's
 * range, or the last 28 closed days from a database that does not count one.
 */
export function windowOf(report: Report): Range {
  return (
    report.range ?? {
      from: addDays(report.today, -28),
      to: addDays(report.today, -1),
      window: report.window,
      sources: report.sources,
      scores: report.scores,
      retention: report.retention,
      prior: null,
    }
  );
}

/** The least cohort a rate is judged over; under it the row says it is too early. */
export const LEAST = 30;

function retentionRow(metric: string, n: number, rate: Rate, bands: Row["bands"], marks: Marks): Row {
  const ok = rate.cohort >= LEAST;
  return {
    metric,
    bands,
    value: ok ? percent(rate.returned / rate.cohort) : null,
    points: ok ? whole(rate.returned / rate.cohort) : null,
    standing: ok ? stand(rate.returned / rate.cohort, marks) : null,
    detail: ok
      ? `${count(rate.returned)} of ${count(rate.cohort)} new players`
      : `needs ${LEAST} new players in the window whose day ${n} is over`,
    how: `Players whose first word was in the window, with day ${n} over, and who banked a word again exactly ${n} ${n === 1 ? "day" : "days"} later.`,
  };
}

/**
 * DAU trend: daily players averaged over the last four full weeks against the
 * four before, as a monthly rate.
 */
export function dauTrend(report: Report): { change: number; recent: number; before: number } | null {
  const end = lastSunday(report.today);
  const recent = average(report.daily, end, 28);
  const before = average(report.daily, addDays(end, -28), 28);
  if (recent === null || before === null || before === 0) return null;
  // Four weeks is 28 days; a month is 30.44.
  return { change: (recent / before) ** (30.44 / 28) - 1, recent, before };
}

/** The share of a week's players who banked a word on 3 or more of its 7 days. */
export function regulars(week: Week): { regulars: number; players: number } {
  const regular = Object.entries(week.daysPlayed)
    .filter(([days]) => Number(days) >= 3)
    .reduce((sum, [, n]) => sum + n, 0);
  return { regulars: regular, players: week.players };
}

/** New players whose first visit came through a share link, and all new players, over the window. */
export function sharePlayers(span: Range): { fromShares: number; all: number } {
  const recent = span.sources;
  return {
    fromShares: recent.filter((s) => s.source === "share" || s.source === "t").reduce((sum, s) => sum + s.recentPlayers, 0),
    all: recent.reduce((sum, s) => sum + s.recentPlayers, 0),
  };
}

export function scorecard(report: Report, span: Range = windowOf(report)): Row[] {
  const r = span.retention ?? report.retention;
  const trend = dauTrend(report);
  const w = span.window;
  const shares = sharePlayers(span);
  const shareRate = w.playerDays > 0 ? w.sharedDays / w.playerDays : 0;
  const driven = shares.all > 0 ? shares.fromShares / shares.all : 0;
  const lastWeek = report.weekly[1];
  const reg = lastWeek ? regulars(lastWeek) : null;
  const lost = w.lapsed;
  const backOk = lost !== null && lost.cohort >= LEAST;

  return [
    {
      metric: "Activation",
      bands: { nowhere: "Under 30%", promising: "40–59%", great: "60%+" },
      value: w.firstVisits >= LEAST ? percent(w.firstVisitPlayed / w.firstVisits) : null,
      points: w.firstVisits >= LEAST ? whole(w.firstVisitPlayed / w.firstVisits) : null,
      standing: w.firstVisits >= LEAST ? stand(w.firstVisitPlayed / w.firstVisits, ACTIVATION_MARKS) : null,
      detail:
        w.firstVisits >= LEAST
          ? `${count(w.firstVisitPlayed)} of ${count(w.firstVisits)} first-time visitors banked a word`
          : `needs ${LEAST} first-time visitors`,
      how:
        "Of first-time visitors in the window, the share who banked a word. The table has no activation row, so " +
        "these marks are the page's: under 30% is going nowhere, 40% promising, 60% great.",
    },
    retentionRow("D1 retention", 1, r.d1.players, { nowhere: "Under 15%", promising: "25–35%", great: "40%+" }, D1_MARKS),
    retentionRow("D7 retention", 7, r.d7.players, { nowhere: "Under 5%", promising: "10–15%", great: "20%+" }, D7_MARKS),
    {
      ...retentionRow("Back within a week", 7, r.week.players, { nowhere: "Under 25%", promising: "35–49%", great: "50%+" }, WEEK_MARKS),
      how:
        "Players whose first word was in the window, with day 7 over, and who banked a word again on any of the 7 days after. The " +
        "table has no row for it, so these marks are the page's: under 25% is going nowhere, 35% promising, 50% great.",
    },
    retentionRow("D30 retention", 30, r.d30.players, { nowhere: "Under 2%", promising: "5–8%", great: "10%+" }, {
      nowhere: 0.02,
      promising: 0.05,
      great: 0.1,
    }),
    {
      ...retentionRow("Back within a month", 30, r.month.players, { nowhere: "Under 30%", promising: "40–54%", great: "55%+" }, MONTH_MARKS),
      how:
        "Players whose first word was in the window, with day 30 over, and who banked a word again on any of the 30 days after. The " +
        "table has no row for it, so these marks are the page's: under 30% is going nowhere, 40% promising, 55% great.",
    },
    {
      metric: "DAU trend over 8 weeks",
      bands: { nowhere: "Flat or falling", promising: "Growing 5–10%/mo", great: "Growing 20%+/mo" },
      value: trend ? `${percent(trend.change, true)}/mo` : null,
      points: trend ? whole(trend.change) : null,
      standing: trend ? stand(trend.change, { nowhere: 0.02, promising: 0.05, great: 0.2 }) : null,
      detail: trend
        ? `${trend.recent.toFixed(1)} players a day over the last 4 full weeks, from ${trend.before.toFixed(1)} the 4 before`
        : "needs 8 full weeks of days",
      how: "Daily players averaged over the last four full weeks against the four before, as a monthly rate. Under +2% is flat.",
    },
    {
      metric: "Players sharing results",
      bands: { nowhere: "Rarely", promising: "Consistent sharing", great: "Shares drive measurable new players" },
      value: w.playerDays >= LEAST ? percent(shareRate) : null,
      points: w.playerDays >= LEAST ? whole(shareRate) : null,
      standing:
        w.playerDays < LEAST
          ? null
          : whole(shareRate) >= 10 && whole(driven) >= 10
            ? "great"
            : stand(shareRate, SHARE_MARKS),
      detail:
        `${percent(shareRate)} of player-days had a share; share links brought ${count(shares.fromShares)} of ` +
        `${count(shares.all)} new players (${percent(driven)})`,
      how:
        "The table gives words, so these marks are the page's: rarely is under 5% of player-days shared, consistent " +
        "is 10% or more, and great is consistent sharing with share links bringing 10% or more of new players. Over the window.",
    },
    {
      metric: "Weekly regulars*",
      bands: { nowhere: "Under 10%", promising: "20–30%", great: "40%+" },
      value: reg && reg.players >= LEAST ? percent(reg.regulars / reg.players) : null,
      points: reg && reg.players >= LEAST ? whole(reg.regulars / reg.players) : null,
      standing: reg && reg.players >= LEAST ? stand(reg.regulars / reg.players, { nowhere: 0.1, promising: 0.2, great: 0.4 }) : null,
      detail: reg ? `${count(reg.regulars)} of ${count(reg.players)} players last full week` : "needs a full week",
      how: "*Of the last full week's players (Monday to Sunday), the share who banked a word on 3 or more of its 7 days.",
    },
    {
      metric: "Back after a break",
      bands: { nowhere: "Under 5%", promising: "10–19%", great: "20%+" },
      value: backOk ? percent(lost.returned / lost.cohort) : null,
      points: backOk ? whole(lost.returned / lost.cohort) : null,
      standing: backOk ? stand(lost.returned / lost.cohort, BREAK_MARKS) : null,
      detail:
        lost === null
          ? "needs the 2026-11-16 migration"
          : lost.cohort >= LEAST
            ? `${count(lost.returned)} of ${count(lost.cohort)} lost players came back`
            : `needs ${LEAST} lost players`,
      how:
        "Players lost when the window began -- a word banked before, but none in the 7 days just before it -- and the " +
        "share who banked a word in the window. New players are in neither number. The table has no row for it, so " +
        "these marks are the page's: under 5% is going nowhere, 10% promising, 20% great.",
    },
  ];
}

/**
 * How a row moved since yesterday's scorecard, in the percentage points it is
 * shown in, so the change always agrees with the two numbers a reader could
 * compare. Null when either day had too little to judge.
 *
 * The rows over the last full week (DAU trend, weekly regulars) only move on a
 * Monday; the rest move every day as the window slides, or not at all over two
 * fixed dates that are both past.
 */
export function moved(now: Row, before: Row | undefined): number | null {
  if (now.points === null || before?.points == null) return null;
  return now.points - before.points;
}
