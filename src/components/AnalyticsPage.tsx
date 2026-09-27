import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import { fetchAnalytics, type AnalyticsReport, type Rate } from "../game/review";
import {
  MODE_NAMES,
  WEEKDAYS,
  dec,
  dowOf,
  duration,
  findHighlights,
  fmt,
  pct,
} from "./analyticsFormat";

/**
 * How the game is doing, as a page at /analytics.
 *
 * Who plays, whether they come back, and what that depends on: the day of the
 * week, the rules they played under, where they arrived from. Every number is
 * built in one place, `analytics_report` (see the 2026-09-27 migration), and
 * this page only draws them -- so a figure here and the same figure from a psql
 * prompt can never disagree.
 *
 * Two halves, and the page says which is which because they count different
 * things. The play half is players, off the board's table: a row per player per
 * live puzzle they banked a word on. The visit half is events, over the chosen
 * window: opens, sessions, shares, sources.
 *
 * Unlinked and keyed like the freeform report (see api/review.ts). Nothing on it
 * identifies anybody -- the smallest group any number is taken over is a day's
 * players -- but it is the maintainer's running account of the game, not a page
 * for the people playing it.
 */

const WINDOWS = [30, 60, 90] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AnalyticsPage() {
  const [days, setDays] = useState<number>(60);
  const load = useCallback(async () => [await fetchAnalytics(days)], [days]);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const report: AnalyticsReport | undefined = rows[0];

  return (
    <ReviewPage
      title="Analytics"
      note="Who plays, whether they come back, and what that depends on."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nobody has played yet."
      isEmpty={!report || report.totals.players === 0}
    >
      {report && <Report report={report} days={days} onDays={setDays} />}
    </ReviewPage>
  );
}

