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
import { IDLE_HINT_DELAY_MS } from "../game/idleHint";

/**
 * How the game is doing, as a page at /analytics.
 *
 * Five numbers, and the same five everywhere: the players who turned up, the
 * ones who did anything, the ones who guessed (banked a word), the ones who
 * shared their result, and the ones who came back within seven days. They are
 * split by who the players are -- new or returning -- by the puzzle type they
 * played, by whether they opened the chat, by which play screen they were
 * shown, and by the idle hint test's arm. Every number is built in one place,
 * `analytics_overview` (see the 2026-10-18 and 2026-10-21 migrations), and
 * this page only draws them.
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
          <li><strong>Shared</strong>: copied their result with Share (the second line is the share of guessers, the only players who can)</li>
          <li><strong>Back within 7 days</strong>: played again in the next 7 days (recent days still counting up; the second line is the share of guessers)</li>
          <li><strong>New</strong>: first visit in this window</li>
        </ul>
        <MetricsTable
          rows={GROUPS.map((g) => ({ key: g, label: GROUP_NAMES[g], metrics: report.groups[g] }))}
        />
      </Section>

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
        note={`${span}. Current play screen vs the new one, each browser assigned 50/50${
          report.uiSince ? `, since ${shortDate(report.uiSince)}` : ""
        }.`}
      >
        <MetricsTable
          split="Play screen"
          rows={GROUPS.flatMap((g) => [
            { key: `${g}-control`, label: GROUP_NAMES[g], side: "Current", metrics: report.ui[g].control },
            { key: `${g}-v2`, label: GROUP_NAMES[g], side: "New", metrics: report.ui[g].v2 },
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
            <th scope="col">Shared</th>
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
                  <Count n={m.shared} of={m.players} />
                  {m.guessed > 0 && (
                    <>
                      <br />
                      <span className="analytics__n">{pct(m.shared / m.guessed)} of guessers</span>
                    </>
                  )}
                </td>
                <td>
                  <Count n={m.returned.soFar} of={m.players} />
                  {m.guessed > 0 && (
                    <>
                      <br />
                      <span className="analytics__n">{pct(m.returned.guessers.soFar / m.guessed)} of guessers</span>
                    </>
                  )}
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

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="analytics__section">
      <h2 className="analytics__heading">{title}</h2>
      {note && <p className="review__meta analytics__note">{note}</p>}
      {children}
    </section>
  );
}
