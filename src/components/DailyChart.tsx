import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AnalyticsReport } from "../game/review";
import { daysSinceEpoch } from "../game/date";
import { dowOf, fmt, pct } from "./analyticsFormat";

type Day = AnalyticsReport["daily"][number];

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * What the chart can plot, one tab each. `tone` colours a tab's day-over-day
 * change green when up and red when down; a looker is neither good news nor
 * bad, so that tab's change stays grey.
 */
const METRICS = [
  { key: "players", label: "Players", value: (d: Day) => d.players, tone: true },
  { key: "newPlayers", label: "New players", value: (d: Day) => d.newPlayers, tone: true },
  { key: "lookers", label: "Only looked", value: (d: Day) => d.lookers, tone: false },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

/**
 * One puzzle's numbers at a time, picked off a line through the window.
 *
 * The tabs along the top read the day under the pointer, or the pinned one when
 * the pointer is elsewhere: hover to look, click (or arrow keys, or the date
 * box) to pin. The pinned day starts on the viewer's own date, the same "today"
 * the tiles above read. A puzzle still in play -- today's, and tomorrow's once
 * anybody is on it -- is drawn dashed, because its count is not final.
 */
export function DailyChart({ daily, today }: { daily: Day[]; today: string }) {
  const [metric, setMetric] = useState<MetricKey>("players");
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (daily.length === 0) return <p className="review__status">No puzzles in this window.</p>;

  const n = daily.length;
  const todayIndex = daily.findIndex((d) => d.date === today);
  const fallback = todayIndex >= 0 ? todayIndex : n - 1;
  const pinnedIndex = pinned === null ? -1 : daily.findIndex((d) => d.date === pinned);
  const selected = pinnedIndex >= 0 ? pinnedIndex : fallback;
  // A hover left over from a longer window can point past this one's end.
  const shown = hover !== null && hover < n ? hover : selected;
  const day = daily[shown];
  const current = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  const values = daily.map(current.value);
  const { top, ticks } = scale(Math.max(...values));
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  const points = values.map((v, i) => `${x(i)} ${y(v)}`);

  // Solid up to the last finished puzzle, dashed from there into the ones still
  // in play. With nothing finished in the window, the whole line is dashed.
  const firstLive = daily.findIndex((d) => d.date >= today);
  const split = firstLive < 0 ? n - 1 : Math.max(0, firstLive - 1);
  const solid = points.slice(0, split + 1);
  const dashed = firstLive < 0 ? [] : points.slice(split);
  const area = `M ${x(0)} 100 L ${points.join(" L ")} L ${x(n - 1)} 100 Z`;

  // About seven dates along the axis, the last day's always among them, and on
  // a phone every other one (daily__xlabel--minor).
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const labels = daily
    .map((_, i) => i)
    .filter((i) => i % labelEvery === 0 && (n - 1 - i >= labelEvery / 2 || i === 0));
  if (n > 1) labels.push(n - 1);
  const pick = (i: number) => {
    setHover(null);
    setPinned(daily[Math.max(0, Math.min(n - 1, i))].date);
  };
  const indexAt = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || !Number.isFinite(e.clientX)) return selected;
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 7 : 1;
    const moves: Record<string, number> = {
      ArrowLeft: selected - step,
      ArrowRight: selected + step,
      Home: 0,
      End: n - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    pick(moves[e.key]);
  };

  const describe = (i: number) => {
    const d = daily[i];
    return `${current.label} ${fmt(current.value(d))} on ${longDate(d.date)}`;
  };

  return (
    <div className="daily">
      <div className="daily__tabs" role="tablist" aria-label="Daily metric">
        {METRICS.map((m) => {
          const value = m.value(day);
          const prev = shown > 0 ? m.value(daily[shown - 1]) : null;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              className="daily__tab"
              aria-selected={m.key === metric}
              onClick={() => setMetric(m.key)}
            >
              <span className="daily__tab-label">{m.label}</span>
              <span className="daily__tab-row">
                <span className="daily__tab-value">{fmt(value)}</span>
                {prev !== null && <Change value={value} prev={prev} tone={m.tone} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="daily__controls">
        <button
          type="button"
          className="daily__step"
          aria-label="Previous day"
          disabled={selected === 0}
          onClick={() => pick(selected - 1)}
        >
          ‹
        </button>
        <input
          type="date"
          className="daily__date"
          aria-label="Day"
          value={daily[selected].date}
          min={daily[0].date}
          max={daily[n - 1].date}
          onChange={(e) => {
            const i = daily.findIndex((d) => d.date === e.target.value);
            if (i >= 0) pick(i);
          }}
        />
        <button
          type="button"
          className="daily__step"
          aria-label="Next day"
          disabled={selected === n - 1}
          onClick={() => pick(selected + 1)}
        >
          ›
        </button>
        {todayIndex >= 0 && selected !== todayIndex && (
          <button type="button" className="analytics__window-button" onClick={() => pick(todayIndex)}>
            Today
          </button>
        )}
        <span className="daily__caption">
          {longDate(day.date)} · {relative(day.date, today)}
          {shown > 0 && `, change vs ${shortDate(daily[shown - 1].date)}`}
        </span>
      </div>

      <div className="daily__chart">
        <div className="daily__yaxis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div
          className="daily__plot"
          role="slider"
          tabIndex={0}
          aria-label={`${current.label} per puzzle`}
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={selected}
          aria-valuetext={describe(selected)}
          onPointerMove={(e) => setHover(indexAt(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => pick(indexAt(e))}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <span key={t} className="daily__grid" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <svg className="daily__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="daily__area" d={area} />
            {solid.length > 1 && <path className="daily__line" d={`M ${solid.join(" L ")}`} />}
            {dashed.length > 1 && (
              <path className="daily__line daily__line--live" d={`M ${dashed.join(" L ")}`} />
            )}
          </svg>
          {hover !== null && hover !== selected && (
            <span className="daily__cross daily__cross--pinned" style={{ left: `${x(selected)}%` }} />
          )}
          <span className="daily__cross" style={{ left: `${x(shown)}%` }} />
          <span className="daily__dot" style={{ left: `${x(shown)}%`, top: `${y(values[shown])}%` }} />
          <div
            className={`daily__tip${x(shown) > 60 ? " daily__tip--left" : ""}`}
            style={{ left: `${x(shown)}%` }}
            aria-hidden="true"
          >
            <span className="daily__tip-row">
              <span className="daily__tip-swatch" />
              {current.label} <strong>{fmt(values[shown])}</strong>
            </span>
            <span className="daily__tip-date">
              {shortDate(day.date)} · {SHORT_WEEKDAYS[dowOf(day.date)]}
            </span>
            {metric === "players" && day.standard > 0 && day.freeform > 0 && (
              <span className="daily__tip-date">
                {fmt(day.standard)} Standard · {fmt(day.freeform)} Freeform
              </span>
            )}
            {day.date >= today && <span className="daily__tip-date">still in play</span>}
          </div>
        </div>
        <div className="daily__xaxis" aria-hidden="true">
          {labels.map((i, k) => (
            <span
              key={daily[i].date}
              className={`daily__xlabel${Math.abs(x(i) - x(shown)) < 12 ? " daily__xlabel--hidden" : ""}${
                k % 2 === 1 && i !== n - 1 ? " daily__xlabel--minor" : ""
              }${edge(x(i))}`}
              style={{ left: `${x(i)}%` }}
            >
              {shortDate(daily[i].date)}
            </span>
          ))}
          <span className={`daily__pill${edge(x(shown))}`} style={{ left: `${x(shown)}%` }}>
            {relative(day.date, today)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Change({ value, prev, tone }: { value: number; prev: number; tone: boolean }) {
  const diff = value - prev;
  const text =
    prev > 0 ? `${diff >= 0 ? "+" : "−"}${pct(Math.abs(diff) / prev)}` : `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))}`;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  return (
    <span
      className={`daily__change daily__change--${tone ? direction : "flat"}`}
      title={`${fmt(prev)} the day before`}
    >
      {text}
    </span>
  );
}

/** A round top for the y axis and the four or so gridlines up to it. */
function scale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const stepped = Math.max(1, step);
  const top = Math.ceil(max / stepped) * stepped;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += stepped) ticks.push(t);
  return { top, ticks };
}

/** Keeps a label that sits on the first or last day inside the chart. */
function edge(at: number): string {
  if (at < 4) return " daily__edge--start";
  if (at > 96) return " daily__edge--end";
  return "";
}

function shortDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

function longDate(date: string): string {
  return `${SHORT_WEEKDAYS[dowOf(date)]} ${shortDate(date)}`;
}

function relative(date: string, today: string): string {
  const ago = daysSinceEpoch(today, date);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago === -1) return "Tomorrow";
  return ago > 0 ? `${ago} days ago` : `in ${-ago} days`;
}
