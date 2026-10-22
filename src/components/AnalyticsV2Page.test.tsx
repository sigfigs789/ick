import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsV2Page } from "./AnalyticsV2Page";

vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => "2026-10-22",
}));

const metrics = { players: 200, acted: 150, guessed: 100, shared: 20, completed: 80 };

const OVERVIEW = {
  today: "2026-10-22",
  groups: { all: metrics, new: { ...metrics, players: 120, guessed: 40 }, returning: metrics },
  daily: [],
  weekly: [],
  cohorts: [{ start: "2026-09-27", players: 60, guessers: 30, weeks: [{ players: 9, guessers: 6 }, { players: 3, guessers: 3 }] }],
  sources: [
    { source: "share", players: 12, guessed: 6, returned: {} },
    { source: "direct", players: 108, guessed: 34, returned: {} },
  ],
};

const GAMEPLAY = {
  retention: { d1: { cohort: 778, returned: 40 }, d7: { cohort: 589, returned: 25 }, d30: { cohort: 215, returned: 6 } },
  leaderboard: { players: 200, viewers: 50, opens: 120, viewDays: 80, viewed: { cohort: 70, returned: 35 }, notViewed: { cohort: 100, returned: 30 } },
  sharing: { shared: { cohort: 20, returned: 14 }, notShared: { cohort: 150, returned: 50 } },
  scores: [{ tier: "Legend", finished: 30, shared: 6, cohort: 28, returned: 18 }],
};

function stub(gameplay: unknown | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("list=analytics-gameplay")) {
        return gameplay === null
          ? new Response("{}", { status: 502 })
          : new Response(JSON.stringify({ report: gameplay }), { status: 200 });
      }
      return new Response(JSON.stringify({ report: OVERVIEW }), { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AnalyticsV2Page", () => {
  it("draws the scorecard, the five sections and why players come back", async () => {
    stub(GAMEPLAY);
    render(<AnalyticsV2Page />);

    expect(await screen.findByRole("heading", { name: "Scorecard" })).toBeTruthy();
    for (const name of ["Acquisition", "Retention", "Engagement", "Virality", "Momentum", "Why players come back"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    // Strict D7: 25 of 589 is 4%, under the 5% the table calls going nowhere.
    const d7 = screen.getByRole("rowheader", { name: "D7 retention" }).closest("tr")!;
    expect(d7.textContent).toContain("4%");
    expect(d7.textContent).toContain("Going nowhere");
    expect(screen.getByText("Legend")).toBeTruthy();
  });

  it("draws everything else while the gameplay function is not in the database", async () => {
    stub(null);
    render(<AnalyticsV2Page />);

    expect(await screen.findByRole("heading", { name: "Scorecard" })).toBeTruthy();
    expect(screen.getAllByText(/Waiting on the analytics_gameplay function/)).toHaveLength(2);
  });
});