function Report({
  report,
  days,
  onDays,
}: {
  report: AnalyticsReport;
  days: number;
  onDays: (days: number) => void;
}) {
  const { totals, retention } = report;
  const highlights = findHighlights(report);

  return (
    <div className="analytics">
      <div className="analytics__window" role="group" aria-label="Time window">
        <span className="analytics__window-label">Window</span>
        {WINDOWS.map((n) => (
          <button
            key={n}
            type="button"
            className="analytics__window-button"
            aria-pressed={n === days}
            onClick={() => onDays(n)}
          >
            {n} days
          </button>
        ))}
      </div>

      <div className="analytics__tiles">
        <Tile label="Players today" value={fmt(totals.today)} sub={report.asOf ? `puzzle ${report.asOf}` : undefined} />
        <Tile label="Last 7 puzzles" value={fmt(totals.last7)} sub="distinct players" />
        <Tile label="Last 30 puzzles" value={fmt(totals.last30)} sub="distinct players" />
        <Tile
          label="All time"
          value={fmt(totals.players)}
          sub={totals.firstDay ? `since ${totals.firstDay}` : undefined}
        />
        <Tile
          label="Stickiness"
          value={totals.last30 ? pct(totals.last7 / totals.last30) : "—"}
          sub="7-day ÷ 30-day players"
        />
        <Tile
          label="Days per player"
          value={totals.avgDaysPerPlayer === null ? "—" : totals.avgDaysPerPlayer.toFixed(1)}
          sub="puzzles played, on average"
        />
      </div>

      {highlights.length > 0 && (
        <Section title="Worth noticing">
          <ul className="analytics__highlights">
            {highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Coming back"
        note="Of the players whose first puzzle was long enough ago to tell, how many played again. Day N is exactly N days after their first."
      >
        <div className="analytics__tiles">
          <RateTile label="Next day" rate={retention.d1} />
          <RateTile label="Within the first week" rate={retention.week1} />
          <RateTile label="Day 7" rate={retention.d7} />
          <RateTile label="Day 30" rate={retention.d30} />
        </div>
      </Section>

      <Section
        title="Players per puzzle"
        note={`The last ${report.windowDays} puzzles, split by the rules each was played under. Hover a day for new players.`}
      >
        <Legend />
        <BarChart
          label="Players per puzzle"
          bars={report.daily.map((d) => ({
            key: d.date,
            axis: d.date.slice(5),
            segments: [
              { value: d.standard, series: "standard" },
              { value: d.freeform, series: "freeform" },
            ],
            tip: `${d.date} (${SHORT_WEEKDAYS[dowOf(d.date)]}): ${d.players} players, ${d.newPlayers} new`,
          }))}
        />
      </Section>

      <Section
        title="Weekly cohorts"
        note="Players grouped by the week (Sunday start) of their first puzzle, and the share who played some day in each week after."
      >
        <CohortGrid cohorts={report.cohorts} asOf={report.asOf} />
      </Section>

      <Section
        title="By day of the week"
        note="Averages per puzzle, all time. Next day is the share of that day's players who played the following puzzle too."
      >
        <BarChart
          label="Average players by day of the week"
          bars={report.weekday.map((w) => ({
            key: String(w.dow),
            axis: SHORT_WEEKDAYS[w.dow],
            segments: [{ value: w.avgPlayers ?? 0, series: "single" }],
            tip: `${WEEKDAYS[w.dow]}: ${w.avgPlayers ?? 0} players on average, over ${w.puzzles} puzzles`,
          }))}
          compact
        />
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Players</th>
                <th scope="col">New</th>
                <th scope="col">Words</th>
                <th scope="col">Score</th>
                <th scope="col">Next day</th>
              </tr>
            </thead>
            <tbody>
              {report.weekday.map((w) => (
                <tr key={w.dow}>
                  <th scope="row">{WEEKDAYS[w.dow]}</th>
                  <td>{dec(w.avgPlayers, 1)}</td>
                  <td>{dec(w.avgNewPlayers, 1)}</td>
                  <td>{dec(w.avgWords, 2)}</td>
                  <td>{dec(w.avgTotal, 1)}</td>
                  <td>
                    <RateCell rate={w.nextDay} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="By game mode"
        note="Before the switch, a day's mode is the one everybody played: the Freeform trial week (Sep 14–26) against every Standard week around it. From Sep 27, it is each player's choice."
      >
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Mode</th>
                <th scope="col">Players</th>
                <th scope="col">Plays</th>
                <th scope="col">Words</th>
                <th scope="col">Score</th>
                <th scope="col">Best word</th>
                <th scope="col">Next day</th>
              </tr>
            </thead>
            <tbody>
              {report.modes.map((m) => (
                <tr key={m.mode}>
                  <th scope="row">
                    <span className={`analytics__swatch analytics__swatch--${m.mode}`} aria-hidden="true" />
                    {MODE_NAMES[m.mode] ?? m.mode}
                  </th>
                  <td>{fmt(m.players)}</td>
                  <td>{fmt(m.plays)}</td>
                  <td>{dec(m.avgWords, 2)}</td>
                  <td>{dec(m.avgTotal, 1)}</td>
                  <td>{dec(m.avgTop, 2)}</td>
                  <td>
                    <RateCell rate={m.nextDay} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="review__meta">
          Switches in the last {report.windowDays} days: {fmt(report.funnel.toFreeform)} to Freeform,{" "}
          {fmt(report.funnel.toStandard)} to Standard.
        </p>
      </Section>

      <Section title="How many days people play" note="Every player, by the number of puzzles they have played.">
        <BarChart
          label="Players by days played"
          bars={report.depth.map((d) => ({
            key: d.bucket,
            axis: d.bucket,
            segments: [{ value: d.players, series: "single" }],
            tip: `${d.bucket}: ${d.players} players (${pct(d.players / Math.max(1, totals.players))})`,
          }))}
          compact
        />
      </Section>

      <Section
        title="From open to share"
        note={`Events in the last ${report.windowDays} days. Engaged is a visit that submitted a guess.`}
      >
        <Funnel report={report} />
      </Section>

      <Section
        title="Where visits come from"
        note="By the source a visitor first arrived through. Engaged is a session that submitted a guess."
      >
        {report.sources.length === 0 ? (
          <p className="review__status">No visits in this window.</p>
        ) : (
          <div className="analytics__table-wrap">
            <table className="analytics__table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Visits</th>
                  <th scope="col">First visits</th>
                  <th scope="col">Engaged</th>
                  <th scope="col">Engaged per visit</th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((s) => (
                  <tr key={s.source}>
                    <th scope="row">{s.source}</th>
                    <td>{fmt(s.visits)}</td>
                    <td>{fmt(s.firstVisits)}</td>
                    <td>{fmt(s.engaged)}</td>
                    <td>{s.visits ? pct(s.engaged / s.visits) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Sessions" note={`Visible time on the page, per session, in the last ${report.windowDays} days.`}>
        <div className="analytics__tiles">
          <Tile label="Sessions" value={fmt(report.sessions.sessions)} />
          <Tile label="Median session" value={duration(report.sessions.medianVisibleMs)} />
          <Tile label="Median, when they guessed" value={duration(report.sessions.medianPlayingMs)} />
          <Tile label="Time to first guess" value={duration(report.sessions.medianFirstGuessMs)} sub="median" />
          <Tile
            label="Sessions with a guess"
            value={report.sessions.guessedShare === null ? "—" : pct(report.sessions.guessedShare)}
          />
        </div>
      </Section>

      <Section title="When people open it" note="Visits by hour of day, Mountain Time.">
        <BarChart
          label="Visits by hour"
          bars={report.hours.map((h) => ({
            key: String(h.hour),
            axis: h.hour % 3 === 0 ? String(h.hour) : "",
            segments: [{ value: h.visits, series: "single" }],
            tip: `${String(h.hour).padStart(2, "0")}:00–${String(h.hour).padStart(2, "0")}:59 MT: ${h.visits} visits`,
          }))}
          compact
        />
      </Section>
    </div>
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

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="analytics__tile">
      <span className="analytics__tile-label">{label}</span>
      <span className="analytics__tile-value">{value}</span>
      {sub && <span className="analytics__tile-sub">{sub}</span>}
    </div>
  );
}

function RateTile({ label, rate }: { label: string; rate: Rate }) {
  return (
    <Tile
      label={label}
      value={rate.cohort ? pct(rate.returned / rate.cohort) : "—"}
      sub={rate.cohort ? `${fmt(rate.returned)} of ${fmt(rate.cohort)}` : "not enough days yet"}
    />
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

function Legend() {
  return (
    <ul className="analytics__legend">
      <li>
        <span className="analytics__swatch analytics__swatch--standard" aria-hidden="true" />
        Standard
      </li>
      <li>
        <span className="analytics__swatch analytics__swatch--freeform" aria-hidden="true" />
        Freeform
      </li>
    </ul>
  );
}

interface Bar {
  key: string;
  /** The axis label under the bar; empty to leave a gap in a dense axis. */
  axis: string;
  segments: Array<{ value: number; series: "standard" | "freeform" | "single" }>;
  tip: string;
}

/**
 * Columns drawn in plain HTML, bottom-anchored, one scale. The tooltip is the
 * bar's own `tip`, shown for whichever column the pointer or focus is on, and
 * each column carries it as its accessible name too, so the numbers are there
 * for a reader who never sees the bars.
 */
function BarChart({ label, bars, compact }: { label: string; bars: Bar[]; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.segments.reduce((sum, s) => sum + s.value, 0)));
  const showing = active === null ? null : bars[active];

  return (
    <figure className={`analytics__chart${compact ? " analytics__chart--compact" : ""}`} aria-label={label}>
      <div className="analytics__tip" aria-live="polite">
        {showing ? showing.tip : " "}
      </div>
      <div className="analytics__plot" onMouseLeave={() => setActive(null)}>
        {bars.map((bar, i) => {
          const total = bar.segments.reduce((sum, s) => sum + s.value, 0);
          return (
            <div
              key={bar.key}
              className="analytics__col"
              data-active={active === i ? "" : undefined}
              tabIndex={0}
              aria-label={bar.tip}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div className="analytics__stack" style={{ height: `${(total / max) * 100}%` }}>
                {bar.segments
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <span
                      key={s.series}
                      className={`analytics__seg analytics__seg--${s.series}`}
                      style={{ flexGrow: s.value }}
                    />
                  ))}
              </div>
              <span className="analytics__axis" aria-hidden="true">
                {bar.axis}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/**
 * The cohort grid: a row per first-play week, a column per week since, each
 * cell shaded by the share still playing. Week 0 is always 100% and is shown as
 * the cohort's size instead, which is the number a reader needs to weigh the
 * rest of its row.
 */
function CohortGrid({
  cohorts,
  asOf,
}: {
  cohorts: AnalyticsReport["cohorts"];
  asOf: string | null;
}) {
  const width = Math.max(1, ...cohorts.map((c) => c.active.length));
  // Each row's last week is the current one, and unless the latest puzzle is a
  // Saturday it is not over: its share is a few days' worth, and drawn at full
  // strength it reads as everyone leaving at once.
  const inProgress = asOf !== null && dowOf(asOf) !== 6;
  if (cohorts.length === 0) return <p className="review__status">No cohorts yet.</p>;
  return (
    <>
    <div className="analytics__table-wrap">
      <table className="analytics__table analytics__cohorts">
        <thead>
          <tr>
            <th scope="col">First week</th>
            <th scope="col">Players</th>
            {Array.from({ length: width - 1 }, (_, k) => (
              <th scope="col" key={k}>
                Wk {k + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <th scope="row">{c.week}</th>
              <td>{fmt(c.size)}</td>
              {Array.from({ length: width - 1 }, (_, k) => {
                const active = c.active[k + 1];
                if (active === undefined) return <td key={k} className="analytics__cell--empty" />;
                const share = c.size ? active / c.size : 0;
                const partial = inProgress && k + 1 === c.active.length - 1;
                return (
                  <td
                    key={k}
                    className={`analytics__cell${partial ? " analytics__cell--partial" : ""}`}
                    // Five steps of one hue, light to dark, so a cell's shade
                    // and its printed share can only agree.
                    data-step={Math.min(4, Math.floor(share * 5))}
                    title={`${active} of ${c.size}${partial ? ", week in progress" : ""}`}
                  >
                    {pct(share)}
                    {partial && "*"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {inProgress && (
      <p className="review__meta">* This week so far — it is not over yet.</p>
    )}
    </>
  );
}

/** Visits down to shares, each step as a bar and as a share of the one before. */
function Funnel({ report }: { report: AnalyticsReport }) {
  const f = report.funnel;
  const steps = [
    { label: "Visits", value: f.visits },
    { label: "Engaged", value: f.engaged },
    { label: "Finished a puzzle", value: f.completed },
    { label: "Shared a result", value: f.shared },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="analytics__funnel">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0;
        return (
          <li key={step.label} className="analytics__funnel-step">
            <span className="analytics__funnel-label">{step.label}</span>
            <span className="analytics__funnel-bar" aria-hidden="true">
              <span style={{ width: `${(step.value / max) * 100}%` }} />
            </span>
            <span className="analytics__funnel-value">
              {fmt(step.value)}
              {i > 0 && prev > 0 && <span className="analytics__n"> {pct(step.value / prev)} of above</span>}
            </span>
          </li>
        );
      })}
      <li className="review__meta">
        {fmt(f.firstVisits)} first-ever visits; {f.completed ? pct(f.won / f.completed) : "—"} of finished puzzles
        won; {fmt(f.sharedOnX)} shares went to X.
      </li>
    </ol>
  );
}
