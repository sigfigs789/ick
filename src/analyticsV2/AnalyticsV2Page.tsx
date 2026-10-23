import { useCallback, type CSSProperties, type ReactNode } from "react";
import { ReviewPage } from "../components/ReviewPage";
import { useReviewList } from "../components/reviewList";
import { todayDateString } from "../game/date";
import { fetchReport, type Rate, type Report, type Source } from "./report";
import { ExperimentView } from "./ExperimentView";
import {
  addDays,
  average,
  count,
  lastSaturday,
  moved,
  percent,
  scorecard,
  STANDING_NAMES,
  type Row,
} from "./scorecard";

/**
 * The daily dashboard, at /analyticsV2.
 *
 * A scorecard against the bands for a small daily browser word game, then
 * acquisition, retention, engagement, virality and momentum, then the numbers
 * particular to WordInk that say why players come back or leave.
 *
 * Visitors and players are kept apart throughout: a visitor turned up, a
 * player banked a word. Activation is the step between them. Retention, active
 * players, frequency and sharing are all over players; visitor counts sit
 * beside them where they help.
 *
 * Built on its own report (report.ts, and the analytics_v2 function behind
 * it), not on /analytics. Weeks run Sunday to Saturday. Windows are the last
 * 28 closed days unless a number says otherwise; today's puzzle is still
 * filling up and is left out.
 *
 * Unlinked from the game and open without a key: every number is an aggregate.
 */
