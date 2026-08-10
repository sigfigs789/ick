import type { Rarity } from "../game/types";

// Short text tags reinforce the color so rarity is never color-only
// information -- a colorblind or grayscale-display player reads the same
// thing a sighted player does. The dot is decorative reinforcement, not a
// second channel of meaning on its own.
const RARITY_META: Record<Rarity, { tag: string; className: string }> = {
  "Very Common": { tag: "VERY COMMON", className: "rarity--very-common" },
  Common: { tag: "COMMON", className: "rarity--common" },
  Uncommon: { tag: "UNCOMMON", className: "rarity--uncommon" },
  Rare: { tag: "RARE", className: "rarity--rare" },
  "Extremely Rare": { tag: "EXTREMELY RARE", className: "rarity--extremely-rare" },
};

interface Props {
  rarity: Rarity;
  /** Precomputed Zipf frequency (lower = rarer) -- shown so ties within a label can be told apart. */
  zipf?: number;
}

export function RarityBadge({ rarity, zipf }: Props) {
  const meta = RARITY_META[rarity];
  return (
    <span className={`rarity-badge ${meta.className}`}>
      <span className="rarity-badge__dot" aria-hidden="true" />
      {meta.tag}
      {zipf !== undefined && <span className="rarity-badge__zipf">{zipf.toFixed(1)}</span>}
    </span>
  );
}
