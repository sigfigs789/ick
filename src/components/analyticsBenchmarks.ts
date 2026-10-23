import type { Cohort, KeyMetrics, MuseReport, Rate, SourceRow, WeekActives } from "../game/review";
import { SHARE_SOURCES } from "./analyticsFormat";

/**
 * A bar for each section of the analytics page: one number it is judged on,
 * and the marks that make it weak, promising or great.
 *
 * The marks are rules of thumb for a small daily word game, not anything the
 * game's own history set: next-day return and weekly retention from what daily
 * puzzles and consumer apps commonly see, growth from the usual 5-7% a week an
 * early product aims for, and the tests read as a lift on the arm they are
 * against. Below a section's minimum there is too little to judge, and it says
 * so rather than calling noise weak.
 */

export type Verdict = "weak" | "promising" | "great";

export const VERDICTS: readonly Verdict[] = ["weak", "promising", "great"];

export interface Benchmark {
  /** The number judged, as shown: "26%". Null when there is too little to judge. */
  value: string | null;
  /** What the number is, said after it: "back for the next puzzle". */
  measure: string;
  verdict: Verdict | null;
  /** What each verdict needs, in the number's own unit. */
  criteria: Record<Verdict, string>;
  /** What is missing for a verdict, when there is none. */
  needs?: string;
}

/**
 * How a number is shown and banded: a share as a percent, a change in
 * percentage points, a growth rate, or a plain ratio. `lowerIsBetter` flips
 * the bands, for a number that is better small.
 */
interface Bar {
  unit: "pct" | "points" | "growth" | "ratio";
  /** The least a promising number is, and the least a great one is (the most, when lower is better). */
  promising: number;
  great: number;
  lowerIsBetter?: boolean;
}

/** The number as the bands read it: rounded to what is shown, so a "15%" is never under 15%. */
function shown(value: number, unit: Bar["unit"]): number {
  return unit === "ratio" ? Math.round(value * 100) / 100 : Math.round(value * 100);
}

function show(n: number, unit: Bar["unit"]): string {
  if (unit === "ratio") return n.toFixed(2);
  const sign = unit === "pct" ? "" : n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = unit === "pct" ? n : Math.abs(n);
  return unit === "points" ? `${sign}${abs} ${abs === 1 ? "pt" : "pts"}` : `${sign}${abs}%`;
}

function criteria(bar: Bar): Record<Verdict, string> {
  const lo = show(shown(bar.promising, bar.unit), bar.unit);
  const hi = show(shown(bar.great, bar.unit), bar.unit);
  return bar.lowerIsBetter
    ? { great: `under ${hi}`, promising: `${hi} to ${lo}`, weak: `${lo} or more` }
    : { weak: `under ${lo}`, promising: `${lo} to ${hi}`, great: `${hi} or more` };
}

function judge(value: number, bar: Bar): Verdict {
  const n = shown(value, bar.unit);
  const promising = shown(bar.promising, bar.unit);
  const great = shown(bar.great, bar.unit);
  if (bar.lowerIsBetter) return n < great ? "great" : n < promising ? "promising" : "weak";
  return n >= great ? "great" : n >= promising ? "promising" : "weak";
}

/** A benchmark for `value`, or a too-early one when it is null, saying what it `needs`. */
function benchmark(value: number | null, measure: string, bar: Bar, needs: string): Benchmark {
  if (value === null || !Number.isFinite(value)) {
    return { value: null, measure, verdict: null, criteria: criteria(bar), needs };
  }
  return { value: show(shown(value, bar.unit), bar.unit), measure, verdict: judge(value, bar), criteria: criteria(bar) };
}

function share(rate: Rate, least: number): number | null {
  return rate.cohort >= least ? rate.returned / rate.cohort : null;
}

/** Day by day: of the window's players, the share who banked a word. */
export function dayByDayBenchmark(all: KeyMetrics): Benchmark {
  const least = 20;
  return benchmark(
    all.players >= least ? all.guessed / all.players : null,
    "of players guessed",
    { unit: "pct", promising: 0.3, great: 0.5 },
    `${least} players in the window`,
  );
}

/** Key numbers: of everyone whose next day is over, the share who played the next puzzle. */
export function keyNumbersBenchmark(all: KeyMetrics): Benchmark {
  const least = 20;
  return benchmark(
    share(all.nextDay.rate, least),
    "back for the next puzzle",
    { unit: "pct", promising: 0.15, great: 0.3 },
    `${least} players whose next day is over`,
  );
}

/** Where new players come from: new players from share links, per player who shared. */
export function sourcesBenchmark(sources: SourceRow[], sharers: number): Benchmark {
  const least = 5;
  const fromShares = sources.filter((s) => SHARE_SOURCES.has(s.source)).reduce((sum, s) => sum + s.players, 0);
  return benchmark(
    sharers >= least ? fromShares / sharers : null,
    "new players per sharer",
    { unit: "ratio", promising: 0.2, great: 0.5 },
    `${least} players who shared`,
  );
}

/** Weeks the weekly benchmarks look back over, the week still counting up left out. */
const FULL_WEEKS = 4;

