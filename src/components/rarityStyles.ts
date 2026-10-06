import { usesGoldElusive, usesRetunedTiers } from "../game/dictionary";
import type { Rarity } from "../game/types";

/**
 * The palette class for each rarity. Kept out of RarityBadge.tsx so both the
 * badge and the bare scores that borrow its colours can read from one place --
 * a component file that also exports helpers loses fast refresh.
 */
const RARITY_CLASS: Record<Rarity, string> = {
  Quotidian: "rarity--quotidian",
  "Very Common": "rarity--very-common",
  Common: "rarity--common",
  Uncommon: "rarity--uncommon",
  Rare: "rarity--rare",
  "Extremely Rare": "rarity--extremely-rare",
  Elusive: "rarity--elusive",
  Mythic: "rarity--mythic",
  Legend: "rarity--legend",
};

/**
 * The palette class for a rarity under `date`'s puzzle, so anything showing a
 * tier's colours matches the badge -- including the Legend that wore orange
 * before the tiers were retuned, and the amber Elusive wore before it turned
 * gold, both of which archived puzzles keep.
 */
export function rarityClassName(rarity: Rarity, date?: string): string {
  if (rarity === "Legend" && !usesRetunedTiers(date)) return "rarity--legend-legacy";
  if (rarity === "Elusive" && !usesGoldElusive(date)) return "rarity--elusive-amber";
  return RARITY_CLASS[rarity];
}
