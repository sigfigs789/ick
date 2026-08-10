import { useState } from "react";
import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { todayShareText } from "../game/share";
import { RarityBadge } from "./RarityBadge";
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
  const shareText = todayShareText(drop, words, { spoilerFree, streak: streak.currentStreak });
  const best = bestWord(words);
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  const dropText = `"${drop}"`;
  const [headingBeforeDrop, headingAfterDrop] = shareHeading.split(dropText);

  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <div className="results-panel__capture">
        <h2 id="results-heading">Puzzle complete!</h2>
        <p className="results-panel__summary">
          You found {words.length} word{words.length === 1 ? "" : "s"} containing{" "}
          <strong>{drop.toUpperCase()}</strong> in {words.length} of {MAX_GUESSES} guesses.
        </p>

        {best && (
          <div className="results-panel__best">
            <p className="results-panel__best-label">Your best word</p>
            <p className="results-panel__best-word">
              👑 <span>{best.word}</span>
            </p>
            <RarityBadge rarity={best.rarity} zipf={best.zipf} />
          </div>
        )}

        <ul className="results-panel__list">
          {words.map((w) => (
            <li key={w.word}>
              <span className="results-panel__word">{w.word}</span>
              <RarityBadge rarity={w.rarity} zipf={w.zipf} />
            </li>
          ))}
        </ul>
        <p className="results-panel__streak">
          🔥 {streak.currentStreak} day streak
          {streak.longestStreak > streak.currentStreak
            ? ` · best: ${streak.longestStreak}`
            : ""}
        </p>
      </div>

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
        <strong>{drop.toUpperCase()}</strong>
        {headingAfterDrop}
        {shareDetailLines.length > 0 && `\n${shareDetailLines.join("\n")}`}
      </pre>
      <div className="results-panel__share-actions">
        <ShareButton text={shareText} />
      </div>
    </section>
  );
}
