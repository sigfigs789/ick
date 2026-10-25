import type { Rate } from "./report";
import {
  count,
  D1_MARKS,
  D7_MARKS,
  LEAST,
  MONTH_MARKS,
  percent,
  SHARE_MARKS,
  stand,
  WEEK_MARKS,
  type Marks,
  type Standing,
} from "./scorecard";

/**
 * An experiment on /experimentsV2 -- the word of the day, the come-back line --
 * as `analytics_v2_experiment` returns it (see the 2026-11-01 migrations, where
 * every number is defined), and the call it points to: keep the thing tested,
 * or take it out.
 *
 * The call rests on D1, the scorecard's first retention row and the one a
 * single puzzle's screen can most plausibly move, over everyone drawn. 7-day return breaks a
 * tie; sharing and finishing later puzzles are shown as guardrails, not judged,
 * since a player's days are not independent of each other.
 */

export type Variant = "shown" | "hidden";
/**
 * Everyone drawn; those drawn on the day of their first word; and everyone
 * else. A player's segment is fixed by the day they were drawn, never by the
 * day of a later visit: a new player's every return counts under `new`.
 */
export type Segment = "all" | "new" | "returning";

export interface Arm {
  variant: Variant;
  segment: Segment;
  assigned: number;
  d1: Rate;
  d7: Rate;
  /** Banked a word on any of the 7 days after; `days` is how many of those days in all. */
  week: Rate & { days: number };
  /** Banked a word on any of the 30 days after. */
  month: Rate;
  playerDays: number;
  sharedDays: number;
  laterDays: number;
  laterCompleted: number;
}

export interface Experiment {
  /** The first assignment day, or null before anybody was drawn. */
  since: string | null;
  arms: Arm[];
}

type Json = Record<string, unknown>;

const obj = (raw: unknown): Json => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Json) : {});
const num = (raw: unknown): number => (typeof raw === "number" && Number.isFinite(raw) ? raw : 0);
const rate = (raw: unknown): Rate => ({ cohort: num(obj(raw).cohort), returned: num(obj(raw).returned) });

/**
 * The experiment as typed values, or null when the database sent none.
 *
 * The database sends `all` and `new`; `returning` is the difference, which is
 * exact because every number in an arm is a count or a sum over its players.
 */
export function parseExperiment(raw: unknown): Experiment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = obj(raw);
  const arms: Arm[] = (Array.isArray(r.arms) ? r.arms : [])
    .map(obj)
    .filter(
      (a) =>
        (a.variant === "shown" || a.variant === "hidden") &&
        (a.segment === "all" || a.segment === "new" || a.segment === "returning"),
    )
    .map((a) => ({
      variant: a.variant as Variant,
      segment: a.segment as Segment,
      assigned: num(a.assigned),
      d1: rate(a.d1),
      d7: rate(a.d7),
      week: { ...rate(a.week), days: num(obj(a.week).days) },
      month: rate(a.month),
      playerDays: num(a.playerDays),
      sharedDays: num(a.sharedDays),
      laterDays: num(a.laterDays),
      laterCompleted: num(a.laterCompleted),
    }));
  const experiment = { since: typeof r.since === "string" ? r.since : null, arms };
  for (const variant of ["shown", "hidden"] as const) {
    if (arms.some((a) => a.variant === variant && a.segment === "returning")) continue;
    if (!arms.some((a) => a.variant === variant && a.segment === "all")) continue;
    arms.push(less(arm(experiment, variant, "all"), arm(experiment, variant, "new")));
  }
  return experiment;
}

/** Everyone in `all` who is not in `part`, as the returning segment. */
function less(all: Arm, part: Arm): Arm {
  const minus = (a: Rate, b: Rate): Rate => ({ cohort: a.cohort - b.cohort, returned: a.returned - b.returned });
  return {
    variant: all.variant,
    segment: "returning",
    assigned: all.assigned - part.assigned,
    d1: minus(all.d1, part.d1),
    d7: minus(all.d7, part.d7),
    week: { ...minus(all.week, part.week), days: all.week.days - part.week.days },
    month: minus(all.month, part.month),
    playerDays: all.playerDays - part.playerDays,
    sharedDays: all.sharedDays - part.sharedDays,
    laterDays: all.laterDays - part.laterDays,
    laterCompleted: all.laterCompleted - part.laterCompleted,
  };
}

/** An arm with nothing in it, for a segment the database had no rows for. */
export function emptyArm(variant: Variant, segment: Segment): Arm {
  const none = { cohort: 0, returned: 0 };
  return {
    variant,
    segment,
    assigned: 0,
    d1: none,
    d7: none,
    week: { ...none, days: 0 },
    month: none,
    playerDays: 0,
    sharedDays: 0,
    laterDays: 0,
    laterCompleted: 0,
  };
}

export function arm(experiment: Experiment, variant: Variant, segment: Segment): Arm {
  return experiment.arms.find((a) => a.variant === variant && a.segment === segment) ?? emptyArm(variant, segment);
}

/** The least D1 cohort, per arm, before the experiment is judged at all. */
export const LEAST_PER_ARM = 100;

/** The smallest D1 gap worth acting on, in points; what the sample size is reckoned against. */
export const GAP_WORTH_ACTING_ON = 0.05;

