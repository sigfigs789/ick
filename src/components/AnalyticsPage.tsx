import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import {
  fetchAnalytics,
  fetchAnalyticsRange,
  type AnalyticsReport,
  type ChatReport,
  type CopyReport,
  type EstimatesReport,
  type EstimatesSpan,
  type OnboardingReason,
  type OnboardingReport,
  type PerfectPopulation,
  type PerfectsReport,
  type Rate,
  type ReturnersReport,
  type StopStats,
} from "../game/review";
import {
  MODE_NAMES,
  WEEKDAYS,
  dec,
  dowOf,
  duration,
  fmt,
  moveRange,
  pct,
  sourceName,
  type DateRange,
} from "./analyticsFormat";
import { todayDateString } from "../game/date";
import { DailyChart } from "./DailyChart";

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
 * window: opens, sessions, shares, sources. Beside the players sit the ones who
 * only looked -- opened the leaderboard or the found words on a puzzle and
 * banked nothing -- counted off the open events, and kept visibly apart
 * (their own tile, a grey segment) so they never inflate a count of players.
 *
 * Unlinked, but open without a key (see api/review.ts). Nothing on it
 * identifies anybody -- the smallest group any number is taken over is a day's
 * players -- so the maintainer can open it without a password, and it stays
 * out of the game's navigation because it is not a page for the people
 * playing it.
 */

/** 1 is today: the viewer's own puzzle, alone. */
const WINDOWS = [1, 7, 30, 60, 90] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AnalyticsPage() {
  const [days, setDays] = useState<number>(60);
  const [range, setRange] = useState<DateRange | null>(null);
  const load = useCallback(
    async () => [await (range ? fetchAnalyticsRange(range.from, range.to) : fetchAnalytics(days, todayDateString()))],
    [days, range],
  );
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
      {report && (
        <Report
          report={report}
          days={days}
          range={range}
          onDays={(n) => {
            setRange(null);
            setDays(n);
          }}
          onRange={setRange}
        />
      )}
    </ReviewPage>
  );
}

