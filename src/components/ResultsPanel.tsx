import { useState } from "react";
import { buildShareText, type RevealMode } from "../game/share";
import { windowTotals } from "../game/totals";
import { ShareButton } from "./ShareButton";
import { TwitterShareButton } from "./TwitterShareButton";
import type { AcceptedWord, StreakState } from "../game/types";
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
  /** Opens the leaderboard. Omitted in tests that only exercise sharing. */
  onLeaderboard?: () => void;
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
  onLeaderboard,
}: Props) {
  // Default to "top": name the player's rarest word as a low-stakes flex while
  // keeping the rest anonymous. "Hide" stays available for a fully spoiler-free
  // share.
  const [reveal, setReveal] = useState<RevealMode>("top");
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
  })}`;
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  return (
    <section className="results-panel" aria-label="Share result">
      <fieldset className="results-panel__spoiler-toggle">
        <legend>Show answers</legend>
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
      </fieldset>
      <pre className="results-panel__preview" aria-hidden="true">
        <strong>{shareHeading}</strong>
        {shareDetailLines.length > 0 && `\n${shareDetailLines.join("\n")}`}
      </pre>
      <div className="results-panel__share-actions">
        <ShareButton text={copiedShareText} onShared={trackResultCopied} />
        <TwitterShareButton
          text={twitterShareText}
          onShared={trackResultSharedOnX}
        />
      </div>
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
