import type { Rarity } from "../game/types";

// Short text tags reinforce the color so rarity is never color-only
// information -- a colorblind or grayscale-display player reads the same
// thing a sighted player does.
const RARITY_META: Record<Rarity, { tag: string; className: string }> = {
  "Very Common": { tag: "VERY COMMON", className: "rarity--very-common" },
  Common: { tag: "COMMON", className: "rarity--common" },
  Uncommon: { tag: "UNCOMMON", className: "rarity--uncommon" },
  Rare: { tag: "RARE", className: "rarity--rare" },
  "Extremely Rare": { tag: "EXTREMELY RARE", className: "rarity--extremely-rare" },
};

interface Props {
  rarity: Rarity;
}

export function RarityBadge({ rarity }: Props) {
  const meta = RARITY_META[rarity];
  // The visible tag text *is* the accessible name -- no color-only meaning,
  // no separate screen-reader-only duplicate needed.
  return <span className={`rarity-badge ${meta.className}`}>{meta.tag}</span>;
}
