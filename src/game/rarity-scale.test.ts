import { describe, expect, it } from "vitest";
import rarity from "../data/rarity.json";
import rarityScale from "../data/rarity-scale.json";

/*
 * The score scale ships on its own so a saved score can be shown before
 * rarity.json arrives (see `scoringReady` in dictionary.ts). generate-data.py
 * writes both; this is what catches a rarity.json edited without its scale.
 */
describe("rarity-scale.json", () => {
  it("holds the highest and lowest Zipf in rarity.json", () => {
    let max = -Infinity;
    let min = Infinity;
    for (const z of rarity.zipfHundredths) {
      if (z > max) max = z;
      if (z < min) min = z;
    }
    expect(rarityScale).toEqual({ maxZipfHundredths: max, minZipfHundredths: min });
  });
});
