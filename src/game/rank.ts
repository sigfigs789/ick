import type { AcceptedWord, Rarity } from "./types";

/** The rarest word among the player's accepted guesses -- lower Zipf frequency means rarer. */
export function bestWord(words: AcceptedWord[]): AcceptedWord | undefined {
  if (words.length === 0) return undefined;
  return words.reduce((best, w) => (w.zipf < best.zipf ? w : best));
}

export function isWinningRarity(rarity: Rarity): boolean {
  return rarity === "Rare" || rarity === "Extremely Rare" || rarity === "Elusive";
}

export function isEliteRarity(rarity: Rarity): boolean {
  return rarity === "Extremely Rare" || rarity === "Elusive";
}