export function AnalyticsV2Page() {
  const today = todayDateString();
  // Yesterday's report is only for the scorecard's day-on-day change, so a
  // failure there leaves the changes blank rather than the page.
  const load = useCallback(async () => {
    const [report, before] = await Promise.all([fetchReport(today, true), fetchReport(addDays(today, -1)).catch(() => null)]);
    return [{ report, before }];
  }, [today]);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const report = rows[0]?.report;
  const before = rows[0]?.before ?? null;
  return (
    <ReviewPage
      title="Analytics v2"
      note="How WordInk is tracking against the bar for a daily word game, and why players come back."
      count={0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nobody has played yet."
      isEmpty={!report}
    >
      {report && <Dashboard report={report} before={before} />}
    </ReviewPage>
  );
}

function Dashboard({ report, before }: { report: Report; before: Report | null }) {
  const w = report.window;
  const yesterday = addDays(report.today, -1);
  const saturday = lastSaturday(report.today);
  const lastWeek = report.weekly[1];
  const from28 = addDays(report.today, -28);
  // A visitor number over a window that starts before visits were recorded
  // against players is not a number.
  const tracked = (from: string) => report.trackedSince !== null && report.trackedSince <= from;
  const newPlayers28 = report.daily
    .filter((d) => d.date >= from28 && d.date <= yesterday)
    .reduce((sum, d) => sum + d.newPlayers, 0);
  const dau7 = average(report.daily, yesterday, 7);
  const dau28 = average(report.daily, yesterday, 28);
  const dau7Before = average(report.daily, addDays(yesterday, -28), 7);
  const dau28Before = average(report.daily, addDays(yesterday, -28), 28);
  const visitors7 = average(report.daily, yesterday, 7, "visitors");
  const finished = report.scores.tiers.reduce((sum, t) => sum + t.finished, 0);
  const top = report.scores.tiers
    .filter((t) => t.tier === "Mythic" || t.tier === "Legend")
    .reduce((sum, t) => sum + t.finished, 0);

  return (
    <div className="av2">
      {report.trackedSince && (
        <p className="review__meta av2__note">
          Visits have been recorded against players since {report.trackedSince}; before that only players (from the
          leaderboard) are known, so a visitor number reaching further back is left blank.
        </p>
      )}

      <Section
        title="Scorecard"
        note="Each category against the bands for a small daily browser word game. Over players. Arrows are the change since yesterday."
      >
        <Scorecard rows={scorecard(report)} before={before ? scorecard(before) : []} />
      </Section>

      {report.wordOfDay && (
        <Section
          title="Experiment: word of the day"
          note="Whether showing the word of the day under a finished puzzle moves the scorecard. Over players."
        >
          <ExperimentView
            experiment={report.wordOfDay}
            subject="the word of the day"
            about={
              <>
                Half of players never see the word under a finished puzzle&rsquo;s drop. Each is drawn once, the first
                time they finish a puzzle. Try either arm with <code>?word-of-day=hidden</code> or <code>=shown</code>;
                a forced arm is not counted.
              </>
            }
          />
        </Section>
      )}

      {report.comeBack && (
        <Section
          title="Experiment: come-back tip"
          note="Whether the line under the streak saying what tomorrow is worth moves the scorecard. Over players."
        >
          <ExperimentView
            experiment={report.comeBack}
            subject="the come-back tip"
            about={
              <>
                Half of players never see the line under the streak that says what tomorrow is worth. Each is drawn
                once, the first time it would appear: a word banked on today&rsquo;s puzzle. Try either arm with{" "}
                <code>?come-back=hidden</code> or <code>=shown</code>; a forced arm, or a tester, is not counted.
              </>
            }
          />
        </Section>
      )}

      <Section title="Acquisition" note="Last 28 days.">
        <Tiles
          tiles={[
            { label: "Unique visitors", value: count(w.visitors) },
            { label: "First-time visitors", value: count(w.firstVisits) },
            { label: "First-time players", value: count(newPlayers28), note: "banked their first-ever word" },
          ]}
        />
        <SourceTable sources={report.sources} />
      </Section>

      <Section title="Retention" note="Players: back means banked a word again on exactly day N.">
        <Tiles
          tiles={(["d1", "d7", "d30"] as const).map((d) => {
            const n = Number(d.slice(1));
            const visitorsShown = tracked(addDays(report.today, -n - 28));
            return {
              label: d.toUpperCase(),
              value: share(report.retention[d].players),
              note:
                `of ${count(report.retention[d].players.cohort)} players · visitors ` +
                (visitorsShown ? share(report.retention[d].visitors) : "not enough history"),
            };
          })}
        />
        <CohortTable report={report} />
      </Section>

      <Section title="Engagement" note="Active means banked a word. Last 28 days unless it says otherwise.">
        <Tiles
          tiles={[
            { label: "Daily active players", value: fixed(dau7), note: `last 7 days · ${fixed(visitors7)} visitors a day` },
            {
              label: "Weekly active players",
              value: lastWeek ? count(lastWeek.players) : "–",
              note: lastWeek ? `week of ${lastWeek.start} · ${count(lastWeek.visitors)} visitors` : undefined,
            },
            {
              label: "Games started",
              value: count(w.startedDays),
              note: `${ratio(w.startedDays, w.visitorDays)} of visits tried a word`,
            },
            {
              label: "Completion rate",
              value: ratio(w.completedDays, w.playerDays),
              note: "of player-days finished the puzzle",
            },
          ]}
        />
        {lastWeek && <Frequency daysPlayed={lastWeek.daysPlayed} players={lastWeek.players} start={lastWeek.start} />}
      </Section>

      <Section title="Virality" note="Last 28 days.">
        <Tiles
          tiles={[
            { label: "Share rate", value: ratio(w.sharedDays, w.playerDays), note: `of player-days · ${count(w.sharers)} sharers` },
            { label: "Referral visits", value: count(w.referralVisits), note: "visits through a share link" },
            {
              label: "New players through shares",
              value: count(w.referralNewPlayers),
              note: `of ${count(w.referralNewVisitors)} first-time visitors from a share link`,
            },
          ]}
        />
      </Section>

      <Section title="Momentum">
        <Tiles
          tiles={[
            { label: "Rolling 7-day DAU", value: fixed(dau7), note: `${change(dau7, dau7Before)} on 4 weeks before` },
            { label: "Rolling 28-day DAU", value: fixed(dau28), note: `${change(dau28, dau28Before)} on the 28 days before` },
          ]}
        />
        <WeeksTable report={report} saturday={saturday} />
        <SourceGrowthTable sources={report.sources} priorTracked={tracked(addDays(report.today, -56))} />
      </Section>

      <Section title="Why players come back" note="The numbers particular to WordInk. Last 28 days.">
        <h3 className="av2__subheading">Activation rate</h3>
        <Tiles
          tiles={[
            {
              label: "First-time visitors who banked a word",
              value: ratio(w.firstVisitPlayed, w.firstVisits),
              note: `${count(w.firstVisitPlayed)} of ${count(w.firstVisits)} · ${ratio(w.firstVisitStarted, w.firstVisits)} tried one`,
            },
          ]}
        />

        <h3 className="av2__subheading">Completion and results sharing</h3>
        <Tiles
          tiles={[
            { label: "Finished the puzzle", value: ratio(w.completedDays, w.playerDays), note: "of player-days" },
            { label: "Shared after finishing", value: ratio(w.completedSharedDays, w.completedDays), note: "of finished puzzles" },
          ]}
        />
        <p className="review__meta av2__note">
          Finishing shows the final score, so finished puzzles stand in for &ldquo;viewed their final score&rdquo;.
        </p>

        <h3 className="av2__subheading">Leaderboard engagement</h3>
        <Tiles
          tiles={[
            { label: "Players who opened it", value: ratio(w.boardViewers, w.players), note: `${count(w.boardViewers)} of ${count(w.players)}` },
            {
              label: "Rank checks",
              value: w.boardViewDays > 0 ? (w.boardOpens / w.boardViewDays).toFixed(1) : "–",
              note: `opens a day they looked · ${w.boardViewers > 0 ? (w.boardViewDays / w.boardViewers).toFixed(1) : "–"} days each`,
            },
            { label: "Played next day, after opening it", value: share(w.afterBoard.viewed), note: `of ${count(w.afterBoard.viewed.cohort)} player-days` },
            { label: "Played next day, without", value: share(w.afterBoard.notViewed), note: `of ${count(w.afterBoard.notViewed.cohort)} player-days` },
          ]}
        />

        <h3 className="av2__subheading">Score satisfaction</h3>
        {finished === 0 ? (
          <p className="review__meta av2__note">No finished puzzles in the last 28 days.</p>
        ) : (
          <>
            <Tiles
              tiles={[
                { label: "Top ratings", value: ratio(top, finished), note: "of finished puzzles ended on Mythic or Legend" },
              ]}
            />
            <ScoreBuckets buckets={report.scores.buckets} />
            <TierTable report={report} finished={finished} />
          </>
        )}

        <h3 className="av2__subheading">Return after sharing</h3>
        <Tiles
          tiles={[
            {
              label: "Played again after sharing",
              value: share(w.afterShare.shared),
              note: `next day · ${weekShare(w.afterShare.shared)} within a week`,
            },
            {
              label: "Played again without sharing",
              value: share(w.afterShare.notShared),
              note: `next day · ${weekShare(w.afterShare.notShared)} within a week`,
            },
          ]}
        />
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="av2__section">
      <h2 className="av2__heading">{title}</h2>
      {note && <p className="review__meta av2__note">{note}</p>}
      {children}
    </section>
  );
}

function Scorecard({ rows, before }: { rows: Row[]; before: Row[] }) {
  return (
    <>
      <div className="av2__table-wrap">
        <table className="av2__table av2__scorecard">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">WordInk</th>
              <th scope="col">Going nowhere</th>
              <th scope="col">Promising</th>
              <th scope="col">Great shape</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric}>
                <th scope="row">{r.metric}</th>
                <td className="av2__standing">
                  <strong className="av2__score">
                    {r.value ?? "–"}
                    <Moved by={moved(r, before.find((b) => b.metric === r.metric))} />
                  </strong>
                  <span className={`av2__pill av2__pill--${r.standing ?? "early"}`}>
                    {r.standing ? STANDING_NAMES[r.standing] : "Too early"}
                  </span>
                </td>
                {(["nowhere", "promising", "great"] as const).map((band) => (
                  <td key={band} className="av2__band" data-hit={r.standing === band}>
                    {r.bands[band]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="av2__notes">
        {rows.map((r) => (
          <li key={r.metric}>
            <strong>{r.metric.replace("*", "")}:</strong> {r.detail}. {r.how}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The change since yesterday, in points: up, down, or level. */
function Moved({ by }: { by: number | null }) {
  if (by === null) return null;
  const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;
  const [dir, mark, label] =
    by > 0 ? ["up", "▲", `up ${pts(by)} since yesterday`] : by < 0 ? ["down", "▼", `down ${pts(-by)} since yesterday`] : ["level", "–", "no change since yesterday"];
  return (
    <span className={`av2__moved av2__moved--${dir}`} title={label} aria-label={label}>
      <span aria-hidden="true">
        {mark}
        {by !== 0 && ` ${Math.abs(by)}`}
      </span>
    </span>
  );
}

interface Tile {
  label: string;
  value: string;
  note?: string;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="av2__tiles">
      {tiles.map((t) => (
        <div key={t.label} className="av2__tile">
          <dt className="av2__label">{t.label}</dt>
          <dd className="av2__value">{t.value}</dd>
          {t.note && <dd className="av2__label">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="av2__table-wrap">
      <p className="review__meta av2__caption">{caption}</p>
      <table className="av2__table" aria-label={caption}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  direct: "Direct",
  share: "Share link",
  t: "Share link on X",
  google: "Google",
  bing: "Bing",
  reddit: "Reddit",
  unknown: "Unknown",
};

const sourceName = (source: string) => SOURCE_NAMES[source] ?? source;

function SourceTable({ sources }: { sources: Source[] }) {
  const recent = sources.filter((s) => s.recent > 0);
  const total = recent.reduce((sum, s) => sum + s.recent, 0);
  if (total === 0) return null;
  return (
    <Table
      caption="Traffic source: where first-time visitors came from, and how many became players."
      head={["Source", "First-time visitors", "Of all", "Became players", "Rate"]}
      rows={recent.map((s) => [
        sourceName(s.source),
        count(s.recent),
        ratio(s.recent, total),
        count(s.recentPlayers),
        ratio(s.recentPlayers, s.recent),
      ])}
    />
  );
}

const COHORT_CAPTION =
  "Weekly cohorts: players by the week of their first word (Sunday to Saturday), and the share who banked a word in each week after.";

function CohortTable({ report }: { report: Report }) {
  const cohorts = report.cohorts.filter((c) => c.players > 0).slice(0, 10);
  const span = Math.min(8, Math.max(0, ...cohorts.map((c) => c.weeks.length)));
  if (cohorts.length === 0) return null;
  return (
    <div className="av2__table-wrap">
      <p className="review__meta av2__caption">{COHORT_CAPTION}</p>
      <table className="av2__table" aria-label={COHORT_CAPTION}>
        <thead>
          <tr>
            <th scope="col">First word, week of</th>
            <th scope="col">Players</th>
            {Array.from({ length: span }, (_, k) => (
              <th key={k} scope="col">
                Wk {k + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.start}>
              <th scope="row">{c.start}</th>
              <td>{count(c.players)}</td>
              {Array.from({ length: span }, (_, k) => {
                const n = c.weeks[k];
                const s = n === undefined ? null : n / c.players;
                return (
                  <td key={k} className="av2__heat" style={{ "--heat": s ?? 0 } as CSSProperties}>
                    {s === null ? "" : percent(s)}
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

function Frequency({ daysPlayed, players, start }: { daysPlayed: Record<number, number>; players: number; start: string }) {
  if (players === 0) return null;
  return (
    <Table
      caption={`Play frequency: the week of ${start}'s players by how many of its 7 days they banked a word.`}
      head={["Days played", "Players", "Share"]}
      rows={[1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), count(daysPlayed[n] ?? 0), ratio(daysPlayed[n] ?? 0, players)])}
    />
  );
}

function WeeksTable({ report, saturday }: { report: Report; saturday: string }) {
  const weeks = report.weekly.slice(0, 9);
  if (weeks.length === 0) return null;
  return (
    <Table
      caption="New against returning players, week by week (Sunday to Saturday). The top week is still counting."
      head={["Week of", "Players", "New", "Returning", "Change", "Visitors"]}
      rows={weeks.map((w, i) => [
        w.start > saturday ? `${w.start} (so far)` : w.start,
        count(w.players),
        count(w.newPlayers),
        count(w.players - w.newPlayers),
        i === 0 ? "" : change(w.players, weeks[i + 1]?.players ?? null),
        report.trackedSince !== null && report.trackedSince <= w.start ? count(w.visitors) : "–",
      ])}
    />
  );
}

function SourceGrowthTable({ sources, priorTracked }: { sources: Source[]; priorTracked: boolean }) {
  const rows = sources.filter((s) => s.recentPlayers > 0 || s.priorPlayers > 0);
  if (rows.length === 0) return null;
  return (
    <>
      <Table
        caption="Growth by acquisition source: new players over the last 28 days against the 28 before."
        head={["Source", "Last 28 days", "28 days before", "Change"]}
        rows={rows.map((s) => [
          sourceName(s.source),
          count(s.recentPlayers),
          priorTracked ? count(s.priorPlayers) : "–",
          priorTracked ? change(s.recentPlayers, s.priorPlayers) : "–",
        ])}
      />
      {!priorTracked && (
        <p className="review__meta av2__note">
          The 28 days before reach back past when sources were first recorded, so there is nothing to grow from yet.
        </p>
      )}
    </>
  );
}

function ScoreBuckets({ buckets }: { buckets: Record<number, number> }) {
  const total = Object.values(buckets).reduce((sum, n) => sum + n, 0);
  const max = Math.max(1, ...Object.values(buckets));
  return (
    <>
    <p className="review__meta av2__caption">Best score of each finished puzzle, by whole point.</p>
    <div className="av2__bars" role="img" aria-label="Best scores of finished puzzles, by whole point">
      {Array.from({ length: 11 }, (_, b) => (
        <div key={b} className="av2__bar-col" title={`${b}: ${count(buckets[b] ?? 0)}`}>
          <span className="av2__label">{ratio(buckets[b] ?? 0, total)}</span>
          <span className="av2__bar" style={{ "--h": (buckets[b] ?? 0) / max } as CSSProperties} />
          <span className="av2__label">{b}</span>
        </div>
      ))}
    </div>
    </>
  );
}

function TierTable({ report, finished }: { report: Report; finished: number }) {
  return (
    <Table
      caption="Finished puzzles by the rating of the best word, a player's day once: how often each lands, and whether players shared or came back after it."
      head={["Best word", "Finished", "Of all", "Shared", "Played next day"]}
      rows={report.scores.tiers.map((t) => [
        t.tier,
        count(t.finished),
        ratio(t.finished, finished),
        ratio(t.shared, t.finished),
        share(t),
      ])}
    />
  );
}

function ratio(part: number, whole: number): string {
  return whole > 0 ? percent(part / whole) : "–";
}

function share(r: Rate): string {
  return ratio(r.returned, r.cohort);
}

function weekShare(r: { weekCohort: number; weekReturned: number }): string {
  return ratio(r.weekReturned, r.weekCohort);
}

function fixed(n: number | null): string {
  return n === null ? "–" : n.toFixed(1);
}

function change(now: number | null, before: number | null): string {
  if (now === null || before === null || before === 0) return "–";
  return percent(now / before - 1, true);
}