/** An hour of the day on a 12-hour clock: 12am, 3pm. */
function clockHour(hour: number): string {
  return `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;
}

function Report({
  report,
  days,
  range,
  onDays,
  onRange,
}: {
  report: AnalyticsReport;
  days: number;
  range: DateRange | null;
  onDays: (days: number) => void;
  onRange: (range: DateRange) => void;
}) {
  const { totals, retention, window: win } = report;
  // "Today" is the viewer's own calendar date, read off the per-puzzle rows,
  // rather than the report's `asOf` -- the latest puzzle anybody has played,
  // which runs a day ahead of the viewer once a player further east is on
  // tomorrow's, and a day behind in the minutes before anybody is on today's.
  const today = todayDateString();
  // One puzzle: today, or a single day picked. Some tiles need more than one.
  const isToday = report.windowDays === 1;
  const lastDay = win.to ?? today;
  const puzzleName = lastDay === today ? "today's puzzle" : `the ${lastDay} puzzle`;
  // The dates the inputs show: the picked range, or the preset's own days.
  const shown: DateRange = range ?? { from: win.from ?? today, to: lastDay };
  // The headline tiles count over the window: one puzzle, a picked range, or the
  // same puzzles the day-by-day chart spans.
  const span = isToday
    ? `puzzle ${lastDay}`
    : range
      ? `${shown.from} to ${shown.to}`
      : `over the last ${fmt(win.puzzles)} puzzles`;
  // The same, as the start of a section's note.
  const windowName = isToday
    ? puzzleName.charAt(0).toUpperCase() + puzzleName.slice(1)
    : range
      ? `The puzzles from ${shown.from} to ${shown.to}`
      : `The last ${report.windowDays} puzzles`;
  // The visit half: receipt time over a span of days (a picked range by its
  // calendar days in Mountain Time), or on one puzzle the events stamped with
  // it, which only rows from `visitsSince` are.
  const eventSpan = isToday
    ? `on ${puzzleName}${report.visitsSince ? ` (stamped from ${report.visitsSince})` : " (not stamped yet)"}`
    : range
      ? `from ${shown.from} to ${shown.to} (Mountain Time)`
      : `in the last ${report.windowDays} days`;

  return (
    <div className="analytics">
      <div className="analytics__window" role="group" aria-label="Time window">
        <span className="analytics__window-label">Window</span>
        {WINDOWS.map((n) => (
          <button
            key={n}
            type="button"
            className="analytics__window-button"
            aria-pressed={!range && n === days}
            onClick={() => onDays(n)}
          >
            {n === 1 ? "Today" : `${n} days`}
          </button>
        ))}
        <span className="analytics__window-dates">
          <label>
            <span className="analytics__window-label">From</span>
            <input
              type="date"
              className="analytics__window-date"
              value={shown.from}
              min={totals.firstDay ?? undefined}
              max={today}
              data-active={range !== null}
              onChange={(e) => e.target.value && onRange(moveRange(shown, "from", e.target.value))}
            />
          </label>
          <label>
            <span className="analytics__window-label">to</span>
            <input
              type="date"
              className="analytics__window-date"
              value={shown.to}
              min={totals.firstDay ?? undefined}
              max={today}
              data-active={range !== null}
              onChange={(e) => e.target.value && onRange(moveRange(shown, "to", e.target.value))}
            />
          </label>
        </span>
      </div>

      <div className="analytics__tiles">
        <Tile label="Players" value={fmt(win.players)} sub={span} />
        <Tile
          label="New players"
          value={fmt(win.newPlayers)}
          sub={win.players ? `${pct(win.newPlayers / win.players)} of the players` : "first puzzle ever"}
        />
        <Tile
          label="Looked, didn't play"
          value={totals.lookersSince ? fmt(win.lookers) : "—"}
          sub={totals.lookersSince ? `${fmt(totals.lookersNeverPlayed)} have never played` : "not recorded yet"}
        />
        <Tile
          label="Stickiness"
          value={win.dauMau === null ? "—" : pct(win.dauMau)}
          sub={isToday ? "the puzzle's players ÷ 30-day players" : "DAU ÷ 30-day players, averaged"}
        />
        <Tile
          label="Days per player"
          value={!isToday && win.avgDaysPerPlayer !== null ? win.avgDaysPerPlayer.toFixed(1) : "—"}
          sub={isToday ? "needs more than one puzzle" : `of the ${fmt(win.puzzles)} puzzles, on average`}
        />
      </div>

      <VisitorTiles report={report} from={shown.from} eventSpan={eventSpan} />

      <Section
        title="Day by day"
        note="Hover the line to read any puzzle; click, use the arrow keys or pick a date to pin one. The change beside each number is against the puzzle before."
      >
        <DailyChart daily={report.daily} today={today} />
      </Section>

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
        title="Standard vs Freeform"
        note={`${windowName}, split by the rules each was played under, with the players who only opened the leaderboard or the found words on top in grey${
          totals.lookersSince ? ` (recorded from ${totals.lookersSince})` : ""
        }. A player who banked words in both modes on one day counts in both. Hover a day for its Standard and Freeform counts and new players.`}
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
              { value: d.lookers, series: "looked" },
            ],
            tip: `${d.date} (${SHORT_WEEKDAYS[dowOf(d.date)]}): ${d.players} players${modeSplit(d)}, ${d.newPlayers} new${
              d.lookers ? `, ${d.lookers} only looked` : ""
            }`,
          }))}
        />
        <p className="review__meta analytics__note">
          All time, per mode. Before Sep 27 a day’s mode was the one everybody played: the Freeform trial week (Sep
          14–26) against every Standard week around it. From Sep 27 each player chooses. Next day is the share of a
          mode’s plays followed by a play on the next puzzle, in either mode.
        </p>
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
          Switches {eventSpan}: {fmt(report.funnel.toFreeform)} to Freeform,{" "}
          {fmt(report.funnel.toStandard)} to Standard.
        </p>
      </Section>

      {report.onboarding && <OnboardingSection onboarding={report.onboarding} isToday={isToday} picked={range !== null} />}

      {report.copies && <CopySection copies={report.copies} windowName={windowName} />}

      {report.estimates && <EstimatesSection estimates={report.estimates} windowName={windowName} />}

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

      <Section title="When people open it" note="Visits by hour of day, Mountain Time.">
        <BarChart
          label="Visits by hour"
          bars={report.hours.map((h) => ({
            key: String(h.hour),
            axis: h.hour % 3 === 0 ? clockHour(h.hour) : "",
            segments: [{ value: h.visits, series: "single" }],
            tip: `${clockHour(h.hour)}–${clockHour((h.hour + 1) % 24)} MT: ${h.visits} visits`,
          }))}
          compact
        />
      </Section>

      <Section
        title="From open to share"
        note={`Events ${eventSpan}. Engaged is a visit that submitted a guess or opened the leaderboard or the found words.`}
      >
        <Visitors report={report} />
        <Funnel report={report} />
      </Section>

      <Section
        title="Where visits come from"
        note="By the source a visitor first arrived through. Engaged is a session that guessed or opened the leaderboard or the found words."
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
                  <th scope="col">Visitors</th>
                  <th scope="col">First visits</th>
                  <th scope="col">Engaged</th>
                  <th scope="col">Engaged per visit</th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((s) => (
                  <tr key={s.source}>
                    <th scope="row">{sourceName(s.source)}</th>
                    <td>{fmt(s.visits)}</td>
                    <td>{fmt(s.visitors)}</td>
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

      <Section title="Sessions" note={`Visible time on the page, per session, ${eventSpan}.`}>
        <div className="analytics__tiles">
          <Tile label="Sessions" value={fmt(report.sessions.sessions)} />
          <Tile label="Median session" value={duration(report.sessions.medianVisibleMs)} />
          <Tile label="Median, when they guessed" value={duration(report.sessions.medianPlayingMs)} />
          <Tile label="Time to first guess" value={duration(report.sessions.medianFirstGuessMs)} sub="median" />
          <Tile
            label="Sessions with a guess"
            value={report.sessions.guessedShare === null ? "—" : pct(report.sessions.guessedShare)}
          />
          <Tile
            label="Only looked"
            value={report.sessions.lookedOnlyShare === null ? "—" : pct(report.sessions.lookedOnlyShare)}
            sub={
              report.sessions.lookedOnlyShare === null
                ? "not recorded yet"
                : `${fmt(report.sessions.lookedOnly)} opened the boards or finds, no guess`
            }
          />
        </div>
      </Section>

      {report.chat && <ChatSection chat={report.chat} windowName={windowName} />}

      <MissingSection />

      {report.returners && <ReturnersSections returners={report.returners} isToday={isToday} windowName={windowName} />}

      {report.perfects && !isToday && <PerfectSection perfects={report.perfects} windowName={windowName} />}

      {report.perfects && !isToday && <SeenPerfectsSection perfects={report.perfects} windowName={windowName} />}

      {report.perfects?.casual && !isToday && (
        <CasualPerfectsSection
          casual={report.perfects.casual}
          windowName={`${windowName}${sinceNote(report.perfects.perfectSince)}`}
        />
      )}
    </div>
  );
}

const REASON_NAMES: Record<OnboardingReason, string> = {
  split: "Random split",
  shared: "Friend's link",
  default: "Default",
};
const REASON_ORDER: OnboardingReason[] = ["split", "shared", "default"];

/**
 * New players, by the mode they were started in (see game/onboarding.ts): a
 * friend's link starts them in the mode it was shared from, a share link from
 * before links carried a mode in Standard, and everyone else -- unattributed
 * arrivals included -- half and half. The split rows are the fair
 * comparison -- the only thing that differs between them is the mode.
 */
// Cohorts need days to come back in, so onboarding_report clamps a today window
// up to its shortest, a week, and the note says so.
// It has no end date either: a picked range is read as that many days up to
// now, and the note says so.
function OnboardingSection({
  onboarding,
  isToday,
  picked,
}: {
  onboarding: OnboardingReport;
  isToday: boolean;
  picked: boolean;
}) {
  const arms = [...onboarding.arms].sort(
    (a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) || a.mode.localeCompare(b.mode),
  );
  const arrivals = onboarding.arrivals
    .map(
      (a) =>
        `${fmt(a.arrivals)} on ${MODE_NAMES[a.mode] ?? "untagged"} links ${
          a.link === "twitter" ? "posted to X" : "copied with the Share button and pasted elsewhere"
        }`,
    )
    .join(", ");

  return (
    <Section
      title="Standard vs Freeform: new players by starting mode"
      note={
        onboarding.since
          ? `Players who started ${isToday ? "in the last 7 days" : picked ? "in as many days as the range, up to now" : "in the window"}, recorded from ${onboarding.since}. A friend's link starts them in the link's mode, a share link from before links carried one in Standard (Default), anyone else, unattributed included, at random. Until the split took unattributed arrivals in, they went to Default too. Retention is a live day played after the one they arrived on, in either mode.`
          : "Where new players start, and whether they stay."
      }
    >
      {arms.length === 0 ? (
        <p className="review__status">No starting modes recorded yet.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Players</th>
                <th scope="col">Played</th>
                <th scope="col">Next day</th>
                <th scope="col">Day 7</th>
                <th scope="col">First week</th>
                <th scope="col">Days played</th>
                <th scope="col">Shared</th>
                <th scope="col">Shares per player</th>
                <th scope="col">Switched</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((a) => (
                <tr key={`${a.reason}-${a.mode}`}>
                  <th scope="row">
                    {REASON_NAMES[a.reason]} · {MODE_NAMES[a.mode] ?? a.mode}
                  </th>
                  <td>{fmt(a.players)}</td>
                  <td>{a.players ? pct(a.played / a.players) : "—"}</td>
                  <td>
                    <RateCell rate={a.d1} />
                  </td>
                  <td>
                    <RateCell rate={a.d7} />
                  </td>
                  <td>
                    <RateCell rate={a.week1} />
                  </td>
                  <td>{a.avgDaysPlayed === null ? "—" : dec(a.avgDaysPlayed, 1)}</td>
                  <td>{a.players ? pct(a.sharers / a.players) : "—"}</td>
                  <td>{a.players ? dec(a.shares / a.players, 2) : "—"}</td>
                  <td>{a.players ? pct(a.switched / a.players) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {arrivals && <p className="review__meta">Share-link taps in the window: {arrivals}.</p>}
    </Section>
  );
}

/**
 * Words copied into the other mode from the guess log (see game/crossMode.ts):
 * how often, by whom, which way, and whether the players who do it come back.
 * Two retention comparisons, because each answers a different worry -- the
 * player-day one holds the players roughly fixed, the player one asks about
 * people -- and copiers are self-selected in both, which the note says.
 */
const COPY_MEANING =
  "A copy is a tap on a word in the guess log that banks the same word in the other mode’s game for the same puzzle, so a word found in Standard counts in Freeform too without retyping it. It spends one of that mode’s guesses and is judged by that mode’s rules.";

function CopySection({ copies, windowName }: { copies: CopyReport; windowName: string }) {
  const { totals, retention } = copies;
  if (!totals.since) {
    return (
      <Section title="Standard vs Freeform: words copied across" note={COPY_MEANING}>
        <p className="review__status">No copies recorded yet.</p>
      </Section>
    );
  }
  const unlanded = totals.refused + totals.full + totals.lookupFailed;
  return (
    <Section
      title="Standard vs Freeform: words copied across"
      note={`${windowName}, recorded from ${totals.since}. ${COPY_MEANING} Retention is a live day played afterwards, in either mode. Copiers chose to copy, so a gap here is a correlation, not the feature's effect.`}
    >
      <div className="analytics__tiles">
        <Tile
          label="Words copied"
          value={fmt(totals.copies)}
          sub={`${fmt(totals.toFreeform)} to Freeform, ${fmt(totals.toStandard)} to Standard`}
        />
        <Tile
          label="Players who copied"
          value={fmt(totals.copiers)}
          sub={totals.players ? `${pct(totals.copiers / totals.players)} of ${fmt(totals.players)} players` : undefined}
        />
        <Tile
          label="Copies per copier"
          value={totals.avgCopiesPerCopier === null ? "—" : dec(totals.avgCopiesPerCopier, 1)}
        />
        <Tile
          label="Score change on copy"
          value={totals.avgScoreGain === null ? "—" : `${totals.avgScoreGain > 0 ? "+" : ""}${dec(totals.avgScoreGain, 2)}`}
          sub={totals.copies ? `${pct(totals.higherThere / totals.copies)} scored higher over there` : undefined}
        />
        <Tile
          label="Taps that didn't land"
          value={fmt(unlanded)}
          sub={`${fmt(totals.refused)} refused, ${fmt(totals.full)} game finished, ${fmt(totals.lookupFailed)} lookup failed`}
        />
      </div>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Retention</th>
              <th scope="col">Copied</th>
              <th scope="col">Didn't copy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Next day, per player-day</th>
              <td>
                <RateCell rate={retention.nextDay.copied} />
              </td>
              <td>
                <RateCell rate={retention.nextDay.other} />
              </td>
            </tr>
            <tr>
              <th scope="row">Within 7 days, per player</th>
              <td>
                <RateCell rate={retention.week.copied} />
              </td>
              <td>
                <RateCell rate={retention.week.other} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="analytics__legend">
        <li>
          <span className="analytics__swatch analytics__swatch--single" aria-hidden="true" />
          Copied a word
        </li>
        <li>
          <span className="analytics__swatch analytics__swatch--looked" aria-hidden="true" />
          Played, didn't copy
        </li>
      </ul>
      <BarChart
        label="Players who copied, per puzzle"
        bars={copies.daily.map((d) => ({
          key: d.date,
          axis: d.date.slice(5),
          segments: [
            { value: d.copiers, series: "single" },
            { value: Math.max(0, d.players - d.copiers), series: "looked" },
          ],
          tip: `${d.date} (${SHORT_WEEKDAYS[dowOf(d.date)]}): ${d.copiers} of ${d.players} players copied ${d.copies} words`,
        }))}
      />
    </Section>
  );
}

