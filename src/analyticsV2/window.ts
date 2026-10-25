import type { DateRange } from "../components/analyticsFormat";
import { addDays } from "./scorecard";

/**
 * The window picked at the top of /analyticsV2 and /experimentsV2: today so
 * far, the past N closed days, two dates, or -- on /experimentsV2 only --
 * everything since the experiment started. Its own file, apart from
 * WindowPicker.tsx, so that module exports only a component and fast refresh
 * keeps working.
 */
export type Choice =
  | { kind: "all" }
  | { kind: "today" }
  | { kind: "past"; days: number }
  | ({ kind: "range" } & DateRange);

export interface Preset {
  label: string;
  choice: Choice;
}

export const TODAY: Preset = { label: "Today", choice: { kind: "today" } };
export const PAST_7: Preset = { label: "Past 7 days", choice: { kind: "past", days: 7 } };
export const PAST_30: Preset = { label: "Past 30 days", choice: { kind: "past", days: 30 } };
export const SINCE_START: Preset = { label: "Since it started", choice: { kind: "all" } };

/**
 * The days a choice covers, both ends counted, or null for everything. The
 * past N days are closed ones: today is still filling up.
 */
export function spanOf(choice: Choice, today: string): DateRange | null {
  if (choice.kind === "all") return null;
  if (choice.kind === "today") return { from: today, to: today };
  if (choice.kind === "past") return { from: addDays(today, -choice.days), to: addDays(today, -1) };
  return { from: choice.from, to: choice.to };
}

export function samePreset(a: Choice, b: Choice): boolean {
  return a.kind === b.kind && (a.kind !== "past" || (b.kind === "past" && a.days === b.days));
}

export function sameSpan(a: DateRange | null, b: DateRange | null): boolean {
  return a === null || b === null ? a === b : a.from === b.from && a.to === b.to;
}

export function daysIn(span: DateRange): number {
  return Math.round((Date.parse(span.to) - Date.parse(span.from)) / 86_400_000) + 1;
}

/** A window in words, for the section notes. */
export function describe(span: DateRange, today: string): string {
  if (span.from === today && span.to === today) return "Today so far";
  if (span.from === span.to) return `On ${span.from}`;
  if (span.to === addDays(today, -1)) return `Past ${daysIn(span)} days`;
  return `${span.from} to ${span.to}${span.to === today ? " (today so far)" : ""}`;
}

/** `describe`'s words mid-sentence. */
export function lower(label: string): string {
  return /^(Today|Past|On) /.test(label) ? label[0].toLowerCase() + label.slice(1) : `from ${label}`;
}
