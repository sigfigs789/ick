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
  /** Puzzle date, so the score uses the scoring system in effect that day. */
  date?: string;
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
