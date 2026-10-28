import { describe, expect, it } from "vitest";
import { parseReport, type Report } from "./report";
import { addDays, dauTrend, lastSunday, scorecard, stand } from "./scorecard";

const TODAY = "2026-10-22"; // a Thursday

/** A report with `players(date)` players a day over the 84 days to today. */
function report(players: (date: string) => number, extra: Record<string, unknown> = {}): Report {
  const daily = Array.from({ length: 84 }, (_, i) => {
    const date = addDays(TODAY, i - 83);
    return { date, visitors: players(date) * 3, newVisitors: 0, players: players(date), newPlayers: 0 };
  });
  return parseReport({ today: TODAY, trackedSince: "2026-09-25", daily, ...extra });
}

describe("bands", () => {
  const marks = { nowhere: 0.15, promising: 0.25, great: 0.4 };

  it("calls a number in the table's gap in between, and one past promising's top still promising", () => {
    expect(stand(0.14, marks)).toBe("nowhere");
    expect(stand(0.2, marks)).toBe("between");
    expect(stand(0.25, marks)).toBe("promising");
    expect(stand(0.38, marks)).toBe("promising");
    expect(stand(0.4, marks)).toBe("great");
  });

  it("judges the number as shown, so 24.6% is a promising 25%", () => {
    expect(stand(0.246, marks)).toBe("promising");
  });
});

describe("weeks", () => {
  it("run Monday to Sunday", () => {
    expect(lastSunday(TODAY)).toBe("2026-10-18");
    expect(lastSunday("2026-10-19")).toBe("2026-10-18");
    expect(lastSunday("2026-10-18")).toBe("2026-10-11");
    expect(lastSunday("2026-10-24")).toBe("2026-10-18");
  });
});

describe("scorecard", () => {
  it("leads with activation, first-time visitors who banked a word, and waits for enough of them", () => {
    const activation = (firstVisits: number, firstVisitPlayed: number) =>
      scorecard(report(() => 10, { window: { firstVisits, firstVisitPlayed } }))[0];
    expect(activation(100, 25)).toMatchObject({ metric: "Activation", value: "25%", standing: "nowhere" });
    expect(activation(100, 35).standing).toBe("between");
    expect(activation(100, 40).standing).toBe("promising");
    expect(activation(100, 60).standing).toBe("great");
    expect(activation(10, 4)).toMatchObject({ value: "40%", standing: "promising" });
    expect(activation(9, 6)).toMatchObject({ value: null, standing: null, detail: "needs 10 first-time visitors" });
  });

  it("bands D1, D7, back within a week, D30 and back within a month over players, and waits for a cohort big enough to judge", () => {
    const rows = scorecard(
      report(() => 10, {
        retention: {
          d1: { players: { cohort: 100, returned: 30 } },
          d7: { players: { cohort: 100, returned: 8 } },
          week: { players: { cohort: 100, returned: 36 } },
          d30: { players: { cohort: 10, returned: 5 } },
          month: { players: { cohort: 100, returned: 56 } },
        },
      }),
    );
    expect(rows[1]).toMatchObject({ metric: "D1 retention", value: "30%", standing: "promising" });
    expect(rows[2]).toMatchObject({ value: "8%", standing: "between" });
    expect(rows[3]).toMatchObject({ metric: "Back within a week", value: "36%", standing: "promising" });
    expect(rows[4]).toMatchObject({ value: null, standing: null });
    expect(rows[5]).toMatchObject({ metric: "Back within a month", value: "56%", standing: "great" });
  });

  it("reads the DAU trend from the last four full weeks against the four before, as a monthly rate", () => {
    const end = lastSunday(TODAY);
    const growing = report((date) => (date > addDays(end, -28) ? 12 : 10));
    const trend = dauTrend(growing);
    expect(trend?.recent).toBe(12);
    expect(trend?.before).toBe(10);
    expect(scorecard(growing)[6]).toMatchObject({ value: "+22%/mo", standing: "great" });
    expect(scorecard(report(() => 10))[6]).toMatchObject({ value: "0%/mo", standing: "nowhere" });
  });

  it("calls sharing great only when it is consistent and share links bring a tenth of new players", () => {
    const sharing = (shared: number, fromShares: number) =>
      scorecard(
        report(() => 10, {
          window: { playerDays: 100, sharedDays: shared },
          sources: [
            { source: "share", recentPlayers: fromShares },
            { source: "direct", recentPlayers: 100 - fromShares },
          ],
        }),
      )[7];
    expect(sharing(3, 0).standing).toBe("nowhere");
    expect(sharing(7, 50).standing).toBe("between");
    expect(sharing(15, 5).standing).toBe("promising");
    expect(sharing(15, 10).standing).toBe("great");
  });

  it("counts weekly regulars as last full week's players on 3 or more days", () => {
    const rows = scorecard(
      report(() => 10, {
        weekly: [
          { start: "2026-10-18", players: 50, daysPlayed: { 1: 50 } },
          { start: "2026-10-11", players: 100, daysPlayed: { 1: 60, 2: 15, 3: 10, 7: 15 } },
        ],
      }),
    );
    expect(rows[8]).toMatchObject({ value: "25%", standing: "promising" });
  });
});
