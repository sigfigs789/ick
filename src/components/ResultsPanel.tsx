import { useState } from "react";
import { buildShareText } from "../game/share";
import { ShareButton } from "./ShareButton";
import { TwitterShareButton } from "./TwitterShareButton";
import type { AcceptedWord, StreakState } from "../game/types";
import { trackResultShared } from "../analytics";

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
}

export function ResultsPanel({ date, drop, words, streak }: Props) {
  // Showing submitted words is opt-in so shared results remain spoiler-free
  // unless the player explicitly asks to include their answers.
  const [showAnswers, setShowAnswers] = useState(false);
  const shareText = buildShareText(date, drop, words, {
    spoilerFree: !showAnswers,
    streak: streak.currentStreak,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
  });
  const twitterShareText = buildShareText(date, drop, words, {
    spoilerFree: !showAnswers,
    streak: streak.currentStreak,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
    source: null,
  });
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  return (
    <section className="results-panel" aria-label="Share result">
      <label className="results-panel__spoiler-toggle">
        <input
          type="checkbox"
          checked={showAnswers}
          onChange={(e) => setShowAnswers(e.target.checked)}
        />
        Show my answers
      </label>
      <pre className="results-panel__preview" aria-hidden="true">
        <strong>{shareHeading}</strong>
        {shareDetailLines.length > 0 && `\n${shareDetailLines.join("\n")}`}
      </pre>
      <div className="results-panel__share-actions">
        <ShareButton
          text={shareText}
          onShared={() => trackResultShared(date, streak.currentStreak)}
        />
        <TwitterShareButton
          text={twitterShareText}
          onShared={() => trackResultShared(date, streak.currentStreak)}
        />
      </div>
    </section>
  );
}
