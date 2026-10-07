import { afterEach, describe, expect, it } from "vitest";
import {
  estimatedZipfEntry,
  indexEstimatedZipf,
  rarityFor,
  rarityForUncurated,
  scoredFromEstimate,
  setEstimatedZipfForTests,
  unattestedZipf,
} from "./dictionary";
import { scoreSource } from "../analytics";
import estimatedZipfData from "../data/estimated-zipf.json";

const SINCE = "2026-10-20";
const BEFORE = "2026-10-19";

const batch = (since: string, zipf: Record<string, number>, model = "claude-opus-5-5") => ({
  since,
  drop: "CHA",
  model,
  run: "https://github.com/sigfigs789/ick/actions/runs/1",
  zipf,
});

afterEach(() => {
  setEstimatedZipfForTests(
    (estimatedZipfData as unknown as { batches: Parameters<typeof setEstimatedZipfForTests>[0] }).batches
  );
});

describe("indexEstimatedZipf", () => {
  it("keeps the earliest batch for a word estimated twice", () => {
    const index = indexEstimatedZipf([
      batch("2026-10-22", { chatchke: 1.5 }, "later"),
      batch("2026-10-20", { chatchke: 0.4 }, "earlier"),
    ]);
    expect(index.get("chatchke")).toEqual({ zipf: 0.4, since: "2026-10-20", model: "earlier" });
  });
});

describe("Claude's estimates in scoring", () => {
  it("stand in for the sentinel from the batch's puzzle on, and never before", () => {
    setEstimatedZipfForTests([batch(SINCE, { enshittification: 2.5 })]);
    // Freeform: nothing folds, so the score is the word's own Zipf.
    expect(rarityFor("enshittification", BEFORE, "freeform")?.zipf).toBe(unattestedZipf());
    expect(rarityFor("enshittification", SINCE, "freeform")?.zipf).toBe(2.5);
    expect(rarityFor("enshittification", "2026-11-01", "freeform")?.zipf).toBe(2.5);
    // No date is the newest system, where every estimate is live.
    expect(rarityFor("enshittification")?.zipf).toBe(2.5);
  });

  it("are the word's own Zipf, so Standard's fold still caps them", () => {
    // "approachabilities" folds onto a measured base in Standard.
    const standard = rarityFor("approachabilities", SINCE, "standard")?.zipf;
    setEstimatedZipfForTests([batch(SINCE, { approachabilities: 0.3 })]);
    expect(rarityFor("approachabilities", SINCE, "standard")?.zipf).toBe(standard);
    expect(rarityFor("approachabilities", SINCE, "freeform")?.zipf).toBe(0.3);
  });

  it("never replace a measured frequency", () => {
    const measured = rarityFor("abandon", SINCE, "freeform")?.zipf;
    setEstimatedZipfForTests([batch(SINCE, { abandon: 0.1 })]);
    expect(rarityFor("abandon", SINCE, "freeform")?.zipf).toBe(measured);
  });

  it("floor at the sentinel, so a guess below it still scores 10.00", () => {
    setEstimatedZipfForTests([batch(SINCE, { chatchke: -9 })]);
    expect(rarityFor("chatchke", SINCE, "freeform")?.zipf).toBe(unattestedZipf());
  });

  it("reach corpus words through the uncurated path", () => {
    setEstimatedZipfForTests([batch(SINCE, { zzcorpusonly: 0.8 })]);
    expect(rarityForUncurated("zzcorpusonly", unattestedZipf(), SINCE).zipf).toBe(0.8);
    expect(rarityForUncurated("zzcorpusonly", unattestedZipf(), BEFORE).zipf).toBe(unattestedZipf());
  });

  it("tag an accepted word's score source", () => {
    setEstimatedZipfForTests([batch(SINCE, { enshittification: 2.5 })]);
    const estimated = { word: "enshittification", ...rarityFor("enshittification", SINCE, "freeform")! };
    expect(scoredFromEstimate(estimated.word, estimated.zipf, SINCE)).toBe(true);
    expect(scoreSource(SINCE, estimated)).toBe("estimated");

    const before = { word: "enshittification", ...rarityFor("enshittification", BEFORE, "freeform")! };
    expect(scoreSource(BEFORE, before)).toBe("unattested");

    const measured = { word: "abandon", ...rarityFor("abandon", SINCE, "freeform")! };
    expect(scoreSource(SINCE, measured)).toBe("measured");
  });
});

describe("the shipped estimates", () => {
  const { batches } = estimatedZipfData as unknown as {
    batches: { since: string; drop: string; model: string; zipf: Record<string, number> }[];
  };

  it("say who made every batch and for which puzzle", () => {
    for (const b of batches) {
      expect(b.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // One drop for a daily batch; a sweep lists every drop it covered.
      expect(b.drop).toMatch(/^[A-Z]+(, [A-Z]+)*$/);
      expect(b.model).toMatch(/^claude-/);
    }
  });

  // Not "containing the drop": a sweep also estimates words players have
  // already banked at 10.00, whichever drop they were played on.
  it("hold only real frequencies for lowercase words", () => {
    for (const b of batches) {
      for (const [word, zipf] of Object.entries(b.zipf)) {
        expect(word).toMatch(/^[a-z]+$/);
        expect(Number.isFinite(zipf) && zipf >= -3 && zipf <= 8).toBe(true);
        expect(estimatedZipfEntry(word)).toBeDefined();
      }
    }
  });
});
