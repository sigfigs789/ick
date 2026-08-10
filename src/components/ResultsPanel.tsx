import { useState } from "react";
import { todayShareText } from "../game/share";
import { ShareButton } from "./ShareButton";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
}

export function ResultsPanel({ drop, words, streak }: Props) {
  // Defaults to unchecked (full result: squares + words) -- hiding words
  // is an opt-in the player reaches for deliberately when sharing
  // somewhere spoilers matter, not the default. It controls whether the
  // plain-text share includes the submitted words or rarity squares only.
  const [spoilerFree, setSpoilerFree] = useState(false);
  const shareText = todayShareText(drop, words, {
    spoilerFree,
    streak: streak.currentStreak,
    crushedIt: streak.crushedIt,
    elite: streak.elite,
    highScore: streak.highScore,
  });
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  const dropText = `Drop: ${drop.toUpperCase()}`;
  const [headingBeforeDrop, headingAfterDrop] = shareHeading.split(dropText);

  return (
    <section className="results-panel" aria-label="Share result">
      <label className="results-panel__spoiler-toggle">
        <input
          type="checkbox"
          checked={spoilerFree}
          onChange={(e) => setSpoilerFree(e.target.checked)}
        />
        Spoiler free
      </label>
      <pre className="results-panel__preview" aria-hidden="true">
        {headingBeforeDrop}
        <strong>{dropText}</strong>
        {headingAfterDrop}
        {shareDetailLines.length > 0 && `\n${shareDetailLines.join("\n")}`}
      </pre>
      <div className="results-panel__share-actions">
        <ShareButton text={shareText} />
      </div>
    </section>
  );
}
