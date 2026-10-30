import type { ReactNode } from "react";
import { arm, compare, standings, verdict, type Arm, type Experiment, type Segment } from "./experiment";
import type { Rate } from "./report";
import {
  ACTIVATION_MARKS,
  count,
  LEAST_FIRST_VISITS,
  percent,
  stand,
  STANDING_NAMES,
  type Standing,
} from "./scorecard";

/**
 * An experiment on /experimentsV2: the call first, then the two arms side by
 * side on the scorecard's own measures, for everyone drawn, then new and
 * returning players apart. `subject` names the thing tested ("the word of the
 * day"); `about` says who is drawn when, and how to force an arm. `arms` heads
 * the two arm columns, Shown and Hidden unless an experiment names its own.
 * `segments` leaves out the new and returning tables for an experiment that is
 * already one kind of player. `drawnBeforeFirstWord` is for one that draws a
 * player before they have banked a word -- on their first load -- so the arms
 * are compared on activation, over everyone drawn; otherwise everyone drawn is
 * already activated and the row is n/a. `activation` replaces the note's
 * account of an n/a Activation row for one where it is n/a for another reason.
 */
export function ExperimentView({
  experiment,
  subject,
  about,
  arms = DEFAULT_ARMS,
  segments = SEGMENTS,
  drawnBeforeFirstWord = false,
  activation = drawnBeforeFirstWord ? ACTIVATION_MEASURED : DRAWN_ACTIVATED,
}: {
  experiment: Experiment;
  subject: string;
  about: ReactNode;
  arms?: ArmNames;
  segments?: readonly Segment[];
  drawnBeforeFirstWord?: boolean;
  activation?: string;
}) {
  const call = verdict(experiment, subject);
  return (
    <>
      <div className="av2__verdict" data-call={call.call}>
        <strong className="av2__verdict-headline">{call.headline}</strong>
        <p className="av2__verdict-reason">{call.reason}</p>
      </div>
      {segments.map((segment) => (
        <ArmTable
          key={segment}
          experiment={experiment}
          segment={segment}
          subject={subject}
          arms={arms}
          activation={drawnBeforeFirstWord && segment === "all"}
        />
      ))}
      <p className="review__meta av2__note">
        {about}
        {experiment.since ? ` Drawn since ${experiment.since}; ` : " "}
        every number counts from the day a player was drawn. The call rests on D1 for everyone drawn; 7-day return
        breaks a tie. Sharing and finishing later puzzles are guardrails: a big drop there is worth a look even when D1
        is level. Later puzzles finished counts the days after the draw day on which a player banked a word, and of
        those, the share where they went on to finish that day&rsquo;s puzzle; the draw day is left out, since the
        player had already started it. {activation} A gap marked * is a real one (p &lt; 0.05).
      </p>
    </>
  );
}

/** The column headings for the `shown` and `hidden` arms. */
export type ArmNames = { shown: string; hidden: string };

const DEFAULT_ARMS: ArmNames = { shown: "Shown", hidden: "Hidden" };

const DRAWN_ACTIVATED =
  "Activation is n/a: a player is drawn only once they have banked a word, so everyone in either arm is " +
  "already activated and the arms cannot differ on it.";

const ACTIVATION_MEASURED =
  "A player is drawn on their first load, before any word, so activation is counted over everyone drawn: of " +
  "those drawn on the first day they were seen, the share who banked a word that day, as the scorecard counts " +
  "it. It is n/a for new and returning players apart, who are split by their first word.";

const SEGMENTS: readonly Segment[] = ["all", "new", "returning"];

const SEGMENT_NAMES: Record<Segment, string> = { all: "Everyone", new: "New", returning: "Returning" };

const captions = (subject: string): Record<Segment, string> => ({
  all: `Everyone drawn: with ${subject} against without.`,
  new:
    "New players alone: drawn on the day of their first word, who never saw the game with it before. " +
    "They stay new for this experiment on every day they come back.",
  returning:
    "Returning players alone: drawn on a later day, who had played before. They stay returning for good.",
});

