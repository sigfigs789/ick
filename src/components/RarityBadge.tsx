import { formatRarityScore, formatScore, rarityScore } from "../game/dictionary";
import { useRollingNumber } from "../hooks/useRollingNumber";
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
  /** Just scored: the badge pops in and its number rolls up to the score. */
  fresh?: boolean;
}

export function RarityBadge({ rarity, zipf, date, fresh = false }: Props) {
  const className = rarityClassName(rarity, date);
  return (
    <span className={`rarity-badge ${className}${fresh ? " rarity-badge--fresh" : ""}`}>
      <span className="rarity-badge__dot" aria-hidden="true" />
      {RARITY_TAG[rarity]}
      {zipf !== undefined &&
        (fresh ? (
          <RollingScore zipf={zipf} date={date} />
        ) : (
          <span className="rarity-badge__score">{formatRarityScore(zipf, date)}</span>
        ))}
    </span>
  );
}

/**
 * The score rolling up to its value. The rolling digits are decoration: the
 * final score is what a screen reader is given, from the first frame.
 */
function RollingScore({ zipf, date }: { zipf: number; date: string | undefined }) {
  const final = formatRarityScore(zipf, date);
  const shown = formatScore(useRollingNumber(rarityScore(zipf, date), true), date);
  if (shown === final) return <span className="rarity-badge__score">{final}</span>;
  return (
    <span className="rarity-badge__score">
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
