import type { AnalyticsReport, Rate } from "../game/review";

/**
 * The analytics page's words and number formats, and the few sentences it
 * leads with. Kept apart from the page so the page file exports components
 * only, and so the highlight rules can be tested on a report without a render.
 */

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const MODE_NAMES: Record<string, string> = { standard: "Standard", freeform: "Freeform" };

/**
 * Below this many people a rate is shown but not ranked: two of three is 67%,
 * and a "best day" picked off it is noise wearing a percentage.
 */
const MIN_RATE_COHORT = 20;

/**
 * A few sentences pulled out of the numbers, so the page leads with what is
 * worth knowing rather than leaving it in a table. Each only fires on a cohort
 * large enough to mean it (MIN_RATE_COHORT).
 */
export function findHighlights(report: AnalyticsReport): string[] {
  const lines: string[] = [];
  const rated = report.weekday.filter((w) => w.nextDay.cohort >= MIN_RATE_COHORT);
  if (rated.length >= 2) {
    const byRate = [...rated].sort((a, b) => ratio(b.nextDay) - ratio(a.nextDay));
    const best = byRate[0];
    const worst = byRate[byRate.length - 1];
    if (ratio(best.nextDay) - ratio(worst.nextDay) >= 0.05) {
      lines.push(
        `${WEEKDAYS[best.dow]} players come back the next day most often (${pct(ratio(best.nextDay))}); ${WEEKDAYS[worst.dow]} players least (${pct(ratio(worst.nextDay))}).`,
      );
    }
  }
  const busy = report.weekday.filter((w) => w.avgPlayers !== null && w.puzzles > 0);
  if (busy.length >= 2) {
    const sorted = [...busy].sort((a, b) => (b.avgPlayers ?? 0) - (a.avgPlayers ?? 0));
    const top = sorted[0];
    const low = sorted[sorted.length - 1];
    if ((low.avgPlayers ?? 0) > 0 && (top.avgPlayers ?? 0) / (low.avgPlayers ?? 1) >= 1.15) {
      lines.push(
        `${WEEKDAYS[top.dow]} is the busiest puzzle (${dec(top.avgPlayers, 0)} players on average), ${WEEKDAYS[low.dow]} the quietest (${dec(low.avgPlayers, 0)}).`,
      );
    }
  }
  const modes = report.modes.filter((m) => m.nextDay.cohort >= MIN_RATE_COHORT);
  if (modes.length === 2) {
    const [a, b] = [...modes].sort((x, y) => ratio(y.nextDay) - ratio(x.nextDay));
    const gap = ratio(a.nextDay) - ratio(b.nextDay);
    if (gap >= 0.03) {
      lines.push(
        `A ${MODE_NAMES[a.mode] ?? a.mode} day is followed by another play ${pct(ratio(a.nextDay))} of the time, against ${pct(ratio(b.nextDay))} for ${MODE_NAMES[b.mode] ?? b.mode}.`,
      );
    }
  }
  const { d1 } = report.retention;
  if (d1.cohort >= MIN_RATE_COHORT) {
    lines.push(`${pct(ratio(d1))} of new players come back for their second puzzle the next day.`);
  }
  const oneDay = report.depth.find((d) => d.bucket === "1 day");
  if (oneDay && report.totals.players >= MIN_RATE_COHORT) {
    lines.push(`${pct(oneDay.players / report.totals.players)} of everyone who has played has played exactly once.`);
  }
  // Engaged fires at most once per session and a visit is a session, so a share
  // over one means the two counts have drifted apart and ranking on it is wrong.
  const sources = report.sources.filter(
    (s) => s.visits >= MIN_RATE_COHORT && s.engaged <= s.visits,
  );
  if (sources.length >= 2) {
    const best = [...sources].sort((a, b) => b.engaged / b.visits - a.engaged / a.visits)[0];
    lines.push(`Visits from ${best.source} engage the most: ${pct(best.engaged / best.visits)} engaged per visit.`);
  }
  return lines;
}

function ratio(rate: Rate): number {
  return rate.cohort ? rate.returned / rate.cohort : 0;
}

export function dowOf(date: string): number {
  // Noon UTC, so the weekday is the calendar date's in every zone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function dec(n: number | null, places: number): string {
  return n === null ? "—" : n.toFixed(places);
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function duration(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