function ArmTable({
  experiment,
  segment,
  subject,
  arms,
  activation,
}: {
  experiment: Experiment;
  segment: Segment;
  subject: string;
  arms: ArmNames;
  /** Whether the arms can differ on activation, so the row compares them. */
  activation: boolean;
}) {
  const caption = captions(subject)[segment];
  const shown = arm(experiment, "shown", segment);
  const hidden = arm(experiment, "hidden", segment);
  const s = standings(shown);
  const h = standings(hidden);
  const shareRate = (a: Arm): Rate => ({ cohort: a.playerDays, returned: a.sharedDays });
  const finishRate = (a: Arm): Rate => ({ cohort: a.laterDays, returned: a.laterCompleted });
  const rows: [string, ReactNode, ReactNode, ReactNode][] = [
    ["Players drawn", count(shown.assigned), count(hidden.assigned), ""],
    // The scorecard's first row, kept so the measures line up with it; see the note.
    activation
      ? rateRow(
          "Activation",
          shown.activation,
          hidden.activation,
          activationStanding(shown.activation),
          activationStanding(hidden.activation),
        )
      : ["Activation", "n/a", "n/a", "–"],
    rateRow("D1 retention", shown.d1, hidden.d1, s.d1, h.d1),
    rateRow("D7 retention", shown.d7, hidden.d7, s.d7, h.d7),
    rateRow("Back within a week", shown.week, hidden.week, s.week, h.week),
    ["Days played in the week after", days(shown) ?? "–", days(hidden) ?? "–", daysGap(shown, hidden)],
    rateRow("Back within a month", shown.month, hidden.month, s.month, h.month),
    rateRow("Player-days shared", shareRate(shown), shareRate(hidden), s.share, h.share),
    rateRow("Later puzzles finished", finishRate(shown), finishRate(hidden)),
  ];
  return (
    <>
    <h3 className="av2__subheading">{SEGMENT_NAMES[segment]}</h3>
    <div className="av2__table-wrap">
      <p className="review__meta av2__caption">{caption}</p>
      <table className="av2__table" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">{arms.shown}</th>
            <th scope="col">{arms.hidden}</th>
            <th scope="col">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, gap]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{a}</td>
              <td>{b}</td>
              <td>{gap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Where an arm's activation lands against the scorecard's marks, judged as soon as the scorecard judges it. */
function activationStanding(rate: Rate): Standing | null {
  return rate.cohort >= LEAST_FIRST_VISITS ? stand(rate.returned / rate.cohort, ACTIVATION_MARKS) : null;
}

function rateRow(
  label: string,
  shown: Rate,
  hidden: Rate,
  shownStanding?: Standing | null,
  hiddenStanding?: Standing | null,
): [string, ReactNode, ReactNode, ReactNode] {
  const c = compare(shown, hidden);
  const both = shown.cohort > 0 && hidden.cohort > 0;
  return [
    label,
    <Cell rate={shown} standing={shownStanding} />,
    <Cell rate={hidden} standing={hiddenStanding} />,
    both ? `${gapPts(c.gap)}${c.p < 0.05 ? " *" : ""}` : "–",
  ];
}

function Cell({ rate, standing }: { rate: Rate; standing?: Standing | null }) {
  if (rate.cohort === 0) return <>–</>;
  return (
    <>
      <strong>{percent(rate.returned / rate.cohort)}</strong>{" "}
      <span className="av2__label">
        {count(rate.returned)}/{count(rate.cohort)}
      </span>
      {standing && <span className={`av2__pill av2__pill--${standing}`}> {STANDING_NAMES[standing]}</span>}
    </>
  );
}

function days(a: Arm): string | null {
  return a.week.cohort > 0 ? (a.week.days / a.week.cohort).toFixed(2) : null;
}

function daysGap(shown: Arm, hidden: Arm): string {
  const a = days(shown);
  const b = days(hidden);
  if (a === null || b === null) return "–";
  const gap = Number(a) - Number(b);
  return `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${Math.abs(gap).toFixed(2)}`;
}

function gapPts(gap: number): string {
  const n = Math.round(gap * 100);
  return n > 0 ? `+${n} pts` : n < 0 ? `−${-n} pts` : "0 pts";
}
