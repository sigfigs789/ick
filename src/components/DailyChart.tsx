import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AnalyticsReport, DayMetrics, Group } from "../game/review";
import { daysSinceEpoch } from "../game/date";
import { FREEFORM_TRIAL_END, FREEFORM_TRIAL_START } from "../game/mode";
import { dowOf, fmt, pct } from "./analyticsFormat";

type Day = AnalyticsReport["daily"][number];

/** The first puzzle the chat announced finds on by itself (#442). */
const CHAT_NOTICES_START = "2026-10-13";

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The key numbers, one tab each. A day's number is not final while it is
 * `live`: the puzzle still in play for the first five, and for returns, until
 * the puzzle after it (or all seven) is over. The line is dashed over those
 * days.
 */
const METRICS: ReadonlyArray<{
  key: keyof DayMetrics;
  label: string;
  live: (d: Day, today: string) => boolean;
  liveNote: string;
}> = [
  { key: "players", label: "Players", live: (d, today) => d.date >= today, liveNote: "still in play" },
  { key: "acted", label: "Did something", live: (d, today) => d.date >= today, liveNote: "still in play" },
  { key: "guessed", label: "Guessed", live: (d, today) => d.date >= today, liveNote: "still in play" },
  { key: "completed", label: "Completed", live: (d, today) => d.date >= today, liveNote: "still in play" },
  { key: "shared", label: "Shared", live: (d, today) => d.date >= today, liveNote: "still in play" },
  { key: "nextDay", label: "Back next day", live: (d) => !d.nextClosed, liveNote: "too soon to tell" },
  { key: "returned", label: "Back within 7 days", live: (d) => !d.closed, liveNote: "too soon to tell" },
];

type MetricKey = (typeof METRICS)[number]["key"];

/**
 * One puzzle's numbers at a time, picked off a line through the window, for
 * one grouping of players.
 *
 * The tabs along the top read the day under the pointer, or the pinned one when
 * the pointer is elsewhere: hover to look, click (or arrow keys, or the date
 * box) to pin. The pinned day starts on `focus` -- the window's one day, when
 * it is a single puzzle -- or else the viewer's own date.
 */
export function DailyChart({
  daily,
  group,
  today,
  focus,
}: {
  daily: Day[];
  group: Group;
  today: string;
  focus?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("players");
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (daily.length === 0) return <p className="review__status">No puzzles in this window.</p>;

  const n = daily.length;
  const todayIndex = daily.findIndex((d) => d.date === today);
  const focusIndex = focus === undefined ? -1 : daily.findIndex((d) => d.date === focus);
  const fallback = focusIndex >= 0 ? focusIndex : todayIndex >= 0 ? todayIndex : n - 1;
  const pinnedIndex = pinned === null ? -1 : daily.findIndex((d) => d.date === pinned);
  const selected = pinnedIndex >= 0 ? pinnedIndex : fallback;
  // A hover left over from a longer window can point past this one's end.
  const shown = hover !== null && hover < n ? hover : selected;
  const day = daily[shown];
  const current = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  const valueOf = (d: Day, key: MetricKey) => d.groups[group][key];
  // Beside each number: Players as the share of them who are new (for
  // everyone; within a grouping that is all or none, or not known), and the
  // rest as a share of the day's players.
  const shareOf = (d: Day, key: MetricKey): string | null => {
    const players = valueOf(d, "players");
    if (players === 0) return null;
    if (key === "players") return group === "all" ? `${pct(d.groups.new.players / players)} new` : null;
    return pct(valueOf(d, key) / players);
  };
  const values = daily.map((d) => valueOf(d, current.key));
  const { top, ticks } = scale(Math.max(...values));
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  const points = values.map((v, i) => `${x(i)} ${y(v)}`);

  // Solid up to the last final day, dashed from there into the ones that are
  // not. With nothing final in the window, the whole line is dashed.
  const firstLive = daily.findIndex((d) => current.live(d, today));
  const split = firstLive < 0 ? n - 1 : Math.max(0, firstLive - 1);
  const solid = points.slice(0, split + 1);
  const dashed = firstLive < 0 ? [] : points.slice(split);
  const area = `M ${x(0)} 100 L ${points.join(" L ")} L ${x(n - 1)} 100 Z`;

  // Days worth seeing the line against, where the window has them: the
  // Freeform trial week's first and last puzzle, and the chat's automatic
  // notices going live.
  const lastTrialDay = daily.findIndex((d) => d.date >= FREEFORM_TRIAL_END) - 1;
  const markers = [
    { i: daily.findIndex((d) => d.date === FREEFORM_TRIAL_START), label: "Freeform week" },
    { i: daily[lastTrialDay]?.date >= FREEFORM_TRIAL_START ? lastTrialDay : -1, label: "end" },
    { i: daily.findIndex((d) => d.date === CHAT_NOTICES_START), label: "Chat auto messages" },
  ].filter((m) => m.i >= 0);

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
    return `${current.label} ${fmt(valueOf(d, current.key))} on ${longDate(d.date)}`;
  };

  return (
    <div className="daily">
      <div className="daily__tabs" role="tablist" aria-label="Daily metric">
        {METRICS.map((m) => {
          const value = valueOf(day, m.key);
          const share = shareOf(day, m.key);
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
                {share !== null && <span className="daily__change">{share}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {n === 1 ? (
        <p className="review__meta daily__single">
          {longDate(day.date)} · {relative(day.date, today)}. Pick a longer window to hop between days.
        </p>
      ) : (
        <>
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
              {markers.map((m) => (
                <span key={m.label} className="daily__marker" style={{ left: `${x(m.i)}%` }}>
                  <span className="daily__marker-label">{m.label}</span>
                </span>
              ))}
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
                {metric !== "players" && valueOf(day, "players") > 0 && (
                  <span className="daily__tip-date">
                    {pct(values[shown] / valueOf(day, "players"))} of {fmt(valueOf(day, "players"))} players
                  </span>
                )}
                {current.live(day, today) && <span className="daily__tip-date">{current.liveNote}</span>}
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
        </>
      )}
    </div>
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
