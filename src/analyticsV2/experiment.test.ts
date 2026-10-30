import { describe, expect, it } from "vitest";
import { arm, compare, emptyArm, parseExperiment, playersNeeded, standings, verdict, type Arm, type Experiment } from "./experiment";

function arms(shownD1: [number, number], hiddenD1: [number, number], week?: [[number, number], [number, number]]): Experiment {
  const make = (variant: "shown" | "hidden", d1: [number, number], wk?: [number, number]): Arm => ({
    ...emptyArm(variant, "all"),
    assigned: d1[1],
    d1: { returned: d1[0], cohort: d1[1] },
    week: { returned: wk?.[0] ?? 0, cohort: wk?.[1] ?? 0, days: 0 },
  });
  return { since: "2026-11-01", arms: [make("shown", shownD1, week?.[0]), make("hidden", hiddenD1, week?.[1])] };
}

describe("word of the day experiment", () => {
  it("reads what the database sent, dropping arms it does not know", () => {
    const parsed = parseExperiment({
      since: "2026-11-01",
      arms: [
        { variant: "shown", segment: "all", assigned: 5, d1: { cohort: 4, returned: 1 }, week: { cohort: 2, returned: 1, days: 3 }, month: { cohort: 2, returned: 2 } },
        { variant: "other", segment: "all" },
      ],
    })!;
    // The one it knows, and the returning arm worked out from it.
    expect(parsed.arms.map((a) => a.segment)).toEqual(["all", "returning"]);
    expect(parsed.arms[0].week).toEqual({ cohort: 2, returned: 1, days: 3 });
    expect(parsed.arms[0].month).toEqual({ cohort: 2, returned: 2 });
    expect(parsed.arms[0].d7).toEqual({ cohort: 0, returned: 0 });
    // Sent by a database from before activation was counted: nothing, not an error.
    expect(parsed.arms[0].activation).toEqual({ cohort: 0, returned: 0 });
    expect(parseExperiment(undefined)).toBeNull();
  });

  it("reads activation, and works it out for returning players too", () => {
    const parsed = parseExperiment({
      arms: [
        { variant: "shown", segment: "all", assigned: 10, activation: { cohort: 6, returned: 4 } },
        { variant: "shown", segment: "new", assigned: 4, activation: { cohort: 4, returned: 4 } },
      ],
    })!;
    expect(arm(parsed, "shown", "all").activation).toEqual({ cohort: 6, returned: 4 });
    expect(arm(parsed, "shown", "returning").activation).toEqual({ cohort: 2, returned: 0 });
  });

  it("works out returning players as everyone drawn less the new", () => {
    const parsed = parseExperiment({
      arms: [
        { variant: "shown", segment: "all", assigned: 10, d1: { cohort: 8, returned: 4 }, week: { cohort: 6, returned: 3, days: 9 }, sharedDays: 5 },
        { variant: "shown", segment: "new", assigned: 4, d1: { cohort: 3, returned: 1 }, week: { cohort: 2, returned: 1, days: 2 }, sharedDays: 1 },
        { variant: "hidden", segment: "all", assigned: 6 },
      ],
    })!;
    const shown = arm(parsed, "shown", "returning");
    expect(shown.assigned).toBe(6);
    expect(shown.d1).toEqual({ cohort: 5, returned: 3 });
    expect(shown.week).toEqual({ cohort: 4, returned: 2, days: 7 });
    expect(shown.sharedDays).toBe(4);
    // No new players in the hidden arm: everyone drawn is returning.
    expect(arm(parsed, "hidden", "returning").assigned).toBe(6);
  });

  it("tests a gap between two rates", () => {
    // 30% against 20% over 300 each is a clear gap; 21% against 20% is not.
    expect(compare({ returned: 90, cohort: 300 }, { returned: 60, cohort: 300 }).p).toBeLessThan(0.01);
    expect(compare({ returned: 63, cohort: 300 }, { returned: 60, cohort: 300 }).p).toBeGreaterThan(0.5);
    expect(compare({ returned: 0, cohort: 0 }, { returned: 1, cohort: 3 }).p).toBe(1);
  });

  it("reckons the players needed to tell a 5-point gap at 20% D1", () => {
    // 2 × 0.2 × 0.8 × 7.85 / 0.0025 ≈ 1,005.
    expect(playersNeeded(0.2)).toBeGreaterThan(990);
    expect(playersNeeded(0.2)).toBeLessThan(1020);
  });

  it("waits for enough players in both arms", () => {
    expect(verdict(arms([30, 99], [10, 300])).call).toBe("early");
    expect(verdict({ since: null, arms: [] }).call).toBe("early");
  });

  it("keeps the word when D1 is clearly better with it, and removes it when worse", () => {
    expect(verdict(arms([90, 300], [60, 300])).call).toBe("keep");
    expect(verdict(arms([60, 300], [90, 300])).call).toBe("remove");
  });

  it("falls back on 7-day return when D1 is level", () => {
    const v = verdict(arms([60, 300], [60, 300], [[150, 300], [100, 300]]));
    expect(v.call).toBe("keep");
    expect(v.headline).toMatch(/lean/i);
  });

  it("says not yet while a level D1 is short of the players a real gap needs", () => {
    expect(verdict(arms([61, 300], [60, 300])).call).toBe("early");
    expect(verdict(arms([61, 300], [60, 300])).headline).toBe("No difference yet");
  });

  it("calls it even once a level D1 has enough players behind it", () => {
    expect(verdict(arms([402, 2000], [400, 2000])).call).toBe("even");
  });

  it("places each arm against the scorecard's bands", () => {
    const a = { ...emptyArm("shown", "all"), d1: { returned: 30, cohort: 100 }, d7: { returned: 1, cohort: 10 } };
    expect(standings(a)).toEqual({ d1: "promising", d7: null, week: null, month: null, share: null });
  });
});
