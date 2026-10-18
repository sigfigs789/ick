/**
 * The analytics page's windows and number formats. Kept apart from the page so
 * the page file exports components only.
 */

export function dowOf(date: string): number {
  // Noon UTC, so the weekday is the calendar date's in every zone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A date `n` days from `date`, both YYYY-MM-DD. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * What the window picker can hold: one puzzle some days back (0 is today), the
 * puzzles within a span ending today (null is all time), or a picked range.
 */
export type AnalyticsWindow =
  | { kind: "day"; ago: number }
  | { kind: "span"; days: number | null }
  | { kind: "range"; from: string; to: string };

/** Today, then one puzzle at a time back a week. */
export const DAYS_AGO = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export const SPANS: ReadonlyArray<{ days: number | null; label: string }> = [
  { days: 7, label: "Within 1 week" },
  { days: 14, label: "Within 2 weeks" },
  { days: 30, label: "Within 1 month" },
  { days: null, label: "All time" },
];

export function daysAgoLabel(ago: number): string {
  return ago === 0 ? "Today" : ago === 1 ? "1 day" : `${ago} days`;
}

/** The window's first and last puzzle, both counted. A null `from` is all time. */
export function windowDates(window: AnalyticsWindow, today: string): { from: string | null; to: string } {
  if (window.kind === "day") {
    const day = addDays(today, -window.ago);
    return { from: day, to: day };
  }
  if (window.kind === "span") {
    return { from: window.days === null ? null : addDays(today, 1 - window.days), to: today };
  }
  return { from: window.from, to: window.to };
}

/** Calendar days picked in place of a preset, both ends counted. */
export interface DateRange {
  from: string;
  to: string;
}

/** The range after one end moves: the other end follows when it would cross. */
export function moveRange(current: DateRange, end: "from" | "to", value: string): DateRange {
  if (end === "from") return { from: value, to: value > current.to ? value : current.to };
  return { from: value < current.from ? value : current.from, to: value };
}

/**
 * Two-sided p-value for a difference between two proportions (`x1` of `n1`
 * against `x2` of `n2`), by the pooled two-proportion z-test. Null when either
 * side is empty or the pooled rate is 0 or 1, where the test says nothing.
 * The normal approximation is rough for small arms; the page shows the counts
 * beside it so a p-value over a handful of players reads as what it is.
 */
export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  if (pooled <= 0 || pooled >= 1) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = Math.abs(x1 / n1 - x2 / n2) / se;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

/** The standard normal CDF, by Abramowitz and Stegun 7.1.26 (error < 1.5e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
