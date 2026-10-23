import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { ReviewPage } from "./ReviewPage";
import { useReviewList } from "./reviewList";
import {
  fetchAnalytics,
  GROUPS,
  IDLE_HINT_VARIANTS,
  PUZZLE_TYPES,
  type AnalyticsReport,
  type Cohort,
  type Group,
  type KeyMetrics,
  type MuseReport,
  type PuzzleType,
  type SourceRow,
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
  SHARE_SOURCES,
  sourceName,
  windowDates,
  type AnalyticsWindow,
} from "./analyticsFormat";
import {
  chatBenchmark,
  cohortBenchmark,
  coreBenchmark,
  dayByDayBenchmark,
  growthBenchmark,
  idleHintBenchmark,
  keyNumbersBenchmark,
  museBenchmark,
  puzzleTypeBenchmark,
  resurrectedBenchmark,
  sourcesBenchmark,
  VERDICTS,
  type Benchmark,
  type Verdict,
} from "./analyticsBenchmarks";
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
 * opened the chat, and by the idle hint test's arm. Every number is built in one place, `analytics_overview` (see the
 * 2026-10-18, 2026-10-21 and 2026-10-26 migrations), and this page only draws
 * them. Growth, weekly active players by the same groupings, comes from the
 * same place (the 2026-10-27 migration), and so do the sections on whether
 * players stay -- retention by arrival week, core players, resurrected players
 * -- and where new players come from (the 2026-10-29 migration).
 *
 * Muse AI, an agent the maintainer sends to play (see game/visitor.ts), is
 * left out of all of it and has a section of its own at the end.
 *
 * Each section opens on a verdict -- weak, promising or great -- on the one
 * number it is judged by, with the marks for each (see analyticsBenchmarks.ts).
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
        benchmark={dayByDayBenchmark(report.groups.all)}
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
        benchmark={keyNumbersBenchmark(report.groups.all)}
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

      <SourcesSection sources={report.sources} sharers={report.groups.all.shared} span={span} />

      <GrowthSection weekly={report.weekly} />

      <CohortSection cohorts={report.cohorts} />

      <CoreSection weekly={report.weekly} />

      <ResurrectedSection weekly={report.weekly} />

      <Section
        title="Puzzle type"
        benchmark={puzzleTypeBenchmark(report.modes.all)}
        note={`${span}. Played only Standard, only Freeform, or both, so each player is in one row and the three add up to the key numbers. A day's mode is the one played, switched to or given, else the one the player last had.`}
      >
        <MetricsTable
          split="Puzzle type"
          rows={GROUPS.flatMap((g) =>
            PUZZLE_TYPES.map((type) => ({
              key: `${g}-${type}`,
              label: GROUP_NAMES[g],
              side: (
                <>
                  <span className={`analytics__swatch analytics__swatch--${type}`} aria-hidden="true" />
                  {PUZZLE_TYPE_NAMES[type]}
                </>
              ),
              metrics: report.modes[g][type],
            })),
          )}
        />
      </Section>

      <Section
        title="Chat"
        benchmark={chatBenchmark(report.chat.all)}
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
        benchmark={idleHintBenchmark(report.idleHint.all)}
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
 * Weekly active and playing players, each with its growth on the week before,
 * and the share of the active ones who played, by grouping.
 * Weeks run Sunday to Saturday, the latest the one today's puzzle is in, and do not follow the window.
 */
