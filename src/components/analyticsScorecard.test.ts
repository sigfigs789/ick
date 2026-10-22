import { describe, expect, it } from "vitest";
import { parseAnalytics, type AnalyticsReport, type GameplayReport, type WeekActives } from "../game/review";
import { addDays } from "./analyticsFormat";
import { dauRow, regularsRow, scorecard, sharingRow, strictRetentionRow } from "./analyticsScorecard";

const TODAY = "2026-10-22";

/** A report whose days each have `guessed(i)` active players, i counting back from yesterday. */
function report(guessed: (ago: number) => number, extra: Partial<AnalyticsReport> = {}): AnalyticsReport {
  const day = (ago: number) => {
    const g = guessed(ago);
    const m = { players: g * 2, acted: g, guessed: g, shared: Math.round(g / 10), completed: g, returned: 0, nextDay: 0 };
    return { date: addDays(TODAY, -ago), closed: true, groups: { all: m, new: m, returning: m } };
  };
  return {
    ...parseAnalytics({}),
    daily: Array.from({ length: 57 }, (_, i) => day(56 - i)),
    ...extra,
  };
}

function week(played: WeekActives["played"]): WeekActives {
  return {
    start: "2026-10-04",
    end: "2026-10-10",
    players: { all: 0, new: 0, returning: 0 },
    flow: { new: 0, kept: 0, resurrected: 0, resurrectedStayed: 0, lost: 0 },
    nextWeekOver: true,
    played,
  };
}

describe("scorecard", () => {
  it("bands strict retention, calling a number in the table's gap in between", () => {
    expect(strictRetentionRow("d1", { cohort: 100, returned: 10 }).standing).toBe("nowhere");
    expect(strictRetentionRow("d1", { cohort: 100, returned: 20 }).standing).toBe("between");
    expect(strictRetentionRow("d1", { cohort: 100, returned: 30 })).toMatchObject({ standing: "promising", value: "30%" });
    // Past promising's top but short of great is still promising.
    expect(strictRetentionRow("d1", { cohort: 100, returned: 38 }).standing).toBe("promising");
    expect(strictRetentionRow("d7", { cohort: 100, returned: 20 }).standing).toBe("great");
    expect(strictRetentionRow("d30", { cohort: 10, returned: 5 })).toMatchObject({ standing: null, value: null });
  });

  it("reads the DAU trend from active players, four weeks against the four before", () => {
    const row = dauRow(report((ago) => (ago <= 28 ? 12 : 10)), TODAY);
    expect(row).toMatchObject({ value: "+20%/mo", standing: "great" });
    expect(dauRow(report(() => 10), TODAY)).toMatchObject({ value: "0%/mo", standing: "nowhere" });
    expect(dauRow(report(() => 10, { daily: [] }), TODAY).standing).toBeNull();
  });

  it("calls sharing great once share links bring a tenth of new players", () => {
    const sources = (share: number, direct: number) => [
      { source: "share", players: share, guessed: 0, returned: { rate: { cohort: 0, returned: 0 }, soFar: 0 } },
      { source: "direct", players: direct, guessed: 0, returned: { rate: { cohort: 0, returned: 0 }, soFar: 0 } },
    ];
    expect(sharingRow(report(() => 10, { sources: sources(1, 99) }), TODAY)).toMatchObject({ value: "10%", standing: "promising" });
    expect(sharingRow(report(() => 10, { sources: sources(10, 90) }), TODAY).standing).toBe("great");
  });

  it("counts weekly regulars over the full weeks, leaving out the one still counting", () => {
    const weeks = [week({ oneDay: 0, twoToThree: 0, fourPlus: 100 }), week({ oneDay: 30, twoToThree: 40, fourPlus: 30 })];
    expect(regularsRow(weeks)).toMatchObject({ value: "30%", standing: "promising" });
  });

  it("takes strict retention from the gameplay report when there is one", () => {
    const rate = { cohort: 100, returned: 3 };
    const gameplay = { retention: { d1: rate, d7: rate, d30: rate } } as GameplayReport;
    const rows = scorecard(report(() => 10), gameplay, TODAY);
    expect(rows.map((r) => r.metric)).toEqual([
      "D1 retention",
      "D7 retention",
      "D30 retention",
      "DAU trend over 8 weeks",
      "Players sharing results",
      "Weekly regulars*",
    ]);
    expect(rows[2]).toMatchObject({ value: "3%", standing: "between" });
    expect(scorecard(report(() => 10), null, TODAY)[1].howMeasured).toMatch(/Nearest the report has/);
  });
});
