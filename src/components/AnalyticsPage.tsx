import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import { fetchAnalytics, type AnalyticsReport, type Rate, type Split } from "../game/review";
import { MODE_NAMES, fmt, pct, sourceName } from "./analyticsFormat";
import { DailyChart } from "./DailyChart";

/**
 * How the game is doing, as a page at /analytics: who turns up each day, new
 * and returning; how many of them play; and how many new players come back to
 * play within a week -- then the same, compared by mode and by where players
 * came from. Every number is built in one place, `analytics_report` (see the
 * 20261018000000 migration, which defines each word used here), and this page
 * only draws them.
 *
 * Unlinked, but open without a key (see api/review.ts): nothing on it
 * identifies anybody.
 */

const WINDOWS = [7, 30, 60, 90] as const;

export function AnalyticsPage() {
  const [days, setDays] = useState<number>(60);
  const load = useCallback(async () => [await fetchAnalytics(days)], [days]);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const report: AnalyticsReport | undefined = rows[0];

  return (
    <ReviewPage
      title="Analytics"
      note="Who turns up, who plays, and who comes back."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nobody has played yet."
      isEmpty={!report || report.asOf === null}
    >
      {report && (
        <div className="analytics">
          <div className="analytics__window" role="group" aria-label="Time window">
            <span className="analytics__window-label">Window</span>
            {WINDOWS.map((n) => (
              <button
                key={n}
                type="button"
                className="analytics__window-button"
                aria-pressed={n === days}
                onClick={() => setDays(n)}
              >
                {n} days
              </button>
            ))}
          </div>

          <Section
            title="Day by day"
            note="Turned up is everybody who opened the game for that puzzle or banked a word on it; played is banked a word. New is their first puzzle ever. Underneath: of each day's new players, the share who played again within the week after, shown once that week is over. The iOS app and the Reddit post report no opens, so their players turn up only when they play."
          >
            <DailyChart daily={report.daily} />
          </Section>

          <Section
            title="Standard vs Freeform"
            note="A day counts in the mode played; a day without a play, in the mode the player was last in. Played and back are over player-days: a new player's first day, a returning player's every day in the window. Back is a play on any of the seven puzzles after, once those are over."
          >
            <SplitTable label="Mode" rows={report.modes} name={(key) => MODE_NAMES[key] ?? key} />
          </Section>

          <Section title="By source" note="The source each player first arrived through, counted the same way.">
            <SplitTable label="Source" rows={report.sources} name={sourceName} />
          </Section>
        </div>
      )}
    </ReviewPage>
  );
}

function SplitTable({ label, rows, name }: { label: string; rows: Split[]; name: (key: string) => string }) {
  if (rows.length === 0) return <p className="review__status">Nobody in this window.</p>;
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Players</th>
            <th scope="col">Played</th>
            <th scope="col">Back within a week</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}-${r.isNew}`}>
              <th scope="row">
                {name(r.key)} · {r.isNew ? "new" : "returning"}
              </th>
              <td>{fmt(r.players)}</td>
              <td>
                <RateCell rate={{ cohort: r.days, returned: r.played }} />
              </td>
              <td>
                <RateCell rate={r.back} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="analytics__section">
      <h2 className="analytics__heading">{title}</h2>
      <p className="review__meta analytics__note">{note}</p>
      {children}
    </section>
  );
}

function RateCell({ rate }: { rate: Rate }) {
  if (!rate.cohort) return <>—</>;
  return (
    <span title={`${rate.returned} of ${rate.cohort}`}>
      {pct(rate.returned / rate.cohort)}
      <span className="analytics__n"> n={fmt(rate.cohort)}</span>
    </span>
  );
}
