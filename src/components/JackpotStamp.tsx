import { rarityClassName } from "./rarityStyles";
import type { Rarity } from "../game/types";

/**
 * The tier stamped across the screen for a Mythic or Legend: it slams in,
 * glows, and fades, over the grand confetti. Decoration only -- the feedback
 * toast has already announced the word and its tier.
 */
export function JackpotStamp({ rarity, date }: { rarity: Rarity; date: string }) {
  return (
    <div className="jackpot" aria-hidden="true">
      <div className="jackpot__flash" />
      <div className={`jackpot__stamp ${rarityClassName(rarity, date)}`}>{rarity}!</div>
    </div>
  );
}
