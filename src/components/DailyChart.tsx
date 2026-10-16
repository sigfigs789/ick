import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AnalyticsReport } from "../game/review";
import { fmt, pct } from "./analyticsFormat";

type Day = AnalyticsReport["daily"][number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The four counts, by colour for new or returning and by stroke for turned up
 * (dashed) or played (solid).
 */
const COUNTS = [
  { label: "New, turned up", value: (d: Day) => d.newAppeared, who: "new", dashed: true },
  { label: "New, played", value: (d: Day) => d.newPlayed, who: "new", dashed: false },
  { label: "Returning, turned up", value: (d: Day) => d.returningAppeared, who: "returning", dashed: true },
  { label: "Returning, played", value: (d: Day) => d.returningPlayed, who: "returning", dashed: false },
] as const;

/** The day's new players who played again within a week; null until that week is over. */
function backShare(d: Day): number | null {
  return d.newBack.cohort ? d.newBack.returned / d.newBack.cohort : null;
}

/**
 * Day by day, as one figure: the counts on top, and under them, on the same
 * dates, the share of each day's new players who came back to play within the
 * week. Two panels rather than a second y-axis, because a percentage and a count
 * on one plot invite comparing heights that mean nothing to each other. One
 * crosshair runs through both, and the tooltip reads every line for that day.
 */
export function DailyChart({ daily }: { daily: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = daily.length;
  if (n === 0) return <p className="review__status">No puzzles in this window.</p>;

  const shown = hover !== null && hover < n ? hover : n - 1;
  const day = daily[shown];
  const { top, ticks } = scale(Math.max(...daily.map((d) => Math.max(d.newAppeared, d.returningAppeared))));
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  // A null breaks the line. A segment opens with a zero-length step, so a day
  // alone between two gaps still draws, as a dot from the round cap.
  const path = (ys: Array<number | null>) =>
    ys.reduce<string>((acc, y, i) => {
      if (y === null) return acc;
      const opens = i === 0 || ys[i - 1] === null;
      return `${acc}${opens ? ` M ${x(i)} ${y}` : ""} L ${x(i)} ${y}`;
    }, "");

  const indexAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || !Number.isFinite(e.clientX)) return shown;
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: shown - 1, ArrowRight: shown + 1, Home: 0, End: n - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(n - 1, moves[e.key])));
  };
  const share = backShare(day);
  const describe = `${shortDate(day.date)}: ${COUNTS.map((c) => `${c.label} ${fmt(c.value(day))}`).join(", ")}, new back within a week ${
    share === null ? "not known yet" : pct(share)
  }`;

  // About seven dates along the axis, the last day's always among them.
  const every = Math.max(1, Math.ceil(n / 7));
  const labels = daily.map((_, i) => i).filter((i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2));

  return (
    <figure className="daily">
      <ul className="analytics__legend">
        {COUNTS.map((c) => (
          <li key={c.label}>
            <svg className="daily__key" viewBox="0 0 20 4" aria-hidden="true">
              <line
                x1="0"
                y1="2"
                x2="20"
                y2="2"
                className={`daily__line daily__line--${c.who}${c.dashed ? " daily__line--dashed" : ""}`}
              />
            </svg>
            {c.label}
          </li>
        ))}
      </ul>
      <div
        className="daily__chart"
        role="slider"
        tabIndex={0}
        aria-label="Players per puzzle"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={shown}
        aria-valuetext={describe}
        onPointerMove={(e) => setHover(indexAt(e))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        <div className="daily__panel">
          <Axis ticks={ticks.map((t) => ({ at: t / top, label: fmt(t) }))} />
          <svg className="daily__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {COUNTS.map((c) => (
              <path
                key={c.label}
                className={`daily__line daily__line--${c.who}${c.dashed ? " daily__line--dashed" : ""}`}
                d={path(daily.map((d) => 100 - (c.value(d) / top) * 100))}
              />
            ))}
          </svg>
        </div>
        <div className="daily__panel daily__panel--share">
          <span className="daily__panel-title">New players back to play within a week</span>
          <Axis ticks={[0, 0.5, 1].map((t) => ({ at: t, label: pct(t) }))} />
          <svg className="daily__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              className="daily__line daily__line--new"
              d={path(daily.map((d) => {
                const s = backShare(d);
                return s === null ? null : 100 - s * 100;
              }))}
            />
          </svg>
        </div>
        <span className="daily__cross" style={{ left: `${x(shown)}%` }} />
        {hover !== null && (
        <div className={`daily__tip${x(shown) > 55 ? " daily__tip--left" : ""}`} style={{ left: `${x(shown)}%` }} aria-hidden="true">
          <span className="daily__tip-date">{shortDate(day.date)}</span>
          {COUNTS.map((c) => (
            <span key={c.label} className="daily__tip-row">
              {c.label} <strong>{fmt(c.value(day))}</strong>
            </span>
          ))}
          <span className="daily__tip-row">
            New back within a week{" "}
            <strong>
              {share === null ? "too recent" : `${pct(share)} (${fmt(day.newBack.returned)} of ${fmt(day.newBack.cohort)})`}
            </strong>
          </span>
        </div>
        )}
        <div className="daily__xaxis" aria-hidden="true">
          {labels.map((i) => (
            <span
              key={daily[i].date}
              className={`daily__xlabel${i === 0 ? " daily__xlabel--start" : i === n - 1 ? " daily__xlabel--end" : ""}`}
              style={{ left: `${x(i)}%` }}
            >
              {shortDate(daily[i].date)}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

function Axis({ ticks }: { ticks: Array<{ at: number; label: string }> }) {
  return (
    <>
      {ticks.map((t) => (
        <span key={t.label} className="daily__grid" style={{ bottom: `${t.at * 100}%` }}>
          <span className="daily__ytick">{t.label}</span>
        </span>
      ))}
    </>
  );
}

/** A round top for the y axis and the four or so gridlines up to it. */
function scale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, ticks };
}

function shortDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}
