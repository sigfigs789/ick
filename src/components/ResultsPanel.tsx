import { RarityBadge } from "./RarityBadge";
import { ShareButton } from "./ShareButton";
import { todayShareText } from "../game/share";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  fragment: string;
  words: AcceptedWord[];
  streak: StreakState;
}

export function ResultsPanel({ fragment, words, streak }: Props) {
  const shareText = todayShareText(fragment, words);

  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <h2 id="results-heading">Puzzle complete!</h2>
      <p className="results-panel__summary">
        You found three words containing <strong>{fragment.toUpperCase()}</strong>.
      </p>
      <ul className="results-panel__list">
        {words.map((w) => (
          <li key={w.word}>
            <span className="results-panel__word">{w.word}</span>
            <RarityBadge rarity={w.rarity} />
          </li>
        ))}
      </ul>
      <p className="results-panel__streak">
        🔥 {streak.currentStreak} day streak
        {streak.longestStreak > streak.currentStreak
          ? ` · best: ${streak.longestStreak}`
          : ""}
      </p>
      <ShareButton text={shareText} />
      <pre className="results-panel__preview" aria-hidden="true">
        {shareText}
      </pre>
    </section>
  );
}
