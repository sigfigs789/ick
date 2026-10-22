import { useCallback, type CSSProperties, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import {
  fetchAnalytics,
  fetchGameplay,
  type AnalyticsReport,
  type GameplayReport,
  type Rate,
  type SourceRow,
} from "../game/review";
import { addDays, fmt, growth, pct, SHARE_SOURCES, sourceName } from "./analyticsFormat";
import { scorecard, scorecardWindow, STANDING_NAMES, type ScorecardRow, type Standing } from "./analyticsScorecard";
import { todayDateString } from "../game/date";

/**
 * The daily dashboard, as a page at /analyticsV2.
 *
 * It opens on a scorecard: six numbers against the bands a small daily browser
 * word game is held to (see analyticsScorecard.ts). Under it, five sections --
 * acquisition, retention, engagement, virality, momentum -- and then the
 * numbers particular to this game, which say why players come back or leave:
 * whether a first-timer banks a word, finishes and shares, opens the
 * leaderboard, how the score they finish on lands, and whether a sharer comes
 * back.
 *
 * Active means banked a word, here as on the scorecard: a visit that never
 * guesses is a visitor, counted under acquisition, not an active player.
 *
 * Fixed windows rather than a picker: the last four weeks for what players did,
 * eight for the trends, each closed day only where a number needs the next one
 * over. Every number is drawn from `analytics_overview`, the same function
 * /analytics reads, apart from strict day-N retention and the gameplay section,
 * which come from `analytics_gameplay` (the 2026-10-30 migration); until that is
 * in the database those parts say so and the rest of the page draws anyway.
 *
 * Unlinked and open without a key, like /analytics: every number is an aggregate.
 */

interface Dashboard {
  /** Eight weeks and today: the scorecard, the days, the weeks and the cohorts. */
  trend: AnalyticsReport;
  /** The last four weeks. */
  recent: AnalyticsReport;
  /** The four weeks before them, for growth by source. */
  prior: AnalyticsReport;
  /** The last four weeks' gameplay numbers, or null before the function exists. */
  gameplay: GameplayReport | null;
}

const RECENT_DAYS = 28;

const STANDING_CLASS: Record<Standing, string> = {
  nowhere: "weak",
  between: "between",
  promising: "promising",
  great: "great",
};

export function AnalyticsV2Page() {
  const today = todayDateString();
  const load = useCallback(async (): Promise<Dashboard[]> => {
    const eight = scorecardWindow(today);
    const recentFrom = addDays(today, 1 - RECENT_DAYS);
    const [trend, recent, prior, gameplay] = await Promise.all([
      fetchAnalytics(eight.from, eight.to, today),
      fetchAnalytics(recentFrom, today, today),
      fetchAnalytics(addDays(recentFrom, -RECENT_DAYS), addDays(recentFrom, -1), today),
      fetchGameplay(recentFrom, today, today),
    ]);
    return [{ trend, recent, prior, gameplay }];
  }, [today]);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const dashboard = rows[0];

  return (
    <ReviewPage
      title="Analytics v2"
      note="How the game is tracking against the bar for a daily word game, and why players come back."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nobody has played yet."
      isEmpty={!dashboard}
    >
      {dashboard && <Dashboard dashboard={dashboard} today={today} />}
    </ReviewPage>
  );
}

function Dashboard({ dashboard, today }: { dashboard: Dashboard; today: string }) {
  const { trend, recent, prior, gameplay } = dashboard;
  const rows = scorecard(trend, gameplay, today);
  // Closed days only: today's puzzle is still filling up.
  const closed = trend.daily.filter((d) => d.date < today);
  const all = recent.groups.all;
  const fresh = recent.groups.new;
  const lastWeek = trend.weekly[1];
  const newPlayers = recent.sources.reduce((sum, s) => sum + s.players, 0);
  const fromShares = recent.sources.filter((s) => SHARE_SOURCES.has(s.source)).reduce((sum, s) => sum + s.players, 0);
  const referred = recent.sources.filter((s) => s.source !== "direct").reduce((sum, s) => sum + s.players, 0);

  return (
    <div className="analytics">
      <Section title="Scorecard" note="Each category against the bands for a small daily browser word game.">
        <Scorecard rows={rows} />
      </Section>

      <Section title="Acquisition" note="Last four weeks.">
        <Tiles
          items={[
            { label: "Unique visitors", value: fmt(all.players) },
            { label: "First-time players", value: fmt(fresh.players), note: `${share(fresh.players, all.players)} of visitors` },
            { label: "From a link or search", value: fmt(referred), note: `${share(referred, newPlayers)} of new players` },
          ]}
        />
        <SourceTable sources={recent.sources} />
      </Section>

      <Section title="Retention" note="Strict: played again exactly 1, 7 or 30 days after their first day.">
        {gameplay ? (
          <Tiles
            items={(["d1", "d7", "d30"] as const).map((d) => ({
              label: d.toUpperCase(),
              value: rateValue(gameplay.retention[d]),
              note: `of ${fmt(gameplay.retention[d].cohort)} new players`,
            }))}
          />
        ) : (
          <Pending />
        )}
        <CohortTable report={trend} />
      </Section>

      <Section
        title="Engagement"
        note="Active means banked a word; a visit that never guesses is counted under Acquisition. Last four weeks, unless it says otherwise."
      >
        <Tiles
          items={[
            { label: "Daily active (last 7 days)", value: fmt(Math.round(rolling(closed, 7))) },
            {
              label: "Weekly active (last full week)",
              value: lastWeek ? fmt(lastWeek.played.oneDay + lastWeek.played.twoToThree + lastWeek.played.fourPlus) : "–",
            },
            { label: "Started a puzzle", value: fmt(all.acted), note: `${share(all.acted, all.players)} of visitors` },
            { label: "Banked a word", value: fmt(all.guessed), note: `${share(all.guessed, all.players)} of visitors` },
            { label: "Completion rate", value: share(all.completed, all.guessed), note: "of players who banked a word finished" },
          ]}
        />
        {lastWeek && (
          <p className="review__meta analytics__note">
            Play frequency, last full week ({lastWeek.start} to {lastWeek.end}), of the players who banked a word:{" "}
            {frequency(lastWeek.played)}.
          </p>
        )}
      </Section>

      <Section title="Virality" note="Last four weeks.">
        <Tiles
          items={[
            { label: "Share rate", value: share(all.shared, all.guessed), note: "of players who banked a word shared" },
            { label: "Referral visits", value: fmt(referred), note: "new players who came from a link or search" },
            { label: "New players from shares", value: fmt(fromShares), note: `${share(fromShares, newPlayers)} of new players` },
          ]}
        />
      </Section>

      <Section title="Momentum">
        <Tiles
          items={[
            {
              label: "Rolling 7-day DAU",
              value: fmt(Math.round(rolling(closed, 7))),
              note: `${growth(rolling(closed, 7), rolling(closed.slice(0, -7), 7))} on the week before`,
            },
            {
              label: "Rolling 28-day DAU",
              value: fmt(Math.round(rolling(closed, 28))),
              note: `${growth(rolling(closed, 28), rolling(closed.slice(0, -28), 28))} on the 28 days before`,
            },
          ]}
        />
        <WeeksTable report={trend} />
        <SourceGrowthTable recent={recent.sources} prior={prior.sources} />
      </Section>

      <Section title="Why players come back" note="The numbers particular to WordInk. Last four weeks.">
        {gameplay ? <Gameplay recent={recent} gameplay={gameplay} /> : <Pending />}
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

function Pending() {
  return (
    <p className="review__meta analytics__note">
      Waiting on the analytics_gameplay function (the 2026-10-30 migration) to be applied.
    </p>
  );
}

function Scorecard({ rows }: { rows: ScorecardRow[] }) {
  return (
    <>
      <div className="analytics__table-wrap">
        <table className="analytics__table scorecard">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Going nowhere</th>
              <th scope="col">Promising</th>
              <th scope="col">Great shape</th>
              <th scope="col">WordInk</th>
              <th scope="col">Standing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric}>
                <th scope="row">{r.metric}</th>
                {(["nowhere", "promising", "great"] as const).map((band) => (
                  <td key={band} className="scorecard__band" data-hit={r.standing === band}>
                    {r.bands[band]}
                  </td>
                ))}
                <td>
                  <strong>{r.value ?? "–"}</strong>
                </td>
                <td>
                  <span
                    className={`analytics__verdict analytics__verdict--${r.standing ? STANDING_CLASS[r.standing] : "early"}`}
                  >
                    {r.standing ? STANDING_NAMES[r.standing] : "Too early"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="analytics__bullets scorecard__notes">
        {rows.map((r) => (
          <li key={r.metric} className="review__meta">
            <strong>{r.metric.replace("*", "")}:</strong> {r.value === null ? `needs ${r.needs}.` : `${r.detail}.`}{" "}
            {r.howMeasured}
          </li>
        ))}
      </ul>
    </>
  );
}

interface Tile {
  label: string;
  value: string;
  note?: string;
}

function Tiles({ items }: { items: Tile[] }) {
  return (
    <dl className="dash__tiles">
      {items.map((t) => (
        <div key={t.label} className="dash__tile">
          <dt className="analytics__n">{t.label}</dt>
          <dd className="dash__value">{t.value}</dd>
          {t.note && <dd className="analytics__n">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function SourceTable({ sources }: { sources: SourceRow[] }) {
  const total = sources.reduce((sum, s) => sum + s.players, 0);
  if (total === 0) return null;
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <thead>
          <tr>
            <th scope="col">Traffic source</th>
            <th scope="col">New players</th>
            <th scope="col">Share</th>
            <th scope="col">Banked a word</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.source}>
              <th scope="row">{sourceName(s.source)}</th>
              <td>{fmt(s.players)}</td>
              <td>{share(s.players, total)}</td>
              <td>{share(s.guessed, s.players)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Weekly cohort retention: of each arrival week, the share back in each week after. */
function CohortTable({ report }: { report: AnalyticsReport }) {
  const cohorts = report.cohorts.slice(0, 8);
  const span = Math.min(8, Math.max(0, ...cohorts.map((c) => c.weeks.length)));
  if (cohorts.length === 0) return null;
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <caption className="review__meta dash__caption">
          Weekly cohorts: of the players who arrived in a week, the share who played in each week after.
        </caption>
        <thead>
          <tr>
            <th scope="col">Arrived week of</th>
            <th scope="col">Players</th>
            {Array.from({ length: span }, (_, k) => (
              <th key={k} scope="col">
                W{k + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.start}>
              <th scope="row">{c.start}</th>
              <td>{fmt(c.players)}</td>
              {Array.from({ length: span }, (_, k) => {
                const w = c.weeks[k];
                const s = w && c.players > 0 ? w.players / c.players : null;
                return (
                  <td key={k} className="analytics__heat" style={{ "--heat": s ?? 0 } as CSSProperties}>
                    {s === null ? "" : pct(s)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** New against returning players, week by week. */
function WeeksTable({ report }: { report: AnalyticsReport }) {
  const weeks = report.weekly.slice(0, 8);
  if (weeks.length === 0) return null;
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <caption className="review__meta dash__caption">
          Weekly visitors (anyone who turned up), new against returning. The top week is still counting up.
        </caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Players</th>
            <th scope="col">New</th>
            <th scope="col">Returning</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w.start}>
              <th scope="row">{w.start}</th>
              <td>{fmt(w.players.all)}</td>
              <td>{fmt(w.players.new)}</td>
              <td>{fmt(w.players.returning)}</td>
              <td>{i === 0 ? "" : growth(w.players.all, weeks[i + 1]?.players.all)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** New players by source, the last four weeks against the four before. */
function SourceGrowthTable({ recent, prior }: { recent: SourceRow[]; prior: SourceRow[] }) {
  const sources = [...new Set([...recent, ...prior].map((s) => s.source))];
  const count = (rows: SourceRow[], source: string) => rows.find((s) => s.source === source)?.players ?? 0;
  sources.sort((a, b) => count(recent, b) - count(recent, a) || count(prior, b) - count(prior, a));
  if (sources.length === 0) return null;
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <caption className="review__meta dash__caption">
          Growth by acquisition source: new players over the last four weeks against the four before.
        </caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Last 4 weeks</th>
            <th scope="col">4 weeks before</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s}>
              <th scope="row">{sourceName(s)}</th>
              <td>{fmt(count(recent, s))}</td>
              <td>{fmt(count(prior, s))}</td>
              <td>{growth(count(recent, s), count(prior, s))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gameplay({ recent, gameplay }: { recent: AnalyticsReport; gameplay: GameplayReport }) {
  const fresh = recent.groups.new;
  const all = recent.groups.all;
  const lb = gameplay.leaderboard;
  const finished = gameplay.scores.reduce((sum, s) => sum + s.finished, 0);
  return (
    <>
      <h3 className="dash__subheading">Activation rate</h3>
      <Tiles
        items={[
          {
            label: "First-timers who banked a word",
            value: share(fresh.guessed, fresh.players),
            note: `${fmt(fresh.guessed)} of ${fmt(fresh.players)} first-time players`,
          },
        ]}
      />

      <h3 className="dash__subheading">Completion and results sharing</h3>
      <Tiles
        items={[
          { label: "Finished the puzzle", value: share(all.completed, all.guessed), note: "of players who banked a word" },
          { label: "Shared their result", value: share(all.shared, all.completed), note: "of players who finished" },
        ]}
      />

      <h3 className="dash__subheading">Leaderboard engagement</h3>
      <Tiles
        items={[
          { label: "Opened the leaderboard", value: share(lb.viewers, lb.players), note: `${fmt(lb.viewers)} of ${fmt(lb.players)} players` },
          {
            label: "Checks a day",
            value: lb.viewDays > 0 ? (lb.opens / lb.viewDays).toFixed(1) : "–",
            note: `opens on a day they looked; ${lb.viewers > 0 ? (lb.viewDays / lb.viewers).toFixed(1) : "–"} days each`,
          },
          { label: "Back next puzzle, after opening it", value: rateValue(lb.viewed), note: `of ${fmt(lb.viewed.cohort)} guessing days` },
          { label: "Back next puzzle, without", value: rateValue(lb.notViewed), note: `of ${fmt(lb.notViewed.cohort)} guessing days` },
        ]}
      />

      <h3 className="dash__subheading">Score satisfaction</h3>
      {finished === 0 ? (
        <p className="review__meta analytics__note">No finished puzzles in the window.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <caption className="review__meta dash__caption">
              Finished puzzles by the tier of the best word, a player&apos;s day once.
            </caption>
            <thead>
              <tr>
                <th scope="col">Best word</th>
                <th scope="col">Finished</th>
                <th scope="col">Of all</th>
                <th scope="col">Shared</th>
                <th scope="col">Back next puzzle</th>
              </tr>
            </thead>
            <tbody>
              {gameplay.scores.map((s) => (
                <tr key={s.tier}>
                  <th scope="row">{s.tier}</th>
                  <td>{fmt(s.finished)}</td>
                  <td className="analytics__heat" style={{ "--heat": s.finished / finished } as CSSProperties}>
                    {pct(s.finished / finished)}
                  </td>
                  <td>{share(s.shared, s.finished)}</td>
                  <td>{rateValue(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="dash__subheading">Return after sharing</h3>
      <Tiles
        items={[
          { label: "Back next puzzle, after sharing", value: rateValue(gameplay.sharing.shared), note: `of ${fmt(gameplay.sharing.shared.cohort)} guessing days` },
          { label: "Back next puzzle, without", value: rateValue(gameplay.sharing.notShared), note: `of ${fmt(gameplay.sharing.notShared.cohort)} guessing days` },
        ]}
      />
    </>
  );
}

function share(part: number, whole: number): string {
  return whole > 0 ? pct(part / whole) : "–";
}

function rateValue(r: Rate): string {
  return share(r.returned, r.cohort);
}

/** The average daily active players -- the ones who banked a word -- over the last `n` of `days`. */
function rolling(days: AnalyticsReport["daily"], n: number): number {
  const span = days.slice(-n);
  return span.length === 0 ? 0 : span.reduce((sum, d) => sum + d.groups.all.guessed, 0) / span.length;
}

function frequency(played: { oneDay: number; twoToThree: number; fourPlus: number }): string {
  const total = played.oneDay + played.twoToThree + played.fourPlus;
  return [
    `${share(played.oneDay, total)} one day`,
    `${share(played.twoToThree, total)} two or three`,
    `${share(played.fourPlus, total)} four or more`,
  ].join(", ");
}
