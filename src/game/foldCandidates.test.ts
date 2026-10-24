import { beforeAll, describe, expect, it } from "vitest";
import {
  FOLD_BATCH_SIZE,
  foldBatch,
  foldCandidates,
  unjudgedCount,
  upcomingFoldDates,
  type FoldCandidate,
} from "./foldCandidates";
import { FREEFORM_TRIAL_END, FREEFORM_TRIAL_START } from "./mode";
import { baseFormSubstitution } from "./dictionary";

/** A row with only the fields the batching cares about. */
function row(word: string, drop = 1): FoldCandidate {
  return {
    word,
    base: "base",
    ownZipf: 1,
    baseZipf: 2,
    ownScore: "10.00",
    foldedScore: "9.00",
    ownRarity: "Legend",
    foldedRarity: "Mythic",
    drop,
    date: "2026-09-27",
    letters: "TI",
  };
}

describe("upcomingFoldDates", () => {
  it("skips the puzzles that do not fold", () => {
    // The trial week scores every word on its own frequency, so there is no fold
    // on any of its days to review. Asked from inside it, the window is the
    // puzzles on the far side.
    const dates = upcomingFoldDates(3, FREEFORM_TRIAL_START);
    expect(dates).toHaveLength(3);
    for (const date of dates) expect(date >= FREEFORM_TRIAL_END).toBe(true);
  });

  it("takes consecutive puzzles where they all fold", () => {
    expect(upcomingFoldDates(3, "2026-09-27")).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
    ]);
  });
});

describe("foldCandidates", () => {
  // Off a date before the corpus-era cutover, so the fold prices against the
  // curated list and this test needs no 3.6MB download to say anything. What it
  // checks is the shape of a row, not which words are in it: the fold itself is
  // pinned by inflection-scoring.test.ts, at length.
  // Worked out once the setup has the deferred scoring data in, not while the
  // file is collected.
  const date = "2026-09-01";
  let found: ReturnType<typeof foldCandidates> = [];
  beforeAll(() => {
    found = foldCandidates([date]);
  });

  it("reports each fold as the pair of words and the pair of scores", () => {
    expect(found.length).toBeGreaterThan(0);
    for (const candidate of found.slice(0, 50)) {
      const substitution = baseFormSubstitution(candidate.word, date);
      expect(substitution?.base).toBe(candidate.base);
      expect(candidate.ownZipf).toBe(substitution?.ownZipf);
      expect(candidate.baseZipf).toBe(substitution?.baseZipf);
    }
  });

  it("puts the fold that costs the most first", () => {
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i - 1].drop).toBeGreaterThanOrEqual(found[i].drop);
    }
  });

  it("holds every word it reports to the drop it was found under", () => {
    for (const candidate of found.slice(0, 50)) {
      expect(candidate.word).toContain(candidate.letters.toLowerCase());
    }
  });

  it("names a word once, however many of the puzzles reach it", () => {
    const across = foldCandidates(upcomingFoldDates(3, "2026-09-27"));
    expect(new Set(across.map((c) => c.word)).size).toBe(across.length);
  });
});

describe("foldBatch", () => {
  const candidates = Array.from({ length: 60 }, (_, i) =>
    row(`word${String(i).padStart(2, "0")}`, 60 - i)
  );

  it("hands over a batch at a time, in the order the list is in", () => {
    const batch = foldBatch(candidates, new Set());
    expect(batch).toHaveLength(FOLD_BATCH_SIZE);
    expect(batch[0].word).toBe("word00");
  });

  it("takes the front of what is left, so an answered batch skips nothing", () => {
    // The bug a page number would have: judge all 25, ask for the next page, and
    // the 25 that moved up into those positions are never seen. The set cannot.
    const first = foldBatch(candidates, new Set());
    const done = new Set(first.map((c) => c.word));
    const second = foldBatch(candidates, done);
    expect(second[0].word).toBe("word25");
    expect(second.some((c) => done.has(c.word))).toBe(false);
  });

  it("runs out rather than wrapping", () => {
    const done = new Set(candidates.map((c) => c.word));
    expect(foldBatch(candidates, done)).toEqual([]);
  });
});

describe("unjudgedCount", () => {
  it("counts what is left to answer", () => {
    const candidates = [row("one"), row("two"), row("three")];
    expect(unjudgedCount(candidates, new Set(["two"]))).toBe(2);
  });
});
