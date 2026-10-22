import { useCallback, useState, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import {
  fetchAnalytics,
  GROUPS,
  IDLE_HINT_VARIANTS,
  type AnalyticsReport,
  type Group,
  type KeyMetrics,
  type MuseReport,
  type WeekActives,
} from "../game/review";
import {
  DAYS_AGO,
  SPANS,
  daysAgoLabel,
  dowOf,
  fmt,
  growth,
  moveRange,
  pct,
  windowDates,
  type AnalyticsWindow,
} from "./analyticsFormat";
import { todayDateString } from "../game/date";
import { DailyChart } from "./DailyChart";
import { IDLE_HINT_DELAY_MS } from "../game/idleHint";
import { handleFor } from "../game/handle";

/**
 * How the game is doing, as a page at /analytics.
 *
 * Seven numbers, and the same seven everywhere: the players who turned up, the
 * ones who did anything, the ones who guessed (banked a word), the ones who
 * finished a puzzle, the ones who shared their result, and the ones who came
 * back the next day and within seven days. They are split by who the players
 * are -- new or returning -- by the puzzle type they played, by whether they
 * opened the chat, by which play screen they were shown, and by the idle hint
 * test's arm. Every number is built in one place, `analytics_overview` (see the
 * 2026-10-18, 2026-10-21 and 2026-10-26 migrations), and this page only draws
 * them. Growth, weekly active players by the same groupings, comes from the
 * same place (the 2026-10-27 migration).
 *
 * Muse AI, an agent the maintainer sends to play (see game/visitor.ts), is
 * left out of all of it and has a section of its own at the end.
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
};

const VARIANT_NAMES = { control: "No hint", treatment: "Hint" } as const;

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
        title="Day by day"
        note="Click or use the arrow keys to pin a day. % is of the day's players."
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
        title="Key numbers"
        note={span}
      >
        <ul className="review__meta analytics__bullets">
          <li><strong>Players</strong>: opened the game</li>
          <li><strong>Did something</strong>: any tap, look or guess</li>
          <li><strong>Guessed</strong>: banked a word</li>
          <li><strong>Completed</strong>: finished a puzzle, using every guess or locking in (the second line is the share of guessers, the only players who can)</li>
          <li><strong>Shared</strong>: copied their result with Share (the second line is the share of guessers, the only players who can)</li>
          <li><strong>Back next day</strong>: played the very next puzzle (the last day still counting up; the second line is the share of guessers)</li>
          <li><strong>Back within 7 days</strong>: played again in the next 7 days (recent days still counting up; the second line is the share of guessers)</li>
          <li><strong>New</strong>: first visit in this window</li>
        </ul>
        <MetricsTable
          rows={GROUPS.map((g) => ({ key: g, label: GROUP_NAMES[g], metrics: report.groups[g] }))}
        />
        <p className="review__meta analytics__note analytics__bots">
          {fmt(report.botsFiltered)} automated {report.botsFiltered === 1 ? "visitor" : "visitors"} left
          out of every number here: arrived within 2 seconds of another new player and never did anything,
          or said they were a bot.
        </p>
      </Section>

      <GrowthSection weekly={report.weekly} />

      <Section
        title="Puzzle type"
        note={`${span}. Who guessed in each mode, and how many came back.`}
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
                    <Count n={report.modes[mode].returned.soFar} of={report.modes[mode].guessed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Play screen test"
        note={`${span}. Play screen v1 (the one before the test) vs v2, new and returning players each split on their own: new 50/50 at first and 30/70 since Oct 19, returning 50/50${
          report.uiSince ? `, since ${shortDate(report.uiSince)}` : ""
        }. New is a first-ever session, counted on that day; returning any later one, counted from the day it was split.`}
      >
        <MetricsTable
          split="Play screen"
          rows={GROUPS.flatMap((g) => [
            { key: `${g}-control`, label: GROUP_NAMES[g], side: "v1", metrics: report.ui[g].control },
            { key: `${g}-v2`, label: GROUP_NAMES[g], side: "v2", metrics: report.ui[g].v2 },
          ])}
        />
      </Section>

      <Section
        title="Chat"
        note={`${span}. Opened chat vs didn't${report.chatSince ? `, since ${shortDate(report.chatSince)}` : ""}.`}
      >
        <MetricsTable
          split="Chat"
          rows={GROUPS.flatMap((g) => [
            { key: `${g}-opened`, label: GROUP_NAMES[g], side: "Opened chat", metrics: report.chat[g].opened },
            { key: `${g}-not`, label: GROUP_NAMES[g], side: "Didn't", metrics: report.chat[g].notOpened },
          ])}
        />
      </Section>

      <Section
        title="Idle hint test"
        note={`${span}. Players who sat idle ${IDLE_HINT_DELAY_MS.new / 1000}s, no hint vs hint, each player assigned 50/50${
          report.idleHintSince ? `, since ${shortDate(report.idleHintSince)}` : ""
        }. New is a first-ever session, returning any later one.`}
      >
        <MetricsTable
          split="Arm"
          rows={GROUPS.flatMap((g) =>
            IDLE_HINT_VARIANTS.map((v) => ({
              key: `${g}-${v}`,
              label: GROUP_NAMES[g],
              side: VARIANT_NAMES[v],
              metrics: report.idleHint[g][v],
            })),
          )}
        />
      </Section>

      <MuseSection muse={report.muse} span={span} />
    </div>
  );
}

/** Weeks the growth table shows; the report carries one more, for the oldest one's growth. */
const GROWTH_WEEKS = 12;

/**
 * Weekly active players and their growth on the week before, by grouping.
 * Weeks run Sunday to Saturday, the latest the one today's puzzle is in, and do not follow the window.
 */
function GrowthSection({ weekly }: { weekly: WeekActives[] }) {
  const [group, setGroup] = useState<Group>("all");
  return (
    <Section
      title="Growth"
      note={`The latest ${GROWTH_WEEKS} weeks, whatever the window: each week runs Sunday to Saturday, so the latest is still counting up.`}
    >
      <ul className="review__meta analytics__bullets">
        <li><strong>Weekly active players</strong>: opened the game on any puzzle that week</li>
        <li><strong>WAU growth</strong>: the change on the week before</li>
        <li><strong>New</strong>: first-ever visit that week; <strong>Returning</strong>: visited before it</li>
      </ul>
      <div className="analytics__groups" role="group" aria-label="Weekly players">
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
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Weekly active players</th>
              <th scope="col">WAU growth</th>
            </tr>
          </thead>
          <tbody>
            {weekly.slice(0, GROWTH_WEEKS).map((w, i) => (
              <tr key={w.end}>
                <th scope="row">
                  {shortDate(w.start)} to {shortDate(w.end)}
                  {i === 0 && <span className="analytics__n"> so far</span>}
                </th>
                <td>{fmt(w.players[group])}</td>
                <td>{growth(w.players[group], weekly[i + 1]?.players[group])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** An average to two places, or a dash when there was nothing to average. */
function avg(n: number | null): string {
  return n === null ? "–" : n.toFixed(2);
}

function chatCell(opened: boolean, messages: number): string {
  if (!opened && messages === 0) return "No";
  return messages > 0 ? `Yes, ${fmt(messages)} sent` : "Opened";
}

/**
 * Muse AI, the agent sent to play the game with `?visitor=mos-muse`: kept out
 * of every number above and shown here on its own, by puzzle.
 */
function MuseSection({ muse, span }: { muse: MuseReport; span: string }) {
  const seen = muse.lastSeen ? `, last seen ${shortDate(muse.lastSeen.slice(0, 10))}` : ", not seen yet";
  return (
    <Section
      title="Muse AI"
      note={`${span}. The agent that plays with ?visitor=mos-muse, left out of every number above${seen}.`}
    >
      <ul className="review__meta analytics__bullets">
        <li><strong>Puzzles</strong>: puzzles it banked at least one word in</li>
        <li><strong>Avg score</strong>: the puzzle's total score, averaged over its puzzles</li>
        <li><strong>Words</strong>: words banked per puzzle; <strong>Rejected</strong>: tries turned away per puzzle</li>
        <li><strong>Chat</strong>: opened the chat, and how many messages it wrote</li>
      </ul>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Puzzle</th>
              <th scope="col">Visits</th>
              <th scope="col">Puzzles</th>
              <th scope="col">Avg score</th>
              <th scope="col">Words</th>
              <th scope="col">Rejected</th>
              <th scope="col">Chat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                All{muse.browsers > 1 && <span className="analytics__n"> {fmt(muse.browsers)} browsers</span>}
              </th>
              <td>{fmt(muse.visits)}</td>
              <td>{fmt(muse.puzzles)}</td>
              <td>{avg(muse.avgScore)}</td>
              <td>{avg(muse.avgWords)}</td>
              <td>{avg(muse.avgRejected)}</td>
              <td>
                {muse.chatDays > 0 || muse.messages > 0
                  ? `Opened on ${fmt(muse.chatDays)}, ${fmt(muse.messages)} sent`
                  : "No"}
              </td>
            </tr>
            {muse.bots.length > 0 && (
              <tr>
                <th scope="colgroup" colSpan={7} className="analytics__n">
                  By bot, named as on the leaderboard
                </th>
              </tr>
            )}
            {muse.bots.map((b) => (
              <tr key={b.playerId} className="analytics__row--pair">
                <th scope="row" title={b.playerId}>
                  {handleFor(b.playerId)}
                  {b.lastSeen && <span className="analytics__n"> {shortDate(b.lastSeen.slice(0, 10))}</span>}
                </th>
                <td>{fmt(b.visits)}</td>
                <td>{fmt(b.puzzles)}</td>
                <td>{avg(b.avgScore)}</td>
                <td>{avg(b.avgWords)}</td>
                <td>{avg(b.avgRejected)}</td>
                <td>{chatCell(b.chatDays > 0, b.messages)}</td>
              </tr>
            ))}
            {muse.bots.length > 0 && muse.days.length > 0 && (
              <tr>
                <th scope="colgroup" colSpan={7} className="analytics__n">
                  By puzzle
                </th>
              </tr>
            )}
            {muse.days.map((d) => (
              <tr key={d.date} className="analytics__row--pair">
                <th scope="row">
                  {SHORT_WEEKDAYS[dowOf(d.date)]} {shortDate(d.date)}
                </th>
                <td>{fmt(d.visits)}</td>
                <td>{fmt(d.puzzles)}</td>
                <td>{avg(d.avgScore)}</td>
                <td>{avg(d.avgWords)}</td>
                <td>{avg(d.avgRejected)}</td>
                <td>{chatCell(d.chatOpened, d.messages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

interface MetricsRow {
  key: string;
  label: string;
  side?: string;
  metrics: KeyMetrics;
}

/**
 * The key numbers, a row per set of players; `split` pairs rows under one
 * label, and names the column that tells the pair apart.
 */
function MetricsTable({ rows, split }: { rows: MetricsRow[]; split?: string }) {
  return (
    <div className="analytics__table-wrap">
      <table className="analytics__table">
        <thead>
          <tr>
            <th scope="col">Who</th>
            {split && <th scope="col">{split}</th>}
            <th scope="col">Players</th>
            <th scope="col">Did something</th>
            <th scope="col">Guessed</th>
            <th scope="col">Completed</th>
            <th scope="col">Shared</th>
            <th scope="col">Back next day</th>
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
                  <Count n={m.completed} of={m.players} guessers={m.guessed} />
                </td>
                <td>
                  <Count n={m.shared} of={m.players} guessers={m.guessed} />
                </td>
                <td>
                  <Count n={m.nextDay.soFar} of={m.players} guessers={m.guessed} byGuessers={m.nextDay.guessers.soFar} />
                </td>
                <td>
                  <Count n={m.returned.soFar} of={m.players} guessers={m.guessed} byGuessers={m.returned.guessers.soFar} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A count and its share of `of`; given `guessers`, a second line with the share
 * of them -- `byGuessers` of them did it, which is `n` unless said otherwise.
 */
function Count({ n, of, guessers, byGuessers = n }: { n: number; of: number; guessers?: number; byGuessers?: number }) {
  return (
    <>
      {fmt(n)}
      {of > 0 && <span className="analytics__n"> {pct(n / of)}</span>}
      {guessers !== undefined && guessers > 0 && (
        <>
          <br />
          <span className="analytics__n">{pct(byGuessers / guessers)} of guessers</span>
        </>
      )}
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
