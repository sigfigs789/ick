import { formatRarityScore } from "../game/dictionary";
import { rarityClassName } from "./rarityStyles";
import type { Rarity } from "../game/types";

// Short text tags reinforce the color so rarity is never color-only
// information -- a colorblind or grayscale-display player reads the same
// thing a sighted player does. The dot is decorative reinforcement, not a
// second channel of meaning on its own.
const RARITY_TAG: Record<Rarity, string> = {
  Quotidian: "QUOTIDIAN",
  "Very Common": "VERY COMMON",
  Common: "COMMON",
  Uncommon: "UNCOMMON",
  Rare: "RARE",
  "Extremely Rare": "EXTREMELY RARE",
  Elusive: "ELUSIVE",
  Mythic: "MYTHIC",
  Legend: "LEGEND",
};

interface Props {
  rarity: Rarity;
  /** Precomputed Zipf frequency -- converted to a rarity score (higher = rarer) for display. */
  zipf?: number;
  /**
   * Puzzle date, so the score uses the scoring system in effect that day.
   * Required, though it may be undefined: the label beside the number was
   * priced by some puzzle's system, and a badge that silently fell back to the
   * undated one showed the pre-lift 9.3 under a Mythic label (2026-10-07).
   */
  date: string | undefined;
}

export function RarityBadge({ rarity, zipf, date }: Props) {
  const className = rarityClassName(rarity, date);
  return (
    <span className={`rarity-badge ${className}`}>
      <span className="rarity-badge__dot" aria-hidden="true" />
      {RARITY_TAG[rarity]}
      {zipf !== undefined && (
        <span className="rarity-badge__score">{formatRarityScore(zipf, date)}</span>
      )}
    </span>
  );
}
