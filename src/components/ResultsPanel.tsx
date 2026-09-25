import { Fragment, useState } from "react";
import { FREEFORM_STATS_LABEL, buildShareText, type RevealMode } from "../game/share";
import { RainbowWord } from "./RainbowWord";
import { windowTotals } from "../game/totals";
import { loadReveal, saveReveal } from "../game/reveal";
import { ShareButton } from "./ShareButton";
import { TwitterShareButton } from "./TwitterShareButton";
import type { AcceptedWord, StreakState } from "../game/types";
import type { GameMode } from "../game/mode";
import { trackResultCopied, trackResultSharedOnX } from "../analytics";

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  /**
   * Whether this is the current puzzle, which is what lets the shared result
   * call its score "Today" (see game/share.ts). Defaults to false, so an
   * archive result headed with its own date does not claim to be today's.
   */
  isToday?: boolean;
  /**
   * The rules this puzzle was played under, named on the share from
   * MODE_CHOICE_START on (see game/share.ts). Taken from the progress record
   * rather than from the switch, so an archived day shares the mode it was
   * played in.
   */
  mode?: GameMode;
  /** Opens the leaderboard. Omitted in tests that only exercise sharing. */
  onLeaderboard?: () => void;
}

const SPOILER_LABEL_ID = "results-panel-reveal-label";

/**
 * Colour the one "Freeform" a Freeform result puts where its week and month
 * totals would be (see game/share.ts).
 *
 * Done here rather than in `buildShareText` because it is a property of *this*
 * rendering and not of the share: what leaves the app is plain text, which has
 * no colour to carry. So the builder stays a pure string and the preview paints
 * one token of it.
 *
 * Only the stats line can contain the token, and only once -- the heading says
 * the mode too, but it is rendered as its own element above this and never
 * reaches here. A line without it is returned untouched, which is every line of
 * every Standard result.
 */
function paintFreeform(line: string) {
  const at = line.indexOf(FREEFORM_STATS_LABEL);
  if (at === -1) return line;
  return (
    <>
      {line.slice(0, at)}
      <RainbowWord word={FREEFORM_STATS_LABEL} />
      {line.slice(at + FREEFORM_STATS_LABEL.length)}
    </>
  );
}

// Naming answers is opt-in so shared results stay spoiler-free by default; the
// player can reveal just their rarest word ("Top") or every word ("All").
const REVEAL_OPTIONS: { value: RevealMode; label: string }[] = [
  { value: "none", label: "Hide" },
  { value: "top", label: "Top" },
  { value: "all", label: "All" },
];

export function ResultsPanel({
  date,
  drop,
  words,
  streak,
  isToday = false,
  mode,
  onLeaderboard,
}: Props) {
  // Starts from the player's last choice, "Top" until they make one (see
  // game/reveal.ts).
  const [reveal, setRevealState] = useState<RevealMode>(loadReveal);
  const setReveal = (next: RevealMode) => {
    setRevealState(next);
    saveReveal(next);
  };
  // Read once per render from this browser's own history rather than the
  // leaderboard: the numbers are the boards' arithmetic (see game/totals.ts),
  // but a player who never joined a board still gets them, and nothing here has
  // to wait on the network to draw a share preview.
  const totals = windowTotals(date);
  const sharedResultOptions = {
    reveal,
    streak: streak.currentStreak,
    weekTotal: totals.week,
    monthTotal: totals.month,
    isToday,
    mode,
  };
  const shareText = buildShareText(date, drop, words, sharedResultOptions);
  const copiedShareText = buildShareText(date, drop, words, {
    ...sharedResultOptions,
    source: "share",
  });
  const twitterShareText = `\n\n────\n${buildShareText(date, drop, words, {
    reveal,
    source: "twitter",
    format: "x",
    isToday,
    mode,
  })}`;
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  return (
    <section className="results-panel" aria-label="Share result">
      <div className="results-panel__share-actions">
        <ShareButton text={copiedShareText} onShared={trackResultCopied} />
        <TwitterShareButton
          text={twitterShareText}
          onShared={trackResultSharedOnX}
        />
      </div>
      {/* A radiogroup rather than a fieldset: the label sits on the same row as
          the options, and a <legend> can't join a flex row. */}
      <div
        className="results-panel__spoiler-toggle"
        role="radiogroup"
        aria-labelledby={SPOILER_LABEL_ID}
      >
        <span id={SPOILER_LABEL_ID}>Show answers</span>
        <div className="results-panel__spoiler-options">
          {REVEAL_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="results-panel-reveal"
                value={option.value}
                checked={reveal === option.value}
                onChange={() => setReveal(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <pre className="results-panel__preview" aria-hidden="true">
        <strong>{shareHeading}</strong>
        {shareDetailLines.length > 0 && "\n"}
        {shareDetailLines.map((line, index) => (
          <Fragment key={index}>
            {index > 0 && "\n"}
            {paintFreeform(line)}
          </Fragment>
        ))}
      </pre>
      {onLeaderboard && (
        // The second way in, and the one that will get used: a finished puzzle
        // is the moment a player actually wants to know where the score put
        // them. The header trophy is for every other moment.
        <button type="button" className="results-panel__leaderboard" onClick={onLeaderboard}>
          See the leaderboard
        </button>
      )}
    </section>
  );
}
