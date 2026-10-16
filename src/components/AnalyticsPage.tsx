import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import {
  fetchAnalytics,
  GROUPS,
  type AnalyticsReport,
  type Group,
  type KeyMetrics,
  type Returns,
} from "../game/review";
import {
  DAYS_AGO,
  SPANS,
  daysAgoLabel,
  dowOf,
  fmt,
  moveRange,
  pct,
  windowDates,
  type AnalyticsWindow,
} from "./analyticsFormat";
import { todayDateString } from "../game/date";
import { DailyChart } from "./DailyChart";

/**
 * How the game is doing, as a page at /analytics.
 *
 * Four numbers, and the same four everywhere: the players who turned up, the
 * ones who did anything, the ones who guessed (banked a word), and the ones who
 * came back within seven days. They are split by who the players are -- new or
 * returning, and the mode they were started in -- by the puzzle type they
 * played, and by whether they opened the chat. Every number is built in one
 * place, `analytics_overview` (see the 2026-10-18 migration), and this page
 * only draws them.
 *
 * Unlinked, but open without a key (see api/review.ts). Nothing on it
 * identifies anybody -- the smallest group any number is taken over is a day's
 * players -- and it stays out of the game's navigation because it is not a page
 * for the people playing it.
 */

const GROUP_NAMES: Record<Group, string> = {
  all: "Everyone",
  new: "New players",
  returning: "Returning players",
  standard: "Started in Standard",
  freeform: "Started in Freeform",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

export function AnalyticsPage() {
  const [win, setWindow] = useState<AnalyticsWindow>({ kind: "span", days: 7 });
  const today = todayDateString();
  const { from, to } = windowDates(win, today);
  const load = useCallback(async () => [await fetchAnalytics(from, to, today)], [from, to, today]);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const report: AnalyticsReport | undefined = rows[0];

  return (
    <ReviewPage
      title="Analytics"
      note="Who turns up, what they do, and whether they come back."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nobody has played yet."
      isEmpty={!report}
    >
      {report && <Report report={report} win={win} today={today} onWindow={setWindow} />}
    </ReviewPage>
  );
}

function Report({
  report,
  win,
  today,
  onWindow,
}: {
  report: AnalyticsReport;
  win: AnalyticsWindow;
  today: string;
  onWindow: (next: AnalyticsWindow) => void;
}) {
  const [group, setGroup] = useState<Group>("all");
  const { from, to } = windowDates(win, today);
  // The dates the inputs show: the window's own, with all time starting on the
  // first day anybody turned up.
  const shown = { from: from ?? report.firstDay ?? to, to };
  const single = shown.from === shown.to;
  const span = single
    ? `${SHORT_WEEKDAYS[dowOf(shown.to)]} ${shortDate(shown.to)}`
    : from === null
      ? `All time, since ${shortDate(shown.from)}`
      : `${shortDate(shown.from)} to ${shortDate(shown.to)}`;

  return (
    <div className="analytics">
      <div className="analytics__window" role="group" aria-label="Time window">
        <span className="analytics__window-row">
          <span className="analytics__window-label">Day</span>
          {DAYS_AGO.map((ago) => (
            <button
              key={ago}
              type="button"
              className="analytics__window-button"
              aria-pressed={win.kind === "day" && win.ago === ago}
              onClick={() => onWindow({ kind: "day", ago })}
            >
              {daysAgoLabel(ago)}
            </button>
          ))}
        </span>
        <span className="analytics__window-row">
          <span className="analytics__window-label">Window</span>
          {SPANS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="analytics__window-button"
              aria-pressed={win.kind === "span" && win.days === s.days}
              onClick={() => onWindow({ kind: "span", days: s.days })}
            >
              {s.label}
            </button>
          ))}
        </span>
        <span className="analytics__window-row analytics__window-dates">
          {(["from", "to"] as const).map((end) => (
            <label key={end}>
              <span className="analytics__window-label">{end === "from" ? "From" : "to"}</span>
              <input
                type="date"
                className="analytics__window-date"
                value={shown[end]}
                min={report.firstDay ?? undefined}
                max={today}
                data-active={win.kind === "range"}
                onChange={(e) =>
                  e.target.value && onWindow({ kind: "range", ...moveRange(shown, end, e.target.value) })
                }
              />
            </label>
          ))}
        </span>
      </div>

      <Section
        title="Key numbers"
        note={`${span}. Players turned up; did something pressed anything, looked or guessed; guessed banked a word. Back within 7 days counts a player who turned up again on any of the seven puzzles after their first in the window: every return seen so far, with the rate over the players whose seven days are over.`}
      >
        <MetricsTable
          rows={GROUPS.map((g) => ({ key: g, label: GROUP_NAMES[g], metrics: report.groups[g] }))}
        />
        <p className="review__meta">
          New is a first day ever in the window; returning is everybody else. The starting mode is the one a player
          was put in on first arrival. The app reports no opens, so its players count once they guess.
        </p>
      </Section>

      <Section
        title="Day by day"
        note="Hover the line to read any puzzle; click, use the arrow keys or pick a date to pin one. The change beside each number is against the puzzle before."
      >
        <div className="analytics__groups" role="group" aria-label="Players">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              className="analytics__window-button"
              aria-pressed={g === group}
              onClick={() => setGroup(g)}
            >
              {GROUP_NAMES[g]}
            </button>
          ))}
        </div>
        <DailyChart
          key={`${shown.from}:${shown.to}`}
          daily={report.daily}
          group={group}
          today={today}
          focus={single ? shown.to : undefined}
        />
      </Section>

      <Section
        title="Puzzle type"
        note={`${span}. The players who banked a word in each mode, and of them, who turned up again within seven days of their first such puzzle, in either mode. A player who played both counts in both.`}
      >
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Puzzle type</th>
                <th scope="col">Guessed an answer</th>
                <th scope="col">Back within 7 days</th>
              </tr>
            </thead>
            <tbody>
              {(["standard", "freeform"] as const).map((mode) => (
                <tr key={mode}>
                  <th scope="row">
                    <span className={`analytics__swatch analytics__swatch--${mode}`} aria-hidden="true" />
                    {mode === "standard" ? "Standard" : "Freeform"}
                  </th>
                  <td>{fmt(report.modes[mode].guessed)}</td>
                  <td>
                    <ReturnsCell returns={report.modes[mode].returned} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Chat"
        note={`${span}. Each grouping, split by whether the player opened the chat in the window${
          report.chatSince ? ` (recorded from ${shortDate(report.chatSince)})` : ""
        }. Opening it is doing something, so that column is everybody for the ones who did.`}
      >
        <MetricsTable
          split
          rows={GROUPS.flatMap((g) => [
            { key: `${g}-opened`, label: GROUP_NAMES[g], side: "Opened chat", metrics: report.chat[g].opened },
            { key: `${g}-not`, label: GROUP_NAMES[g], side: "Didn't", metrics: report.chat[g].notOpened },
          ])}
        />
      </Section>
    </div>
  );
}

interface MetricsRow {
  key: string;
  label: string;
  side?: string;
  metrics: KeyMetrics;
}

/** The four key numbers, a row per set of players; `split` pairs rows under one label. */
function MetricsTable({ rows, split }: { rows: MetricsRow[]; split?: boolean }) {
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <thead>
          <tr>
            <th scope="col">Who</th>
            {split && <th scope="col">Chat</th>}
            <th scope="col">Players</th>
            <th scope="col">Did something</th>
            <th scope="col">Guessed</th>
            <th scope="col">Back within 7 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const m = r.metrics;
            const first = !split || i % 2 === 0;
            return (
              <tr key={r.key} className={split && i % 2 === 1 ? "analytics__row--pair" : undefined}>
                {first && (
                  <th scope="row" rowSpan={split ? 2 : undefined}>
                    {r.label}
                  </th>
                )}
                {split && <td>{r.side}</td>}
                <td>{fmt(m.players)}</td>
                <td>
                  <Count n={m.acted} of={m.players} />
                </td>
                <td>
                  <Count n={m.guessed} of={m.players} />
                </td>
                <td>
                  <ReturnsCell returns={m.returned} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Count({ n, of }: { n: number; of: number }) {
  return (
    <>
      {fmt(n)}
      {of > 0 && <span className="analytics__n"> {pct(n / of)}</span>}
    </>
  );
}

/** Every return seen so far, and the rate once some players' seven days are over. */
function ReturnsCell({ returns }: { returns: Returns }) {
  const { rate, soFar } = returns;
  return (
    <>
      {fmt(soFar)}
      <span className="analytics__n">
        {" "}
        {rate.cohort > 0 ? `${pct(rate.returned / rate.cohort)} of ${fmt(rate.cohort)}` : "7 days not over"}
      </span>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="analytics__section">
      <h2 className="analytics__heading">{title}</h2>
      {note && <p className="review__meta analytics__note">{note}</p>}
      {children}
    </section>
  );
}
