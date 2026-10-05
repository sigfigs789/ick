import { MAX_RANGE_DAYS, rangeDays } from "../game/review";

/**
 * The analytics page's words and number formats. Kept apart from the page so
 * the page file exports components only.
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
 * The report's `direct` is every visit with no source code, no utm_source and
 * no outside referrer -- mostly links opened from apps that send no referrer,
 * not typed URLs -- so it is shown for what it is.
 */
export function sourceName(source: string): string {
  return source === "direct" ? "unattributed" : source;
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
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  // Totals summed across many sessions (time in chat) run to hours.
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Calendar days picked in place of a preset, both ends counted. */
export interface DateRange {
  from: string;
  to: string;
}

/** A date `n` days from `date`, both YYYY-MM-DD. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The range after one end moves: the other end follows when it would cross,
 * or when the span would pass a year, so every edit leaves a range the
 * endpoint takes.
 */
export function moveRange(current: DateRange, end: "from" | "to", value: string): DateRange {
  if (end === "from") {
    const to = value > current.to ? value : current.to;
    return { from: value, to: rangeDays(value, to) > MAX_RANGE_DAYS ? addDays(value, MAX_RANGE_DAYS - 1) : to };
  }
  const from = value < current.from ? value : current.from;
  return { from: rangeDays(from, value) > MAX_RANGE_DAYS ? addDays(value, 1 - MAX_RANGE_DAYS) : from, to: value };
}
