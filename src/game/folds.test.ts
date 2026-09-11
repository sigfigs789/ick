import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheFolds,
  cachedFolds,
  clearFoldCache,
  filterFolds,
  FOLD_SCAN_TOTAL,
  scanFolds,
  sortFolds,
  type FoldedWord,
} from "./folds";
import {
  baseFormSubstitution,
  formatRarityScore,
  isValidWord,
} from "./dictionary";

/** The whole dictionary, scanned once and shared -- it is a second of work. */
const ALL: FoldedWord[] = [];
let scannedAll = false;
function allFolds(): readonly FoldedWord[] {
  if (!scannedAll) {
    let at = 0;
    while (at < FOLD_SCAN_TOTAL) at = scanFolds(at, 50_000, ALL);
    scannedAll = true;
  }
  return ALL;
}

function fold(word: string): FoldedWord | undefined {
  return allFolds().find((entry) => entry.word === word);
}

beforeEach(() => {
  clearFoldCache();
});

describe("the fold scan", () => {
  it("reports the word, the common form, and both scores", () => {
    const abaci = fold("abaci");
    expect(abaci).toBeDefined();
    expect(abaci?.base).toBe("abacus");
    // The score the word's own frequency would have earned, and the one the
    // fold actually gives it -- the second being the lower of the two, since
    // every fold is a cap.
    expect(formatRarityScore(abaci!.ownZipf)).toBe("9.65");
    expect(formatRarityScore(abaci!.baseZipf)).toBe("7.7");
    expect(abaci?.ownRarity).toBe("Mythic");
    expect(abaci?.baseRarity).toBe("Rare");
  });

  it("measures the drop in the scores as shown, since that is what is sorted on", () => {
    for (const entry of allFolds().slice(0, 2000)) {
      const shownOwn = Number(formatRarityScore(entry.ownZipf));
      const shownBase = Number(formatRarityScore(entry.baseZipf));
      expect(entry.drop).toBeCloseTo(shownOwn - shownBase, 2);
    }
  });

  it("agrees with the scorer the game plays by, word for word", () => {
    // The table is built by running the real function rather than from a
    // shipped list, which is the point: a precomputed table is a second copy of
    // the rule that can quietly disagree with the one scoring the game.
    for (const entry of allFolds().slice(0, 500)) {
      const substitution = baseFormSubstitution(entry.word);
      expect(substitution?.base).toBe(entry.base);
      expect(substitution?.ownZipf).toBe(entry.ownZipf);
      expect(substitution?.baseZipf).toBe(entry.baseZipf);
    }
  });

  it("leaves out words nobody can play", () => {
    for (const entry of allFolds().slice(0, 2000)) {
      expect(isValidWord(entry.word)).toBe(true);
    }
  });

  it("resumes where it left off, so the page can scan in pieces", () => {
    const whole: FoldedWord[] = [];
    scanFolds(0, 20_000, whole);

    const pieces: FoldedWord[] = [];
    let at = 0;
    for (let pass = 0; pass < 4; pass++) at = scanFolds(at, 5_000, pieces);

    expect(at).toBe(20_000);
    expect(pieces.map((entry) => entry.word)).toEqual(
      whole.map((entry) => entry.word),
    );
  });

  it("stops at the end of the dictionary rather than running past it", () => {
    const rows: FoldedWord[] = [];
    expect(scanFolds(FOLD_SCAN_TOTAL - 10, 5_000, rows)).toBe(FOLD_SCAN_TOTAL);
  });
});

describe("ordering the folds", () => {
  const rows: FoldedWord[] = [
    { word: "cab", base: "c", drop: 1 },
    { word: "abc", base: "a", drop: 5 },
    { word: "bca", base: "b", drop: 5 },
  ].map((row) => ({
    ...row,
    ownZipf: 1,
    baseZipf: 2,
    ownRarity: "Legend",
    baseRarity: "Common",
  }));

  it("opens on the folds that cost the most", () => {
    expect(sortFolds(rows, "drop").map((row) => row.word)).toEqual([
      // Ties break alphabetically, so the same data is always the same list.
      "abc",
      "bca",
      "cab",
    ]);
  });

  it("sorts by word when asked", () => {
    expect(sortFolds(rows, "alphabetical").map((row) => row.word)).toEqual([
      "abc",
      "bca",
      "cab",
    ]);
  });

  it("leaves the list it was handed alone", () => {
    sortFolds(rows, "drop");
    expect(rows.map((row) => row.word)).toEqual(["cab", "abc", "bca"]);
  });
});

describe("searching the folds", () => {
  const rows = allFolds();

  it("matches the word played", () => {
    const found = filterFolds(rows, "abaci");
    expect(found.map((row) => row.word)).toContain("abaci");
  });

  it("matches the common form too, so 'what folds onto this' is one search", () => {
    const found = filterFolds(rows, "abacus");
    expect(found.some((row) => row.base === "abacus")).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(filterFolds(rows, "  ABACI  ").length).toBe(
      filterFolds(rows, "abaci").length,
    );
  });

  it("returns everything for an empty query", () => {
    expect(filterFolds(rows, "   ")).toBe(rows);
  });
});

describe("the scan cache", () => {
  it("is empty until a scan finishes, and holds it afterwards", () => {
    expect(cachedFolds()).toBeNull();
    const rows: FoldedWord[] = [];
    scanFolds(0, 1_000, rows);
    cacheFolds(rows);
    expect(cachedFolds()).toBe(rows);
  });
});
