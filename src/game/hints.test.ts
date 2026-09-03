import { describe, expect, it } from "vitest";
import dictionary from "../data/dictionary.json";
import dropData from "../data/drops.json";
import hintCopy from "../data/hint-copy.json";
import hintData from "../data/hints.json";
import rarityData from "../data/rarity.json";
import { hintForDrop } from "./hints";

const ZIPF = new Map<string, number>();
(dictionary as string[]).forEach((word, i) => {
  ZIPF.set(word, rarityData.zipfHundredths[i] / 100);
});

describe("hintForDrop", () => {
  it("covers every drop in the rotation", () => {
    const missing = dropData.drops.filter((d) => hintForDrop(d) === undefined);
    expect(missing).toEqual([]);
  });

  it("names the drop in the positional hints", () => {
    for (const [drop, key] of Object.entries(hintData as Record<string, string>)) {
      if (key !== "middle" && key !== "end" && key !== "start") continue;
      expect(hintForDrop(drop)).toContain(drop);
    }
  });

  it("is case-insensitive about the drop", () => {
    expect(hintForDrop("str")).toBe(hintForDrop("STR"));
  });

  it("has no hint for a drop outside the rotation", () => {
    expect(hintForDrop("zzzz")).toBeUndefined();
  });

  // The whole point of a hint here is to teach a way to look for words rather
  // than to hand one over. Naming a common word costs nothing -- a common word
  // scores badly -- but a hint that happens to name a rare word containing its
  // own drop would be the old ceiling-word reveal in a new costume.
  it("never names a word worth submitting for its own drop", () => {
    const leaks: string[] = [];
    for (const drop of dropData.drops) {
      const hint = hintForDrop(drop);
      if (hint === undefined) continue;
      const needle = drop.toLowerCase();
      for (const token of hint.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
        if (!token.includes(needle)) continue;
        const zipf = ZIPF.get(token);
        if (zipf !== undefined && zipf < 4.0) leaks.push(`${drop}: ${token}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("keeps the copy and the assignments in step", () => {
    const used = new Set(Object.values(hintData as Record<string, string>));
    for (const key of used) expect(hintCopy).toHaveProperty(key);
  });
});
