import { describe, expect, it } from "vitest";
import { parseReport, type Report } from "./report";
import { addDays, dauTrend, lastSaturday, scorecard, stand } from "./scorecard";

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
  it("run Sunday to Saturday", () => {
    expect(lastSaturday(TODAY)).toBe("2026-10-17");
    expect(lastSaturday("2026-10-18")).toBe("2026-10-17");
    expect(lastSaturday("2026-10-17")).toBe("2026-10-10");
  });
});

describe("scorecard", () => {
  it("bands D1, D7 and D30 over players, and waits for a cohort big enough to judge", () => {
    const rows = scorecard(
      report(() => 10, {
        retention: {
          d1: { players: { cohort: 100, returned: 30 } },
          d7: { players: { cohort: 100, returned: 8 } },
          d30: { players: { cohort: 10, returned: 5 } },
        },
      }),
    );
    expect(rows[0]).toMatchObject({ metric: "D1 retention", value: "30%", standing: "promising" });
    expect(rows[1]).toMatchObject({ value: "8%", standing: "between" });
    expect(rows[2]).toMatchObject({ value: null, standing: null });
  });

  it("reads the DAU trend from the last four full weeks against the four before, as a monthly rate", () => {
    const end = lastSaturday(TODAY);
    const growing = report((date) => (date > addDays(end, -28) ? 12 : 10));
    const trend = dauTrend(growing);
    expect(trend?.recent).toBe(12);
    expect(trend?.before).toBe(10);
    expect(scorecard(growing)[3]).toMatchObject({ value: "+22%/mo", standing: "great" });
    expect(scorecard(report(() => 10))[3]).toMatchObject({ value: "0%/mo", standing: "nowhere" });
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
      )[4];
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
    expect(rows[5]).toMatchObject({ value: "25%", standing: "promising" });
  });
});
