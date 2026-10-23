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

/**
 * The change from `before` to `now` as a signed percent, or a dash when there
 * was nothing before to grow from.
 */
export function growth(now: number, before: number | undefined): string {
  if (before === undefined || before === 0) return "–";
  const change = Math.round(((now - before) / before) * 100);
  return change > 0 ? `+${change}%` : change < 0 ? `−${-change}%` : "0%";
}

/**
 * The first-touch sources a share link sets: the `s=` codes of game/share.ts,
 * without their mode suffix (see arrivalSource in game/visits.ts).
 */
export const SHARE_SOURCES: ReadonlySet<string> = new Set(["share", "t"]);

const SOURCE_NAMES: Record<string, string> = {
  share: "Share link",
  t: "Share link on X",
  direct: "Direct (no link or referrer)",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  reddit: "Reddit",
  twitter: "X",
  facebook: "Facebook",
};

/** A first-touch source as the page names it; an unknown one is its bare host or code. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
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