/** Growth: weekly active players' average change a week, over the latest full weeks. */
export function growthBenchmark(weekly: WeekActives[]): Benchmark {
  const latest = weekly[1]?.players.all;
  const before = weekly[1 + FULL_WEEKS]?.players.all;
  return benchmark(
    latest !== undefined && before ? (latest / before) ** (1 / FULL_WEEKS) - 1 : null,
    `a week (average of the last ${FULL_WEEKS} full weeks)`,
    { unit: "growth", promising: 0.02, great: 0.07 },
    `${FULL_WEEKS + 1} full weeks of players`,
  );
}

/** Retention by arrival week: of the latest arrivals whose week after is over, the share who turned up in it. */
export function cohortBenchmark(cohorts: Cohort[]): Benchmark {
  const least = 50;
  // weeks[0] is final once a later week has started counting.
  const closed = cohorts.filter((c) => c.weeks.length >= 2).slice(0, FULL_WEEKS);
  const arrived = closed.reduce((sum, c) => sum + c.players, 0);
  const back = closed.reduce((sum, c) => sum + c.weeks[0].players, 0);
  return benchmark(
    arrived >= least ? back / arrived : null,
    `back the week after arriving (last ${FULL_WEEKS} full weeks)`,
    { unit: "pct", promising: 0.1, great: 0.2 },
    `${least} arrivals whose week after is over`,
  );
}

/** Core players: of the latest full week's guessers, the share who played 4 or more of its puzzles. */
export function coreBenchmark(weekly: WeekActives[]): Benchmark {
  const least = 20;
  const week = weekly[1]?.played;
  const played = week ? week.oneDay + week.twoToThree + week.fourPlus : 0;
  return benchmark(
    week && played >= least ? week.fourPlus / played : null,
    "of last full week's guessers played 4+ days",
    { unit: "pct", promising: 0.15, great: 0.3 },
    `${least} guessers in the last full week`,
  );
}

/** Resurrected players: of the latest weeks' resurrected, with the week after over, the share who stayed. */
export function resurrectedBenchmark(weekly: WeekActives[]): Benchmark {
  const least = 10;
  const weeks = weekly.filter((w) => w.nextWeekOver).slice(0, FULL_WEEKS);
  const resurrected = weeks.reduce((sum, w) => sum + w.flow.resurrected, 0);
  const stayed = weeks.reduce((sum, w) => sum + w.flow.resurrectedStayed, 0);
  return benchmark(
    resurrected >= least ? stayed / resurrected : null,
    `of resurrected players stayed the week after (last ${FULL_WEEKS} full weeks)`,
    { unit: "pct", promising: 0.2, great: 0.4 },
    `${least} resurrected players with the week after over`,
  );
}

/** One arm's rate minus another's, in points, once both have `least` players to read it over. */
function lift(arm: Rate, against: Rate, least: number): number | null {
  if (arm.cohort < least || against.cohort < least) return null;
  return arm.returned / arm.cohort - against.returned / against.cohort;
}

const guessedRate = (m: KeyMetrics): Rate => ({ cohort: m.players, returned: m.guessed });

/** Puzzle type: Freeform-only players' next-day return against Standard-only players', for everyone. */
export function puzzleTypeBenchmark(modes: Record<"standard" | "freeform", KeyMetrics>): Benchmark {
  const least = 30;
  return benchmark(
    lift(modes.freeform.nextDay.rate, modes.standard.nextDay.rate, least),
    "Freeform only vs Standard only, back next day",
    { unit: "points", promising: -0.05, great: 0.05 },
    `${least} players a mode whose next day is over`,
  );
}

/** Chat: of the window's players, the share who opened the chat. */
export function chatBenchmark(chat: { opened: KeyMetrics; notOpened: KeyMetrics }): Benchmark {
  const least = 30;
  const players = chat.opened.players + chat.notOpened.players;
  return benchmark(
    players >= least ? chat.opened.players / players : null,
    "of players opened the chat",
    { unit: "pct", promising: 0.05, great: 0.15 },
    `${least} players in the window`,
  );
}

/** Idle hint test: the hinted arm's share who guessed against the unhinted arm's. */
export function idleHintBenchmark(arms: { control: KeyMetrics; treatment: KeyMetrics }): Benchmark {
  const least = 50;
  return benchmark(
    lift(guessedRate(arms.treatment), guessedRate(arms.control), least),
    "hint vs no hint, share who guessed",
    { unit: "points", promising: 0.01, great: 0.05 },
    `${least} idle players an arm`,
  );
}

/** Muse AI: of its tries, the share turned away -- lower is better. */
export function museBenchmark(muse: MuseReport): Benchmark {
  const least = 3;
  const tries = (muse.avgWords ?? 0) + (muse.avgRejected ?? 0);
  return benchmark(
    muse.puzzles >= least && tries > 0 ? (muse.avgRejected ?? 0) / tries : null,
    "of its tries rejected",
    { unit: "pct", promising: 0.25, great: 0.1, lowerIsBetter: true },
    `${least} puzzles played`,
  );
}