export interface Comparison {
  shown: number;
  hidden: number;
  /** Shown minus hidden. */
  gap: number;
  /** Two-sided p-value of a two-proportion z-test; 1 when there is nothing to test. */
  p: number;
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, good to 1e-7). */
function normal(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Shown against hidden on one rate. */
export function compare(shown: Rate, hidden: Rate): Comparison {
  const a = shown.cohort > 0 ? shown.returned / shown.cohort : 0;
  const b = hidden.cohort > 0 ? hidden.returned / hidden.cohort : 0;
  const pooled = (shown.returned + hidden.returned) / (shown.cohort + hidden.cohort || 1);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / (shown.cohort || 1) + 1 / (hidden.cohort || 1)));
  const p = shown.cohort > 0 && hidden.cohort > 0 && se > 0 ? 2 * (1 - normal(Math.abs((a - b) / se))) : 1;
  return { shown: a, hidden: b, gap: a - b, p };
}

/**
 * Players per arm needed to tell a gap of `gap` at `base` apart from nothing,
 * 95% confidence and 80% power.
 */
export function playersNeeded(base: number, gap: number = GAP_WORTH_ACTING_ON): number {
  const p = Math.min(Math.max(base, 0.01), 0.99);
  return Math.ceil(((1.96 + 0.8416) ** 2 * 2 * p * (1 - p)) / gap ** 2);
}

export type Call = "early" | "keep" | "remove" | "even";

export interface Verdict {
  call: Call;
  headline: string;
  reason: string;
}

const pts = (gap: number) => {
  const n = Math.round(Math.abs(gap) * 100);
  return `${n} ${n === 1 ? "pt" : "pts"}`;
};

/** Keep `subject` (the thing tested, as "the word of the day"), take it out, or not yet -- from everyone drawn. */
export function verdict(experiment: Experiment, subject = "the word of the day"): Verdict {
  const shown = arm(experiment, "shown", "all");
  const hidden = arm(experiment, "hidden", "all");
  const least = Math.min(shown.d1.cohort, hidden.d1.cohort);
  if (least < LEAST_PER_ARM) {
    return {
      call: "early",
      headline: "Too early to call",
      reason:
        `Each arm needs ${LEAST_PER_ARM} players whose day 1 is over; the smaller has ${count(least)}. ` +
        "Leave the experiment running.",
    };
  }
  const d1 = compare(shown.d1, hidden.d1);
  const week = compare(shown.week, hidden.week);
  const significant = (c: Comparison) => c.p < 0.05;
  if (significant(d1)) {
    const keep = d1.gap > 0;
    return {
      call: keep ? "keep" : "remove",
      headline: keep ? `Keep ${subject}` : `Remove ${subject}`,
      reason:
        `D1 is ${percent(d1.shown)} with it and ${percent(d1.hidden)} without, ${pts(d1.gap)} ` +
        `${keep ? "better" : "worse"} with it (p = ${d1.p.toFixed(3)}). ` +
        (keep ? "Showing it brings players back." : "Players come back more often without it."),
    };
  }
  if (significant(week)) {
    const keep = week.gap > 0;
    return {
      call: keep ? "keep" : "remove",
      headline: keep ? "Lean towards keeping it" : "Lean towards removing it",
      reason:
        `D1 is level (${percent(d1.shown)} with, ${percent(d1.hidden)} without), but ${percent(week.shown)} of ` +
        `players with it came back within a week against ${percent(week.hidden)} without (p = ${week.p.toFixed(3)}).`,
    };
  }
  const needed = playersNeeded((d1.shown + d1.hidden) / 2);
  if (least < needed) {
    return {
      call: "early",
      headline: "No difference yet",
      reason:
        `D1 is ${percent(d1.shown)} with it and ${percent(d1.hidden)} without (p = ${d1.p.toFixed(2)}): ` +
        `not a real gap so far. To tell a ${pts(GAP_WORTH_ACTING_ON)} gap apart needs about ${count(needed)} ` +
        `players per arm; the smaller has ${count(least)}.`,
    };
  }
  return {
    call: "even",
    headline: "It makes no difference to retention",
    reason:
      `With ${count(least)}+ players per arm, enough to see a ${pts(GAP_WORTH_ACTING_ON)} gap, D1 is ` +
      `${percent(d1.shown)} with it and ${percent(d1.hidden)} without. It neither helps nor hurts: keep it if you ` +
      "like it, or remove it for a simpler screen. Check the guardrails below before you choose.",
  };
}

/** Where an arm's rates land against the scorecard's bands. */
export function standings(a: Arm): Record<"d1" | "d7" | "week" | "month" | "share", Standing | null> {
  const judge = (part: number, whole: number, marks: Marks) => (whole >= LEAST ? stand(part / whole, marks) : null);
  return {
    d1: judge(a.d1.returned, a.d1.cohort, D1_MARKS),
    d7: judge(a.d7.returned, a.d7.cohort, D7_MARKS),
    week: judge(a.week.returned, a.week.cohort, WEEK_MARKS),
    month: judge(a.month.returned, a.month.cohort, MONTH_MARKS),
    share: judge(a.sharedDays, a.playerDays, SHARE_MARKS),
  };
}
