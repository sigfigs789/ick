import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { todayShareText } from "../game/share";
import { RarityBadge } from "./RarityBadge";
import { ShareButton } from "./ShareButton";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  fragment: string;
  words: AcceptedWord[];
  streak: StreakState;
}

export function ResultsPanel({ fragment, words, streak }: Props) {
  const shareText = todayShareText(fragment, words);
  const best = bestWord(words);

  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <h2 id="results-heading">Puzzle complete!</h2>
      <p className="results-panel__summary">
        You found {words.length} word{words.length === 1 ? "" : "s"} containing{" "}
        <strong>{fragment.toUpperCase()}</strong> in {words.length} of {MAX_GUESSES} guesses.
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
      <ShareButton text={shareText} />
      <pre className="results-panel__preview" aria-hidden="true">
        {shareText}
      </pre>
    </section>
  );
}