function GrowthSection({ weekly }: { weekly: WeekActives[] }) {
  const [group, setGroup] = useState<Group>("all");
  return (
    <Section
      title="Growth"
      benchmark={growthBenchmark(weekly)}
      note={`The latest ${GROWTH_WEEKS} weeks, whatever the window: each week runs Sunday to Saturday, so the latest is still counting up.`}
    >
      <ul className="review__meta analytics__bullets">
        <li><strong>Weekly active players</strong>: opened the game on any puzzle that week</li>
        <li><strong>Weekly playing players</strong>: banked a word in any puzzle that week</li>
        <li><strong>Growth</strong>: each one's change on the week before</li>
        <li><strong>Open to play</strong>: the share of the week's active players who played</li>
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
              <th scope="col">Weekly playing players</th>
              <th scope="col">Playing growth</th>
              <th scope="col">Open to play</th>
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
                <td>{fmt(w.playing[group])}</td>
                <td>{growth(w.playing[group], weekly[i + 1]?.playing[group])}</td>
                <td>{w.players[group] ? pct(w.playing[group] / w.players[group]) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Weeks after arrival the retention table has columns for. */
const COHORT_WEEKS = 12;

/**
 * Retention by arrival week: of the players whose first-ever day fell in a
 * week, the share who turned up again in each week after. A curve that levels
 * off above zero is an audience that stays.
 */
function CohortSection({ cohorts }: { cohorts: Cohort[] }) {
  const [who, setWho] = useState<"players" | "guessers">("players");
  const columns = Math.min(COHORT_WEEKS, Math.max(0, ...cohorts.map((c) => c.weeks.length)));
  return (
    <Section
      title="Retention by arrival week"
      benchmark={cohortBenchmark(cohorts)}
      note="The latest 13 weeks, whatever the window. Each row is the players whose first-ever visit fell in that Sunday-to-Saturday week; each column the share of them who turned up in a later week. The last cell in each row is still counting up."
    >
      <div className="analytics__groups" role="group" aria-label="Arrivals">
        {(["players", "guessers"] as const).map((w) => (
          <button
            key={w}
            type="button"
            className="analytics__window-button"
            aria-pressed={w === who}
            onClick={() => setWho(w)}
          >
            {w === "players" ? "Everyone" : "Guessed in their first week"}
          </button>
        ))}
      </div>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Arrived</th>
              <th scope="col">Players</th>
              {Array.from({ length: columns }, (_, k) => (
                <th key={k} scope="col">Week {k + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => {
              const size = c[who];
              return (
                <tr key={c.start}>
                  <th scope="row">{shortDate(c.start)}</th>
                  <td>{fmt(size)}</td>
                  {Array.from({ length: columns }, (_, k) => {
                    const cell = c.weeks[k];
                    if (!cell || size === 0) return <td key={k} />;
                    const share = cell[who] / size;
                    const open = k === c.weeks.length - 1;
                    return (
                      <td
                        key={k}
                        className="analytics__heat"
                        style={{ "--heat": share } as CSSProperties}
                        title={`${fmt(cell[who])} of ${fmt(size)}${open ? ", still counting up" : ""}`}
                      >
                        {pct(share)}
                        {open && <span className="analytics__n"> so far</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * How often each week's players played: the ones who banked a word on one of
 * its puzzles, two or three, or four or more -- the core, for whom the game is
 * a habit.
 */
function CoreSection({ weekly }: { weekly: WeekActives[] }) {
  return (
    <Section
      title="Core players"
      benchmark={coreBenchmark(weekly)}
      note={`The latest ${GROWTH_WEEKS} weeks, whatever the window, Sunday to Saturday; the latest is still counting up. Players who banked a word that week, by how many of its 7 puzzles they played.`}
    >
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Played</th>
              <th scope="col">1 day</th>
              <th scope="col">2–3 days</th>
              <th scope="col">Core: 4+ days</th>
            </tr>
          </thead>
          <tbody>
            {weekly.slice(0, GROWTH_WEEKS).map((w, i) => {
              const played = w.played.oneDay + w.played.twoToThree + w.played.fourPlus;
              return (
                <tr key={w.end}>
                  <th scope="row">
                    {shortDate(w.start)} to {shortDate(w.end)}
                    {i === 0 && <span className="analytics__n"> so far</span>}
                  </th>
                  <td>{fmt(played)}</td>
                  <td><Count n={w.played.oneDay} of={played} /></td>
                  <td><Count n={w.played.twoToThree} of={played} /></td>
                  <td>
                    <strong>{fmt(w.played.fourPlus)}</strong>
                    {played > 0 && <span className="analytics__n"> {pct(w.played.fourPlus / played)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * Where each week's players came from -- new, kept from the week before, or
 * resurrected after missing at least the week before -- and how many of the
 * week before's were lost. Resurrected players who stay are a sign the game
 * pulls people back; ones who leave again are a visit, not a return.
 */
function ResurrectedSection({ weekly }: { weekly: WeekActives[] }) {
  return (
    <Section
      title="Resurrected players"
      benchmark={resurrectedBenchmark(weekly)}
      note={`The latest ${GROWTH_WEEKS} weeks, whatever the window, Sunday to Saturday; the latest is still counting up.`}
    >
      <ul className="review__meta analytics__bullets">
        <li><strong>Kept</strong>: played the week before too</li>
        <li><strong>Resurrected</strong>: played before, but missed at least the week before</li>
        <li><strong>Stayed</strong>: of the resurrected, turned up again the week after</li>
        <li><strong>Lost</strong>: played the week before, not this week</li>
        <li><strong>Net</strong>: new + resurrected − lost</li>
      </ul>
      <div className="analytics__table-wrap">
        <table className="analytics__table">
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Players</th>
              <th scope="col">New</th>
              <th scope="col">Kept</th>
              <th scope="col">Resurrected</th>
              <th scope="col">Stayed</th>
              <th scope="col">Lost</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {weekly.slice(0, GROWTH_WEEKS).map((w, i) => {
              const f = w.flow;
              const net = f.new + f.resurrected - f.lost;
              return (
                <tr key={w.end}>
                  <th scope="row">
                    {shortDate(w.start)} to {shortDate(w.end)}
                    {i === 0 && <span className="analytics__n"> so far</span>}
                  </th>
                  <td>{fmt(w.players.all)}</td>
                  <td><Count n={f.new} of={w.players.all} /></td>
                  <td><Count n={f.kept} of={w.players.all} /></td>
                  <td><Count n={f.resurrected} of={w.players.all} /></td>
                  <td>
                    {f.resurrected === 0 ? "–" : (
                      <>
                        {fmt(f.resurrectedStayed)}
                        <span className="analytics__n">
                          {" "}{pct(f.resurrectedStayed / f.resurrected)}{w.nextWeekOver ? "" : " so far"}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{fmt(f.lost)}</td>
                  <td>{net > 0 ? `+${fmt(net)}` : net < 0 ? `−${fmt(-net)}` : "0"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * The window's new players by where their first visit came from, and how well
 * each source's players took to the game. Share links are the game growing on
 * its own: new players from them over the players who shared.
 */
function SourcesSection({ sources, sharers, span }: { sources: SourceRow[]; sharers: number; span: string }) {
  const newPlayers = sources.reduce((sum, s) => sum + s.players, 0);
  const fromShares = sources.filter((s) => SHARE_SOURCES.has(s.source)).reduce((sum, s) => sum + s.players, 0);
  return (
    <Section
      title="Where new players come from"
      benchmark={sourcesBenchmark(sources, sharers)}
      note={`${span}. New players by the link or site their first-ever visit came from.`}
    >
      <p className="review__meta analytics__note">
        Share links brought {fmt(fromShares)} new {fromShares === 1 ? "player" : "players"}
        {sharers > 0
          ? `, from ${fmt(sharers)} ${sharers === 1 ? "player" : "players"} who shared: ${(fromShares / sharers).toFixed(2)} per sharer.`
          : "; nobody shared in this window."}
      </p>
      {newPlayers > 0 && (
        <div className="analytics__table-wrap">
          <table className="analytics__table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">New players</th>
                <th scope="col">Guessed</th>
                <th scope="col">Back within 7 days</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source}>
                  <th scope="row">{sourceName(s.source)}</th>
                  <td><Count n={s.players} of={newPlayers} /></td>
                  <td><Count n={s.guessed} of={s.players} /></td>
                  <td><Count n={s.returned.soFar} of={s.players} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      benchmark={museBenchmark(muse)}
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
  side?: ReactNode;
  metrics: KeyMetrics;
}

const PUZZLE_TYPE_NAMES: Record<PuzzleType, string> = {
  standard: "Standard only",
  freeform: "Freeform only",
  both: "Both",
};

/**
 * The key numbers, a row per set of players; `split` sets rows in a row with
 * the same label under it, and names the column that tells them apart.
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
            const first = !split || i === 0 || rows[i - 1].label !== r.label;
            let span = 1;
            while (split && rows[i + span]?.label === r.label) span++;
            return (
              <tr key={r.key} className={first ? undefined : "analytics__row--pair"}>
                {first && (
                  <th scope="row" rowSpan={split ? span : undefined}>
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

const VERDICT_NAMES: Record<Verdict, string> = { weak: "Weak", promising: "Promising", great: "Great" };

/** A section's verdict on its one number, and what each verdict needs. */
function BenchmarkLine({ benchmark: b }: { benchmark: Benchmark }) {
  return (
    <div className="analytics__bench">
      <p className="analytics__bench-line">
        <span className={`analytics__verdict analytics__verdict--${b.verdict ?? "early"}`}>
          {b.verdict ? VERDICT_NAMES[b.verdict] : "Too early"}
        </span>
        {b.value === null ? (
          <span>
            {b.measure} · needs {b.needs}
          </span>
        ) : (
          <span>
            <strong>{b.value}</strong> {b.measure}
          </span>
        )}
      </p>
      <p className="analytics__n analytics__bench-criteria">
        {VERDICTS.map((v, i) => (
          <span key={v}>
            {i > 0 && " · "}
            {VERDICT_NAMES[v]} {b.criteria[v]}
          </span>
        ))}
      </p>
    </div>
  );
}

function Section({
  title,
  note,
  benchmark,
  children,
}: {
  title: string;
  note?: string;
  benchmark?: Benchmark;
  children: ReactNode;
}) {
  return (
    <section className="analytics__section">
      <h2 className="analytics__heading">{title}</h2>
      {benchmark && <BenchmarkLine benchmark={benchmark} />}
      {note && <p className="review__meta analytics__note">{note}</p>}
      {children}
    </section>
  );
}
