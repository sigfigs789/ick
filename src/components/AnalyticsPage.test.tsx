import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";
import { findHighlights } from "./analyticsFormat";
import { parseAnalytics } from "../game/review";

const weekday = (dow: number, avgPlayers: number, cohort: number, returned: number) => ({
  dow,
  puzzles: 4,
  avgPlayers,
  avgNewPlayers: 2,
  avgWords: 3.5,
  avgTotal: 20,
  nextDayCohort: cohort,
  nextDayReturned: returned,
});

/** The shape `analytics_report` returns, trimmed to a few days. */
const REPORT = {
  asOf: "2026-09-27",
  windowDays: 60,
  totals: {
    players: 200,
    plays: 900,
    today: 40,
    last7: 120,
    last30: 180,
    avgDaysPerPlayer: 4.5,
    firstDay: "2026-08-25",
  },
  daily: [
    { date: "2026-09-26", players: 50, newPlayers: 5, standard: 0, freeform: 50 },
    { date: "2026-09-27", players: 40, newPlayers: 3, standard: 30, freeform: 10 },
  ],
  retention: {
    d1: { cohort: 180, returned: 72 },
    d7: { cohort: 120, returned: 30 },
    d30: { cohort: 0, returned: 0 },
    week1: { cohort: 120, returned: 84 },
  },
  cohorts: [
    { week: "2026-09-13", size: 50, active: [50, 25, 10] },
    { week: "2026-09-20", size: 40, active: [40, 20] },
  ],
  weekday: [
    weekday(0, 30, 100, 40),
    weekday(1, 50, 100, 70),
    weekday(2, 45, 100, 60),
    weekday(3, 44, 100, 60),
    weekday(4, 43, 100, 60),
    weekday(5, 40, 100, 55),
    weekday(6, 32, 100, 45),
  ],
  modes: [
    { mode: "standard", players: 150, plays: 600, avgWords: 3.6, avgTotal: 19, avgTop: 5.1, nextDayCohort: 550, nextDayReturned: 300 },
    { mode: "freeform", players: 120, plays: 300, avgWords: 3.4, avgTotal: 21, avgTop: 5.4, nextDayCohort: 280, nextDayReturned: 180 },
  ],
  depth: [
    { bucket: "1 day", players: 60 },
    { bucket: "2–3", players: 70 },
  ],
  funnel: {
    visits: 1000,
    firstVisits: 300,
    engaged: 700,
    completed: 500,
    won: 250,
    shared: 100,
    sharedOnX: 10,
    toFreeform: 12,
    toStandard: 5,
  },
  sources: [
    { source: "direct", visits: 600, firstVisits: 100, engaged: 400 },
    { source: "reddit", visits: 100, firstVisits: 80, engaged: 90 },
  ],
  sessions: {
    sessions: 800,
    medianVisibleMs: 185000,
    medianPlayingMs: 240000,
    medianFirstGuessMs: 21000,
    guessedShare: 0.8,
  },
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, visits: hour })),
};

function stubFetch(report: unknown = REPORT) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => {
    if (report === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ report }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.history.pushState(null, "", "/analytics?key=sesame");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnalyticsPage", () => {
  it("leads with the headline numbers and retention", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    expect(await screen.findByText("Players today")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/review?list=analytics&days=60&key=sesame");
    // Next-day retention: 72 of 180.
    const nextDay = screen.getByText("72 of 180").closest(".analytics__tile")!;
    expect(within(nextDay as HTMLElement).getByText("40%")).toBeInTheDocument();
    // Day 30 has nobody old enough yet, and says so rather than printing 0%.
    expect(screen.getByText("not enough days yet")).toBeInTheDocument();
  });

  it("tables the weekday and mode numbers", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    const monday = (await screen.findByRole("rowheader", { name: "Monday" })).closest("tr")!;
    expect(within(monday).getByText("70%")).toBeInTheDocument();
    const freeform = screen.getByRole("rowheader", { name: "Freeform" }).closest("tr")!;
    expect(within(freeform).getByText("64%")).toBeInTheDocument();
  });

  it("reloads for a different window", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "90 days" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=90"))).toBe(true),
    );
  });

  it("says so when the report cannot load", async () => {
    stubFetch(null);
    render(<AnalyticsPage />);
    expect(await screen.findByText(/Couldn.t load this list/)).toBeInTheDocument();
  });
});

describe("findHighlights", () => {
  it("names the best and worst days to come back, and the stronger mode", () => {
    const lines = findHighlights(parseAnalytics(REPORT));
    expect(lines).toContain(
      "Monday players come back the next day most often (70%); Sunday players least (40%).",
    );
    expect(lines).toContain("Monday is the busiest puzzle (50 players on average), Sunday the quietest (30).");
    expect(lines).toContain(
      "A Freeform day is followed by another play 64% of the time, against 55% for Standard.",
    );
    expect(lines).toContain("30% of everyone who has played has played exactly once.");
    expect(lines).toContain("Visits from reddit engage the most: 90% engaged per visit.");
  });

  it("ranks nothing off a handful of players", () => {
    const small = parseAnalytics({
      ...REPORT,
      weekday: REPORT.weekday.map((w) => ({ ...w, nextDayCohort: 3, nextDayReturned: w.dow === 1 ? 3 : 0 })),
      modes: REPORT.modes.map((m) => ({ ...m, nextDayCohort: 4 })),
    });
    const lines = findHighlights(small);
    expect(lines.some((l) => l.includes("come back the next day most often"))).toBe(false);
    expect(lines.some((l) => l.includes("is followed by another play"))).toBe(false);
  });
});
