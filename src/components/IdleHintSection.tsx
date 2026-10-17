import { useEffect, useState } from "react";
import {
  fetchIdleHintReport,
  IDLE_HINT_EXPERIMENTS,
  type IdleHintArmMetrics,
  type IdleHintReport,
} from "../game/review";
import { IDLE_HINT_DELAY_MS } from "../game/idleHint";
import { fmt, pct, twoProportionP } from "./analyticsFormat";

/**
 * The idle hint A/B test, as a section of /analytics (see game/idleHint.ts and
 * the 2026-10-20 migration, which defines every number here).
 *
 * Loaded on its own, beside the page's main report rather than inside it, so a
 * database that has not had the migration yet costs this section and nothing
 * else.
 */

const EXPERIMENT_NAMES: Record<(typeof IDLE_HINT_EXPERIMENTS)[number], string> = {
  new: "New players",
  returning: "Returning players",
};

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; report: IdleHintReport };

export function IdleHintSection({ from, to, today }: { from: string | null; to: string; today: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetchIdleHintReport(from, to, today).then(
      (report) => live && setState({ kind: "ready", report }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [from, to, today]);

  return (
    <section className="analytics__section">
      <h2 className="analytics__heading">Idle hint test</h2>
      <p className="review__meta analytics__note">
        A word typed into the empty box after a few idle seconds, for half of each group.
        Everything below "Sat idle" is over the players who sat idle that long, in either arm.
        {state.kind === "ready" && state.report.since ? ` Running since ${state.report.since}.` : ""}
      </p>
      {state.kind === "loading" && <p className="review__meta">Loading…</p>}
      {state.kind === "error" && <p className="review__meta">The idle hint numbers could not be loaded.</p>}
      {state.kind === "ready" &&
        IDLE_HINT_EXPERIMENTS.map((experiment) => (
          <ArmTable
            key={experiment}
            title={`${EXPERIMENT_NAMES[experiment]}, after ${IDLE_HINT_DELAY_MS[experiment] / 1000}s`}
            control={state.report.experiments[experiment].control}
            treatment={state.report.experiments[experiment].treatment}
          />
        ))}
    </section>
  );
}

interface Row {
  label: string;
  /** A count and what it is a share of, for a rate the test can compare. */
  rate?: (m: IdleHintArmMetrics) => { n: number; of: number };
  /** A number with no share, shown as-is. */
  value?: (m: IdleHintArmMetrics) => string;
}

const ROWS: Row[] = [
  { label: "Assigned", value: (m) => fmt(m.assigned) },
  { label: "Sat idle", rate: (m) => ({ n: m.triggered, of: m.assigned }) },
  { label: "Typed after", rate: (m) => ({ n: m.typed, of: m.triggered }) },
  { label: "Guessed after", rate: (m) => ({ n: m.guessed, of: m.triggered }) },
  { label: "Words per player", value: (m) => (m.triggered ? (m.words / m.triggered).toFixed(2) : "–") },
  { label: "Best score (guessers)", value: (m) => (m.guessed ? (m.bestScore / m.guessed).toFixed(2) : "–") },
  { label: "Finished", rate: (m) => ({ n: m.finished, of: m.triggered }) },
  { label: "Shared", rate: (m) => ({ n: m.shared, of: m.triggered }) },
  { label: "Played the hint word", rate: (m) => ({ n: m.usedHint, of: m.triggered }) },
  {
    label: "Median time on site",
    value: (m) => (m.medianVisibleMs === null ? "–" : `${Math.round(m.medianVisibleMs / 1000)}s`),
  },
  { label: "Back within 7 days", rate: (m) => ({ n: m.returned.rate.returned, of: m.returned.rate.cohort }) },
];

function ArmTable({
  title,
  control,
  treatment,
}: {
  title: string;
  control: IdleHintArmMetrics;
  treatment: IdleHintArmMetrics;
}) {
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <caption className="review__meta">{title}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Control</th>
            <th scope="col">Hint</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{cell(row, control)}</td>
              <td>{cell(row, treatment)}</td>
              <td>{difference(row, control, treatment)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="review__meta analytics__n">
        Back within 7 days is over players whose 7 days are over ({fmt(control.returned.soFar)} control and{" "}
        {fmt(treatment.returned.soFar)} hint players back so far).
      </p>
    </div>
  );
}

function cell(row: Row, m: IdleHintArmMetrics) {
  if (row.value) return row.value(m);
  const { n, of } = row.rate!(m);
  return (
    <>
      {fmt(n)}
      {of > 0 && <span className="analytics__n"> {pct(n / of)}</span>}
    </>
  );
}

/** Treatment minus control, in percentage points, with the test's p-value. */
function difference(row: Row, control: IdleHintArmMetrics, treatment: IdleHintArmMetrics): string {
  if (!row.rate) return "";
  const c = row.rate(control);
  const t = row.rate(treatment);
  if (c.of === 0 || t.of === 0) return "–";
  const points = (t.n / t.of - c.n / c.of) * 100;
  const p = twoProportionP(t.n, t.of, c.n, c.of);
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pts${p === null ? "" : ` (p ${p < 0.001 ? "<0.001" : p.toFixed(3)})`}`;
}
