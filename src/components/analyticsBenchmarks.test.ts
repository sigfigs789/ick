import { describe, expect, it } from "vitest";
import type { KeyMetrics, MuseReport, WeekActives } from "../game/review";
import {
  cohortBenchmark,
  coreBenchmark,
  growthBenchmark,
  idleHintBenchmark,
  keyNumbersBenchmark,
  museBenchmark,
  puzzleTypeBenchmark,
  resurrectedBenchmark,
  sourcesBenchmark,
} from "./analyticsBenchmarks";

const rate = (cohort: number, returned: number) => ({ cohort, returned });

function metrics(players: number, guessed: number, nextDay = rate(0, 0)): KeyMetrics {
  const returns = { rate: nextDay, soFar: nextDay.returned, guessers: { ...rate(0, 0), soFar: 0 } };
  return { players, acted: players, guessed, shared: 0, completed: 0, returned: returns, nextDay: returns };
}

function week(players: number, extra: Partial<WeekActives> = {}): WeekActives {
  return {
    start: "2026-10-04",
    end: "2026-10-10",
    players: { all: players, new: 0, returning: players },
    flow: { new: 0, kept: 0, resurrected: 0, resurrectedStayed: 0, lost: 0 },
    nextWeekOver: true,
    played: { oneDay: 0, twoToThree: 0, fourPlus: 0 },
    ...extra,
  };
}

describe("benchmarks", () => {
  it("bands next-day return at 15% and 30%, judging the number as shown", () => {
    expect(keyNumbersBenchmark(metrics(100, 50, rate(100, 14))).verdict).toBe("weak");
    // 14.6% shows as 15%, so it is not called under 15%.
    expect(keyNumbersBenchmark(metrics(1000, 500, rate(1000, 146))).verdict).toBe("promising");
    const great = keyNumbersBenchmark(metrics(100, 50, rate(100, 30)));
    expect(great).toMatchObject({ verdict: "great", value: "30%" });
    expect(great.criteria).toEqual({ weak: "under 15%", promising: "15% to 30%", great: "30% or more" });
  });

  it("is too early, and says what it needs, below a section's minimum", () => {
    const early = keyNumbersBenchmark(metrics(10, 5, rate(10, 9)));
    expect(early).toMatchObject({ verdict: null, value: null, needs: "20 players whose next day is over" });
  });

  it("averages growth over the last four full weeks, leaving the week still counting out", () => {
    // 100 -> 146.41 over four weeks is 10% a week; the open week's 1 does not count.
    const weekly = [week(1), week(146.41), week(133.1), week(121), week(110), week(100)];
    expect(growthBenchmark(weekly)).toMatchObject({ verdict: "great", value: "+10%" });
    expect(growthBenchmark(weekly.slice(0, 5)).verdict).toBeNull();
    expect(growthBenchmark([week(1), week(90), week(95), week(98), week(99), week(100)])).toMatchObject({
      verdict: "weak",
      value: "−3%",
    });
  });

  it("reads week-1 retention only from arrival weeks whose week after is over", () => {
    const cohorts = [
      { start: "2026-10-11", players: 500, guessers: 0, weeks: [{ players: 400, guessers: 0 }] },
      { start: "2026-10-04", players: 100, guessers: 0, weeks: [{ players: 12, guessers: 0 }, { players: 1, guessers: 0 }] },
    ];
    expect(cohortBenchmark(cohorts)).toMatchObject({ verdict: "promising", value: "12%" });
  });

  it("judges core players on the last full week, and resurrected on final weeks", () => {
    const weekly = [
      week(50, { played: { oneDay: 0, twoToThree: 0, fourPlus: 50 }, nextWeekOver: false }),
      week(40, { played: { oneDay: 30, twoToThree: 5, fourPlus: 5 }, nextWeekOver: false,
        flow: { new: 0, kept: 0, resurrected: 50, resurrectedStayed: 50, lost: 0 } }),
      week(30, { flow: { new: 0, kept: 0, resurrected: 10, resurrectedStayed: 5, lost: 0 } }),
    ];
    expect(coreBenchmark(weekly)).toMatchObject({ verdict: "weak", value: "13%" });
    expect(resurrectedBenchmark(weekly)).toMatchObject({ verdict: "great", value: "50%" });
  });

  it("counts new players from share links per sharer", () => {
    const sources = [
      { source: "share", players: 3, guessed: 0, returned: { rate: rate(0, 0), soFar: 0 } },
      { source: "direct", players: 50, guessed: 0, returned: { rate: rate(0, 0), soFar: 0 } },
    ];
    expect(sourcesBenchmark(sources, 10)).toMatchObject({ verdict: "promising", value: "0.30" });
    expect(sourcesBenchmark(sources, 4).verdict).toBeNull();
  });

  it("reads the tests as a lift in points on the arm they are against", () => {
    const arms = { control: metrics(100, 40), treatment: metrics(100, 46) };
    expect(idleHintBenchmark(arms)).toMatchObject({ verdict: "great", value: "+6 pts" });
    const modes = { standard: metrics(100, 50, rate(100, 30)), freeform: metrics(50, 25, rate(50, 12)) };
    const freeform = puzzleTypeBenchmark(modes);
    expect(freeform).toMatchObject({ verdict: "weak", value: "−6 pts" });
    expect(freeform.criteria.promising).toBe("−5 pts to +5 pts");
  });

  it("bands Muse AI's rejected tries lower-is-better", () => {
    const muse = { puzzles: 4, avgWords: 9, avgRejected: 1 } as MuseReport;
    const b = museBenchmark(muse);
    expect(b).toMatchObject({ verdict: "promising", value: "10%" });
    expect(b.criteria).toEqual({ weak: "25% or more", promising: "10% to 25%", great: "under 10%" });
  });
});