const ESTIMATES_MEANING =
  "Words no frequency corpus measures used to score a flat 10.00 Legend. From the first puzzle below, Claude guesses a frequency for them two days ahead (src/data/estimated-zipf.json) and the guess is scored instead; Standard still folds on top. Each answer is tagged with where its score came from: a measurement, Claude's estimate, or the 10.00 stand-in.";

/** A share as a percentage, or a dash when there is nothing to divide by. */
function shareOf(part: number, whole: number): string {
  return whole ? pct(part / whole) : "—";
}

/**
 * Claude's estimated scores: how many answers they priced, where they landed,
 * and the game either side of the first one.
 */
function EstimatesSection({ estimates, windowName }: { estimates: EstimatesReport; windowName: string }) {
  const { totals, compare, retention } = estimates;
  if (!totals.since) {
    return (
      <Section title="Claude-estimated scores" note={ESTIMATES_MEANING}>
        <p className="review__status">No answer has been scored from an estimate yet.</p>
      </Section>
    );
  }
  const rows: Array<{ label: string; cell: (s: EstimatesSpan) => ReactNode }> = [
    { label: "Puzzles", cell: (s) => `${s.from} to ${s.to}` },
    { label: "Player-days", cell: (s) => fmt(s.playerDays) },
    { label: "Answers per player-day", cell: (s) => (s.playerDays ? dec(s.answers / s.playerDays, 1) : "—") },
    { label: "Answers scored Legend", cell: (s) => shareOf(s.legends, s.answers) },
    { label: "Answers on the 10.00 stand-in", cell: (s) => shareOf(s.unattested, s.answers) },
    { label: "Average answer score", cell: (s) => dec(s.avgScore, 2) },
    { label: "Finished the puzzle", cell: (s) => shareOf(s.completions, s.playerDays) },
    { label: "Played the next puzzle", cell: (s) => <RateCell rate={s.nextDay} /> },
  ];
  return (
    <Section
      title="Claude-estimated scores"
      note={`${windowName}, recorded from ${totals.since}. ${ESTIMATES_MEANING} Before and after compares the same number of puzzles either side of the first estimated one, so anything else that changed in those weeks is in it too.`}
    >
      <div className="analytics__tiles">
        <Tile
          label="Answers scored by estimate"
          value={fmt(totals.estimated)}
          sub={`${shareOf(totals.estimated, totals.answers)} of ${fmt(totals.answers)} answers`}
        />
        <Tile
          label="Still on the 10.00 stand-in"
          value={fmt(totals.unattested)}
          sub={`${shareOf(totals.unattested, totals.answers)} of answers`}
        />
        <Tile
          label="Players who banked one"
          value={fmt(totals.finders)}
          sub={`${shareOf(totals.finders, totals.players)} of ${fmt(totals.players)} players`}
        />
        <Tile
          label="Average estimated score"
          value={dec(totals.avgScoreEstimated, 2)}
          sub={`measured ${dec(totals.avgScoreMeasured, 2)}, stand-in ${dec(totals.avgScoreUnattested, 2)}`}
        />
        <Tile
          label="Estimated Legends"
          value={fmt(totals.estimatedLegends)}
          sub={`${shareOf(totals.estimatedLegends, totals.estimated)} of estimated answers`}
        />
      </div>
      {compare && (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">The game</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.cell(compare.before)}</td>
                  <td>{r.cell(compare.after)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Next puzzle, after banking an estimated word</th>
                <td>—</td>
                <td>
                  <RateCell rate={retention.nextDay.found} />
                  {" vs "}
                  <RateCell rate={retention.nextDay.other} />
                  <span className="analytics__n"> without</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <ul className="analytics__legend">
        <li>
          <span className="analytics__swatch analytics__swatch--single" aria-hidden="true" />
          Scored by Claude's estimate
        </li>
        <li>
          <span className="analytics__swatch analytics__swatch--looked" aria-hidden="true" />
          Scored on the 10.00 stand-in
        </li>
      </ul>
      <BarChart
        label="Unmeasured answers, per puzzle"
        bars={estimates.daily.map((d) => ({
          key: d.date,
          axis: d.date.slice(5),
          segments: [
            { value: d.estimated, series: "single" },
            { value: d.unattested, series: "looked" },
          ],
          tip: `${d.date} (${SHORT_WEEKDAYS[dowOf(d.date)]}): ${d.estimated} estimated and ${d.unattested} stand-in of ${d.answers} answers; ${d.finders} of ${d.players} players banked an estimated word`,
        }))}
      />
    </Section>
  );
}

/**
 * The chat room: who opens it, who talks, and how long they stay. Viewers and
 * senders are distinct players per puzzle, off the bubble's events; the room's
 * all-time line underneath is off the messages table itself, which is the one
 * that knows what was actually posted and taken down.
 */
function ChatSection({ chat, windowName }: { chat: ChatReport; windowName: string }) {
  const { totals, time, room } = chat;
  // The viewer's calendar date, as the play half's "today" is (see Report).
  const todayRow = chat.daily.find((d) => d.date === todayDateString());
  const roomLine = `${fmt(room.messages)} messages in the room all time, from ${fmt(room.senders)} players, ${fmt(
    room.last24h,
  )} in the last 24 hours${room.hidden ? `, ${fmt(room.hidden)} hidden` : ""}.`;

  if (!totals.since) {
    return (
      <Section title="Chat" note="Opens, messages and time in the chat room.">
        <p className="review__status">No chat opens recorded yet.</p>
        <p className="review__meta">{roomLine}</p>
      </Section>
    );
  }

  return (
    <Section
      title="Chat"
      note={`${windowName}, recorded from ${totals.since}. Viewers opened the chat; senders posted in it. Time is visible time with the panel open.`}
    >
      <div className="analytics__tiles">
        <Tile
          label="Chat viewers today"
          value={fmt(todayRow?.viewers ?? 0)}
          sub={`${fmt(todayRow?.senders ?? 0)} sent, ${fmt(todayRow?.messages ?? 0)} messages`}
        />
        <Tile
          label="Viewers"
          value={fmt(totals.viewers)}
          sub={`${fmt(totals.viewersLast7)} over 7 puzzles, ${fmt(totals.opens)} opens`}
        />
        <Tile
          label="Senders"
          value={fmt(totals.senders)}
          sub={totals.senderShare === null ? undefined : `${pct(totals.senderShare)} of viewers`}
        />
        <Tile
          label="Messages"
          value={fmt(totals.messages)}
          sub={
            totals.senders
              ? `${dec(totals.messages / totals.senders, 1)} per sender${
                  totals.avgMessageLength === null ? "" : `, ${dec(totals.avgMessageLength, 0)} chars`
                }`
              : undefined
          }
        />
        <Tile label="Median time open" value={duration(time.medianViewMs)} sub={`${duration(time.avgViewMs)} average`} />
        <Tile
          label="Time open, when they sent"
          value={duration(time.medianSendingViewMs)}
          sub={time.sendingViewShare === null ? "median" : `median, ${pct(time.sendingViewShare)} of views`}
        />
        <Tile label="Total time in chat" value={duration(time.totalMs)} sub={`over ${fmt(time.views)} views`} />
        <Tile
          label="Came back to it"
          value={fmt(totals.returningViewers)}
          sub={totals.avgOpensPerViewer === null ? "viewers on 2+ puzzles" : `viewers on 2+ puzzles, ${dec(totals.avgOpensPerViewer, 1)} opens each`}
        />
        <Tile
          label="Blocked sends"
          value={fmt(totals.blocked)}
          sub={`${fmt(totals.blockedProfane)} profanity, ${fmt(totals.blockedRateLimited)} too fast`}
        />
      </div>

      <ul className="analytics__legend">
        <li>
          <span className="analytics__swatch analytics__swatch--single" aria-hidden="true" />
          Sent a message
        </li>
        <li>
          <span className="analytics__swatch analytics__swatch--looked" aria-hidden="true" />
          Only read
        </li>
      </ul>
      <BarChart
        label="Chat viewers per puzzle"
        bars={chat.daily.map((d) => ({
          key: d.date,
          axis: d.date.slice(5),
          segments: [
            { value: d.senders, series: "single" },
            { value: Math.max(0, d.viewers - d.senders), series: "looked" },
          ],
          tip: `${d.date} (${SHORT_WEEKDAYS[dowOf(d.date)]}): ${d.viewers} viewers, ${d.senders} sent ${d.messages} messages, ${duration(
            d.totalMs,
          )} in chat`,
        }))}
      />
      <p className="review__meta">{roomLine}</p>
    </Section>
  );
}

/**
 * What the page cannot answer yet about which mode to start new players in,
 * and what would answer it. Fixed copy, not numbers: a to-do list for the
 * report, kept on the page so it is read beside the gaps it describes.
 */
const MISSING: Array<{ title: string; detail: string }> = [
  {
    title: "Is the split’s gap real?",
    detail:
      "The Random split rows are the only fair Standard-vs-Freeform comparison, but they print bare rates. A confidence interval or a minimum-sample flag on Next day, Day 7 and Days played would say when one arm has actually won.",
  },
  {
    title: "Funnel by mode",
    detail:
      "Finished, won and shared are counted across both modes. The share events already carry the mode, so splitting the funnel is a report-query change.",
  },
  {
    title: "Time spent by mode",
    detail: "Session length and time to first guess, split by the mode played, to see which one holds attention.",
  },
  {
    title: "Where split players settle",
    detail:
      "The mode each split player is on after 7 days, and whether they switched on their first day or later. A mode people leave on day one is a poor default.",
  },
  {
    title: "Players who play both",
    detail: "Retention and days played for players who bank words in both modes on one puzzle, against single-mode players.",
  },
  {
    title: "Abandoned puzzles",
    detail: "Puzzles started but left before the guesses ran out, per mode: which rules people give up on.",
  },
  {
    title: "Trial week vs choice era",
    detail: "The by-mode table mixes Sep 14–26 (one mode for everybody) with Sep 27 on (each player’s choice). Split at Sep 27.",
  },
  {
    title: "New players per share, by mode",
    detail:
      "Shares and share-link arrivals are both recorded with a mode; joining them gives the new players each mode’s shares bring in.",
  },
];

function MissingSection() {
  return (
    <Section
      title="Not measured yet: picking a default mode"
      note="Gaps that keep this page from saying which mode to start players in, or which one drives the most play."
    >
      <ul className="analytics__missing">
        {MISSING.map((m) => (
          <li key={m.title}>
            <strong>{m.title}.</strong> {m.detail}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Who comes back, split by what happened to them, from `retention_report` (the
 * 20261005000000 migration). The sections above split retention by the calendar
 * and by mode; these split it by the player's own puzzle -- the first one, every
 * one, and the last one before they stopped -- and by the build they ran.
 *
 * Every event split is web-only, because the iOS app and the Reddit post report
 * nothing, and the notes say so beside the numbers rather than once at the top.
 */
const SPLITS: Array<{ key: string; title: string }> = [
  { key: "outcome", title: "How the first puzzle ended" },
  { key: "score", title: "Best word's score" },
  { key: "words", title: "Words banked" },
  { key: "refusals", title: "Guesses refused" },
  { key: "reason", title: "Refused for (a player can be in more than one row)" },
  { key: "fold", title: "Standard's common-form scoring (Standard-only first days)" },
  { key: "retry", title: "The retry" },
  { key: "looked", title: "Leaderboard and found words" },
  { key: "shared", title: "Sharing" },
  { key: "chat", title: "Chat" },
  { key: "source", title: "Arrived from" },
  { key: "mode", title: "Mode" },
  { key: "firstGuess", title: "Time to first guess" },
  { key: "time", title: "Time on the page that day" },
];

const CAVEAT =
  "Groups of fewer than five players are left out. These are correlations: players who were going to stay anyway also win more and look around more, so treat a gap as something to test, not a cause.";

function ReturnersSections({
  returners,
  isToday,
  windowName,
}: {
  returners: ReturnersReport;
  isToday: boolean;
  windowName: string;
}) {
  if (isToday) {
    return (
      <Section title="Who comes back">
        <p className="review__status">Needs more than one puzzle: pick a longer window to see who came back.</p>
      </Section>
    );
  }
  return (
    <>
      <FirstPuzzleSection returners={returners} windowName={windowName} />
      <PuzzleReturnSection returners={returners} windowName={windowName} />
      <LastDaySection returners={returners} windowName={windowName} />
      <VersionSection returners={returners} windowName={windowName} />
    </>
  );
}

/** A rate as a share, or null when nobody was eligible. */
function share(rate: Rate): number | null {
  return rate.cohort ? rate.returned / rate.cohort : null;
}

/** A group's rate against everybody's, in percentage points. */
function Delta({ rate, base }: { rate: Rate; base: Rate }) {
  const a = share(rate);
  const b = share(base);
  if (a === null || b === null) return <>—</>;
  const points = Math.round((a - b) * 100);
  // Under five points either way is noise at these sizes, so it is left uncoloured.
  const tone = points >= 5 ? " analytics__delta--up" : points <= -5 ? " analytics__delta--down" : "";
  return <span className={`analytics__delta${tone}`}>{`${points > 0 ? "+" : points < 0 ? "−" : "±"}${Math.abs(points)} pts`}</span>;
}

function FirstPuzzleSection({ returners, windowName }: { returners: ReturnersReport; windowName: string }) {
  const { totals, groups } = returners.firstPuzzle;
  const untracked = totals.players - totals.tracked;
  return (
    <Section
      title="Who comes back: their first puzzle"
      note={`New players whose first puzzle is in the window (${windowName.toLowerCase()}), split by what happened on it, against whether they played the next puzzle and any puzzle in the week after. Next day vs all is the group's next-day rate minus everybody's. Mode, score and words cover every player; the rest come from events, which the iOS app and the Reddit post do not send${returners.trackedSince ? ` and which name a player from ${returners.trackedSince}` : ""}. ${CAVEAT}`}
    >
      <div className="analytics__tiles">
        <Tile label="New players" value={fmt(totals.players)} sub={windowName} />
        <Tile
          label="With events"
          value={fmt(totals.tracked)}
          sub={untracked ? `${fmt(untracked)} untracked (iOS app, Reddit, or older)` : "every one of them"}
        />
        <RateTile label="Next day, all" rate={totals.nextDay} />
        <RateTile label="Within a week, all" rate={totals.week} />
      </div>
      {groups.length === 0 ? (
        <p className="review__status">No group has five players yet.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">First puzzle</th>
                <th scope="col">Players</th>
                <th scope="col">Next day</th>
                <th scope="col">Next day vs all</th>
                <th scope="col">Within a week</th>
              </tr>
            </thead>
            {SPLITS.map(({ key, title }) => {
              const rows = groups.filter((g) => g.split === key);
              if (rows.length === 0) return null;
              return (
                <tbody key={key}>
                  <tr className="analytics__table-group">
                    <th scope="colgroup" colSpan={5}>
                      {title}
                    </th>
                  </tr>
                  {rows.map((g) => (
                    <tr key={g.group}>
                      <th scope="row">{key === "source" ? sourceName(g.group) : g.group}</th>
                      <td>{fmt(g.players)}</td>
                      <td>
                        <RateCell rate={g.nextDay} />
                      </td>
                      <td>
                        <Delta rate={g.nextDay} base={totals.nextDay} />
                      </td>
                      <td>
                        <RateCell rate={g.week} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </Section>
  );
}

function PuzzleReturnSection({ returners, windowName }: { returners: ReturnersReport; windowName: string }) {
  const puzzles = returners.puzzles;
  // The window's own next-day rate, for the colour on each puzzle's.
  const base = puzzles.reduce(
    (sum, p) => ({ cohort: sum.cohort + p.nextDay.cohort, returned: sum.returned + p.nextDay.returned }),
    { cohort: 0, returned: 0 },
  );
  return (
    <Section
      title="Who comes back: puzzle by puzzle"
      note={`${windowName}, newest first: how many of each puzzle's players played the next one, beside how the puzzle played. A puzzle followed by a low return may be the puzzle's doing. Won is of the players who finished it; refused and scored down are per player with events, scored down on Standard only. New players' next day is left out under five.`}
    >
      {puzzles.length === 0 ? (
        <p className="review__status">No puzzle in the window had five players.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Puzzle</th>
                <th scope="col">Players</th>
                <th scope="col">Next day</th>
                <th scope="col">vs window</th>
                <th scope="col">New</th>
                <th scope="col">New, next day</th>
                <th scope="col">Words</th>
                <th scope="col">Best word</th>
                <th scope="col">Won</th>
                <th scope="col">Refused</th>
                <th scope="col">Scored down</th>
              </tr>
            </thead>
            <tbody>
              {puzzles.map((p) => (
                <tr key={p.date}>
                  <th scope="row">
                    {p.date.slice(5)} {SHORT_WEEKDAYS[dowOf(p.date)]}
                  </th>
                  <td>{fmt(p.players)}</td>
                  <td>{p.nextDay.cohort ? <RateCell rate={p.nextDay} /> : "still live"}</td>
                  <td>
                    <Delta rate={p.nextDay} base={base} />
                  </td>
                  <td>{fmt(p.newPlayers)}</td>
                  <td>{p.newNextDay ? <RateCell rate={p.newNextDay} /> : "—"}</td>
                  <td>{dec(p.avgWords, 1)}</td>
                  <td>{dec(p.avgTop, 2)}</td>
                  <td>{p.completed ? pct(p.won / p.completed) : "—"}</td>
                  <td>{dec(p.refusalsPerPlayer, 2)}</td>
                  <td>{dec(p.foldsPerPlayer, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** One measure of a day, for the stopped players' table. */
const STOP_ROWS: Array<{ label: string; show: (s: StopStats) => string }> = [
  { label: "Days counted", show: (s) => fmt(s.days) },
  { label: "Words banked", show: (s) => dec(s.avgWords, 2) },
  { label: "Best word's score", show: (s) => dec(s.avgTop, 2) },
  { label: "Finished the puzzle", show: (s) => maybePct(s.finishShare) },
  { label: "Won, of finished", show: (s) => maybePct(s.winShare) },
  { label: "Guesses refused", show: (s) => dec(s.refusalsPerDay, 2) },
  { label: "Words scored down (Standard)", show: (s) => dec(s.foldsPerDay, 2) },
  { label: "Revealed the word", show: (s) => maybePct(s.revealedShare) },
  { label: "Opened the leaderboard or found words", show: (s) => maybePct(s.lookedShare) },
  { label: "Shared their result", show: (s) => maybePct(s.sharedShare) },
  { label: "Came back after missing a puzzle", show: (s) => maybePct(s.afterGapShare) },
  { label: "Played Freeform only", show: (s) => maybePct(s.freeformShare) },
];

function maybePct(share: number | null): string {
  return share === null ? "—" : pct(share);
}

function LastDaySection({ returners, windowName }: { returners: ReturnersReport; windowName: string }) {
  const { players, last, usual } = returners.lastDay;
  return (
    <Section
      title="Who stops: their last day"
      note={`Players who played three or more puzzles, the last of them in the window (${windowName.toLowerCase()}), and have missed at least the two after it. Their last day against their own earlier days, so the same players are on both sides. "Came back after missing a puzzle" means any streak had already broken. Per-day measures past the score come from events, so they leave out the iOS app and the Reddit post. ${CAVEAT}`}
    >
      {!last || !usual ? (
        <p className="review__status">
          {players === 0 ? "Nobody has stopped in this window yet." : `${fmt(players)} stopped, fewer than five: not shown.`}
        </p>
      ) : (
        <>
          <div className="analytics__tiles">
            <Tile label="Players who stopped" value={fmt(players)} sub="after 3+ puzzles" />
          </div>
          <div className="analytics__table-wrap">
            <table className="analytics__table">
              <thead>
                <tr>
                  <th scope="col">Per day</th>
                  <th scope="col">Last day</th>
                  <th scope="col">Their earlier days</th>
                </tr>
              </thead>
              <tbody>
                {STOP_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.show(last)}</td>
                    <td>{row.show(usual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function VersionSection({ returners, windowName }: { returners: ReturnersReport; windowName: string }) {
  return (
    <Section
      title="Who comes back: by app version"
      note={`${windowName}: the share of each build's player-days followed by a play the next puzzle. Web only, by the build the tab ran when it opened. A drop after a release is worth a look; a build that ran over different weekdays or a launch spike is not a fair comparison on its own.`}
    >
      {returners.versions.length === 0 ? (
        <p className="review__status">No build in the window had five players with events.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Players</th>
                <th scope="col">Puzzles</th>
                <th scope="col">Next day</th>
              </tr>
            </thead>
            <tbody>
              {returners.versions.map((v) => (
                <tr key={v.version}>
                  <th scope="row">{v.version}</th>
                  <td>{fmt(v.players)}</td>
                  <td>
                    {v.firstDay} to {v.lastDay}
                  </td>
                  <td>
                    <RateCell rate={v.nextDay} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** The two return measures every 10.00 table shows. */
interface Returns {
  nextDay: Rate;
  week: Rate;
}

/**
 * A row's next-day and within-a-week returns, each with its gap against `base`
 * (none for the row that is the base). Four cells.
 */
function Rates({ row, base }: { row: Returns; base?: Returns }) {
  return (
    <>
      <td>
        <RateCell rate={row.nextDay} />
      </td>
      <td>{base ? <Delta rate={row.nextDay} base={base.nextDay} /> : "—"}</td>
      <td>{row.week.cohort ? <RateCell rate={row.week} /> : "too recent"}</td>
      <td>{base ? <Delta rate={row.week} base={base.week} /> : "—"}</td>
    </>
  );
}

/** Two gaps in one tile, next day then within a week, each [rate, base]. */
function GapTile({
  label,
  next,
  week,
  sub,
}: {
  label: string;
  next: [Rate, Rate];
  week?: [Rate, Rate];
  sub: string;
}) {
  return (
    <div className="analytics__tile">
      <span className="analytics__tile-label">{label}</span>
      <span className="analytics__tile-value">
        <Delta rate={next[0]} base={next[1]} /> <span className="analytics__n">next day</span>
        {week && (
          <>
            {" · "}
            <Delta rate={week[0]} base={week[1]} /> <span className="analytics__n">week</span>
          </>
        )}
      </span>
      <span className="analytics__tile-sub">{sub}</span>
    </div>
  );
}

function CorrelationTile({ label, population, sub }: { label: string; population: PerfectPopulation; sub: string }) {
  const show = (r: number | null) => (r === null ? "—" : r.toFixed(2));
  return (
    <div className="analytics__tile">
      <span className="analytics__tile-label">{label}</span>
      <span className="analytics__tile-value">
        {show(population.correlation)} <span className="analytics__n">next day</span> ·{" "}
        {show(population.weekCorrelation)} <span className="analytics__n">week</span>
      </span>
      <span className="analytics__tile-sub">{`${sub}, over ${fmt(population.puzzles)} puzzles`}</span>
    </div>
  );
}

/** A difference already in points, signed as Delta signs one. */
function points(p: number | null): string {
  return p === null ? "—" : `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)} pts`;
}

const PERFECT_MODES: Array<{ key: string; title: string }> = [
  { key: "all", title: "Every puzzle played, both modes" },
  { key: "standard", title: "Standard only (common-form scoring makes 10.00 rarer)" },
  { key: "freeform", title: "Freeform only" },
];

/**
 * Whether the players who hit a 10.00 come back more, from `perfect_report` (the
 * 20261006000000 migration). Each table controls for a little more than the
 * last: any day, then the same players' own days, then players by how often.
 * Plays are the leaderboard's, so every device is in it.
 */
function PerfectSection({ perfects, windowName }: { perfects: PerfectsReport; windowName: string }) {
  const { firstPuzzle, days, samePlayers, players, missed } = perfects;
  const label = (perfect: boolean) => (perfect ? "Best word 10.00" : "Best word under 10");
  // Each 10.00 row is measured against the other row of its own group.
  const against = <T extends { perfect: boolean }>(rows: T[], row: T) =>
    row.perfect ? rows.find((r) => !r.perfect) : undefined;
  const regularsBase = players.find((p) => p.group === "Never");
  // Missing on a 10.00-heavy puzzle, measured against missing on a quiet one.
  const missedBase = missed?.groups.find((g) => g.group.endsWith("were rare"));
  return (
    <Section
      title="Perfect scores and who comes back"
      note={`${windowName}: whether a puzzle whose best word scored a perfect 10.00 (either mode) is followed by a play the next puzzle more often than one that was not. Every device counts. "Same players" keeps only the players who have had both kinds of day, so who they are cancels out; the gap is in percentage points. ${CAVEAT}`}
    >
      <div className="analytics__tiles">
        <Tile label="Same players" value={fmt(samePlayers.players)} sub="with both kinds of day" />
        {samePlayers.perfect && samePlayers.other ? (
          <>
            <RateTile label="Next day after a 10.00" rate={samePlayers.perfect} />
            <RateTile label="Next day after any other" rate={samePlayers.other} />
            <GapTile
              label="Gap"
              next={[samePlayers.perfect, samePlayers.other]}
              week={samePlayers.week ? [samePlayers.week.perfect, samePlayers.week.other] : undefined}
              sub="after a 10.00, against after any other"
            />
          </>
        ) : (
          <Tile label="Next day after a 10.00" value="—" sub="fewer than five such players" />
        )}
      </div>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Players</th>
              <th scope="col">Puzzles</th>
              <th scope="col">Next day</th>
              <th scope="col">Gap</th>
              <th scope="col">Within a week</th>
              <th scope="col">Gap</th>
            </tr>
          </thead>
          {PERFECT_MODES.map(({ key, title }) => {
            const rows = days.filter((d) => d.mode === key);
            if (rows.length === 0) return null;
            return (
              <tbody key={key}>
                <tr className="analytics__table-group">
                  <th scope="colgroup" colSpan={7}>
                    {title}
                  </th>
                </tr>
                {rows.map((d) => {
                  const base = against(rows, d);
                  return (
                    <tr key={String(d.perfect)}>
                      <th scope="row">{label(d.perfect)}</th>
                      <td>{fmt(d.players)}</td>
                      <td>{fmt(d.days)}</td>
                      <Rates row={d} base={base} />
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
          {firstPuzzle.length > 0 && (
            <tbody>
              <tr className="analytics__table-group">
                <th scope="colgroup" colSpan={7}>
                  New players' first puzzle
                </th>
              </tr>
              {firstPuzzle.map((f) => {
                const base = against(firstPuzzle, f);
                return (
                  <tr key={String(f.perfect)}>
                    <th scope="row">{label(f.perfect)}</th>
                    <td>{fmt(f.players)}</td>
                    <td>{fmt(f.players)}</td>
                    <Rates row={f} base={base} />
                  </tr>
                );
              })}
            </tbody>
          )}
          {players.length > 0 && (
            <tbody>
              <tr className="analytics__table-group">
                <th scope="colgroup" colSpan={7}>
                  Players with 3+ puzzles in the window, by how often their best word was 10.00 (puzzles is the
                  average each played)
                </th>
              </tr>
              {players.map((p) => (
                <tr key={p.group}>
                  <th scope="row">{p.group}</th>
                  <td>{fmt(p.players)}</td>
                  <td>{dec(p.avgPuzzles, 1)}</td>
                  <Rates row={p} base={p.group !== "Never" ? regularsBase : undefined} />
                </tr>
              ))}
            </tbody>
          )}
          {missed && missed.groups.length > 0 && (
            <tbody>
              <tr className="analytics__table-group">
                <th scope="colgroup" colSpan={7}>
                  {`Puzzles where 10.00s were common (more than ${
                    missed.medianShare === null ? "the median" : pct(missed.medianShare)
                  } of players hit one, the window's median puzzle) or rare, for the players who missed; gap is against missing on a rare one`}
                </th>
              </tr>
              {missed.groups.map((g) => (
                <tr key={g.group}>
                  <th scope="row">{g.group}</th>
                  <td>{fmt(g.players)}</td>
                  <td title={`${fmt(g.puzzles)} different puzzles`}>{fmt(g.days)}</td>
                  <Rates row={g} base={!g.group.endsWith("were rare") ? missedBase : undefined} />
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </Section>
  );
}

const QUARTILE_NAMES = ["Fewest 10.00s", "Second", "Third", "Most 10.00s"];

/**
 * The puzzle comparisons start at the first puzzle anybody hit a 10.00 on:
 * before it a puzzle had none because it was older, not because it played
 * differently. Tied puzzles share a quartile, so there can be fewer than four.
 */
function sinceNote(since: string | null): string {
  return since
    ? `, comparing puzzles from ${since}, the first anybody hit a 10.00 on (tied puzzles share a quartile)`
    : "";
}

/**
 * Whether other players' 10.00s cheapen the score: from the same `perfect_report`.
 * It leads with everybody, by how often anybody hit a 10.00 on the puzzle --
 * friends share their results, so that is the exposure every player has, on
 * any device. The look split is a narrower check under it: web only, and only
 * the players who opened the boards.
 */
function SeenPerfectsSection({ perfects, windowName }: { perfects: PerfectsReport; windowName: string }) {
  const { seen, population, missed } = perfects;
  if (!seen && !population) return null;
  const find = (looked: boolean, common: boolean) => seen?.find((g) => g.looked === looked && g.common === common);
  // How much worse a common day is for those who looked than for those who
  // did not: the part of the gap that looking explains, in points.
  const lookingEffect = (key: "nextDay" | "week") => {
    const gap = (looked: boolean) => {
      const a = find(looked, true)?.[key];
      const b = find(looked, false)?.[key];
      const sa = a && share(a);
      const sb = b && share(b);
      return sa != null && sb != null ? sa - sb : null;
    };
    const looked = gap(true);
    const control = gap(false);
    return looked !== null && control !== null ? Math.round((looked - control) * 100) : null;
  };
  const lowest = population?.quartiles[0];
  const highest = population && population.quartiles.length > 1 ? population.quartiles[population.quartiles.length - 1] : undefined;
  return (
    <Section
      title="Do other players' 10.00s drive players off?"
      note={`${windowName}${sinceNote(perfects.perfectSince)}. The first table is everybody, on every device: puzzles in quartiles by how often anybody hit a 10.00 on them, against whether all of that puzzle's players came back the next day. Friends share their results, so a puzzle full of 10.00s is one every player is likely to have seen some of; if that cheapens the score, the puzzles with the most come back worst and the correlation is negative. The weekday, the drop and the mode mix move a puzzle's return too. The second table is a narrower check: only days the player did not hit one themselves, split by whether they opened the leaderboard or found words and whether 10.00s were "common" (more of the puzzle's players hit one than on the median puzzle${
        missed?.medianShare != null ? `, ${pct(missed.medianShare)}` : ""
      }). Looks come from events, so it is web only. ${CAVEAT}`}
    >
      <div className="analytics__tiles">
        {population && (
          <CorrelationTile
            label="Correlation, all players"
            population={population}
            sub="how often anybody hit 10.00 vs return"
          />
        )}
        {population && lowest && highest && (
          <GapTile
            label="Most 10.00s against fewest"
            next={[highest.nextDay, lowest.nextDay]}
            week={[highest.week, lowest.week]}
            sub="every player"
          />
        )}
        <div className="analytics__tile">
          <span className="analytics__tile-label">Looked, on a common day (web)</span>
          <span className="analytics__tile-value">
            {points(lookingEffect("nextDay"))} <span className="analytics__n">next day</span> ·{" "}
            {points(lookingEffect("week"))} <span className="analytics__n">week</span>
          </span>
          <span className="analytics__tile-sub">common-vs-rare gap for lookers, minus the same gap for non-lookers</span>
        </div>
      </div>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Players</th>
              <th scope="col">Puzzles</th>
              <th scope="col">Next day</th>
              <th scope="col">Gap</th>
              <th scope="col">Within a week</th>
              <th scope="col">Gap</th>
            </tr>
          </thead>
          {population && population.quartiles.length > 0 && (
            <tbody>
              <tr className="analytics__table-group">
                <th scope="colgroup" colSpan={7}>
                  Every player, by how often anybody hit a 10.00 on the puzzle; gap is against the fewest
                </th>
              </tr>
              <QuartileRows population={population} />
            </tbody>
          )}
          {seen && seen.length > 0 && (
            <tbody>
              <tr className="analytics__table-group">
                <th scope="colgroup" colSpan={7}>
                  Web only: missed a 10.00 themselves; gap is common against rare, for the same look
                </th>
              </tr>
              {seen.map((g) => {
                const base = g.common ? find(g.looked, false) : undefined;
                return (
                  <tr key={`${g.looked}-${g.common}`}>
                    <th scope="row">
                      {`${g.looked ? "Looked at the boards" : "Did not look"}, 10.00s ${g.common ? "common" : "rare"}`}
                    </th>
                    <td>{fmt(g.players)}</td>
                    <td>{fmt(g.days)}</td>
                    <Rates row={g} base={base} />
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>
    </Section>
  );
}

/** Puzzles in quartiles by how often anybody hit a 10.00, gap against the fewest. */
function QuartileRows({ population }: { population: PerfectPopulation }) {
  const lowest = population.quartiles[0];
  return (
    <>
      {population.quartiles.map((q) => (
        <tr key={q.quartile}>
          <th scope="row">
            {`${QUARTILE_NAMES[q.quartile - 1] ?? q.quartile}${
              q.minShare === null || q.maxShare === null ? "" : ` (${pct(q.minShare)} to ${pct(q.maxShare)} hit one)`
            }`}
          </th>
          <td>{fmt(q.players)}</td>
          <td>{fmt(q.puzzles)}</td>
          <Rates row={q} base={lowest && q !== lowest ? lowest : undefined} />
        </tr>
      ))}
    </>
  );
}

/**
 * The 10.00 questions without the power users, from `perfect_report`'s
 * `casual` (the 20261006020000 migration): only days that were a player's
 * first six puzzles, so the regulars who come back whatever happens do not
 * carry the rates.
 */
function CasualPerfectsSection({
  casual,
  windowName,
}: {
  casual: NonNullable<PerfectsReport["casual"]>;
  windowName: string;
}) {
  const lowest = casual.quartiles[0];
  const highest = casual.quartiles.length > 1 ? casual.quartiles[casual.quartiles.length - 1] : undefined;
  const hit = casual.days.find((d) => d.perfect);
  const missed = casual.days.find((d) => !d.perfect);
  return (
    <Section
      title="10.00s without the power users"
      note={`${windowName}, counting only the days that were one of a player's first six puzzles, so nobody's 7th puzzle or later is in it. That is cut by where the player was that day, not by how many they went on to play: reaching seven is itself coming back, and cutting on it would take the returns out with it. Puzzles stay in the quartiles of the section above, by how often anybody (power users too) hit a 10.00, since that is what these players saw. Every device counts. ${CAVEAT}`}
    >
      <div className="analytics__tiles">
        <CorrelationTile
          label="Correlation, casual players"
          population={casual}
          sub="how often anybody hit 10.00 vs their return"
        />
        {lowest && highest && (
          <GapTile
            label="Most 10.00s against fewest"
            next={[highest.nextDay, lowest.nextDay]}
            week={[highest.week, lowest.week]}
            sub="casual players"
          />
        )}
        {hit && missed && (
          <GapTile
            label="Their own 10.00"
            next={[hit.nextDay, missed.nextDay]}
            week={[hit.week, missed.week]}
            sub="after hitting one, against not"
          />
        )}
      </div>
      {casual.quartiles.length === 0 && casual.days.length === 0 ? (
        <p className="review__status">Not enough casual players in this window yet.</p>
      ) : (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Players</th>
                <th scope="col">Puzzles</th>
                <th scope="col">Next day</th>
                <th scope="col">Gap</th>
                <th scope="col">Within a week</th>
                <th scope="col">Gap</th>
              </tr>
            </thead>
            {casual.quartiles.length > 0 && (
              <tbody>
                <tr className="analytics__table-group">
                  <th scope="colgroup" colSpan={7}>
                    By how often anybody hit a 10.00 on the puzzle; gap is against the fewest
                  </th>
                </tr>
                <QuartileRows population={casual} />
              </tbody>
            )}
            {casual.days.length > 0 && (
              <tbody>
                <tr className="analytics__table-group">
                  <th scope="colgroup" colSpan={7}>
                    By their own best word; gap is against under 10
                  </th>
                </tr>
                {casual.days.map((d) => (
                  <tr key={String(d.perfect)}>
                    <th scope="row">{d.perfect ? "Best word 10.00" : "Best word under 10"}</th>
                    <td>{fmt(d.players)}</td>
                    <td>{fmt(d.days)}</td>
                    <Rates row={d} base={d.perfect ? missed : undefined} />
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </Section>
  );
}

/**
 * How a day's players split between the modes, for its tooltip. A player can
 * bank words in both on one day, so the two can sum to more than the players.
 */
function modeSplit(d: AnalyticsReport["daily"][number]): string {
  if (d.players === 0) return "";
  if (d.freeform === 0) return ", all Standard";
  if (d.standard === 0) return ", all Freeform";
  return ` (${d.standard} Standard, ${d.freeform} Freeform)`;
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
      <li>
        <span className="analytics__swatch analytics__swatch--looked" aria-hidden="true" />
        Only looked
      </li>
    </ul>
  );
}

interface Bar {
  key: string;
  /** The axis label under the bar; empty to leave a gap in a dense axis. */
  axis: string;
  segments: Array<{ value: number; series: "standard" | "freeform" | "looked" | "single" }>;
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
 * The people behind the visits: distinct browsers that opened the game, and how
 * many times the average one did. Visits from before events carried a player id
 * cannot be tied to anybody, so the average is over the visits that can be.
 */
function Visitors({ report }: { report: AnalyticsReport }) {
  const f = report.funnel;
  if (!report.visitorsSince) {
    return (
      <div className="analytics__tiles">
        <Tile label="Visitors" value="—" sub="not recorded yet" />
      </div>
    );
  }
  return (
    <div className="analytics__tiles">
      <Tile label="Visitors" value={fmt(f.visitors)} sub={`distinct, recorded from ${report.visitorsSince}`} />
      <Tile
        label="Visits per visitor"
        value={f.visitors ? dec(f.visitsWithId / f.visitors, 1) : "—"}
        sub={`average, over ${fmt(f.visitsWithId)} opens`}
      />
      <Tile
        label="Engaged visitors"
        value={fmt(f.engagedFunnelVisitors)}
        sub={`guessed or looked, over ${fmt(f.engaged)} engaged visits`}
      />
    </div>
  );
}

/**
 * The web half of the headline: the distinct browsers that opened the game, and
 * how many of them did anything once there -- pressed any button, link or key --
 * against how many opened it and left. Read off the event log, so the app and
 * the Reddit post, which send no visits, are not in it; the Players tile is.
 * Before presses were recorded, engaged only knows guesses, looks, mode switches,
 * finishes and shares, so a window that starts earlier says so. Engaged is shown
 * twice, as people and as visits, since one person can engage in many visits.
 */
function VisitorTiles({ report, from, eventSpan }: { report: AnalyticsReport; from: string; eventSpan: string }) {
  const f = report.funnel;
  if (!report.visitorsSince) return null;
  const share = (n: number) => (f.visitors ? `${pct(n / f.visitors)} of them` : "no visitors");
  const partial = !report.interactedSince || report.interactedSince > from;
  return (
    <div className="analytics__tiles">
      <Tile label="Web visitors" value={fmt(f.visitors)} sub={`distinct browsers, ${eventSpan}`} />
      <Tile
        label="Engaged visitors"
        value={fmt(f.engagedVisitors)}
        sub={
          partial
            ? `${share(f.engagedVisitors)}; any press counted ${report.interactedSince ? `from ${report.interactedSince}` : "once it ships"}`
            : `${share(f.engagedVisitors)}, pressed anything`
        }
      />
      <Tile
        label="Engaged visits"
        value={fmt(f.engagedVisits)}
        sub={f.engagedVisitors ? `${dec(f.engagedVisits / f.engagedVisitors, 1)} per engaged visitor` : "none yet"}
      />
      <Tile label="Opened, did nothing" value={fmt(f.idleVisitors)} sub={share(f.idleVisitors)} />
    </div>
  );
}

/** Visits down to shares, each step as a bar and as a share of the one before. */
function Funnel({ report }: { report: AnalyticsReport }) {
  const f = report.funnel;
  const steps = [
    { label: "Visits", value: f.visits },
    { label: "Engaged visits", value: f.engaged },
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
        {fmt(f.firstVisits)} first-ever visits; {fmt(f.engagedByLooking)} engaged visits began on the
        leaderboard or the found words; {f.completed ? pct(f.won / f.completed) : "—"} of finished puzzles
        won; {fmt(f.sharedOnX)} shares went to X.
      </li>
    </ol>
  );
}
