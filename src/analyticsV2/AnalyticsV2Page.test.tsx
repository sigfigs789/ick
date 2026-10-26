import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalyticsV2Page } from "./AnalyticsV2Page";

vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => "2026-10-22",
}));

const REPORT = {
  today: "2026-10-22",
  trackedSince: "2026-09-25",
  daily: [],
  retention: {
    d1: { players: { cohort: 281, returned: 35 }, visitors: { cohort: 957, returned: 189 } },
    d7: { players: { cohort: 250, returned: 20 }, visitors: { cohort: 663, returned: 25 } },
    d30: { players: { cohort: 216, returned: 6 }, visitors: { cohort: 216, returned: 7 } },
  },
  cohorts: [{ start: "2026-10-04", players: 64, weeks: [13] }],
  weekly: [
    { start: "2026-10-18", visitors: 257, players: 76, newPlayers: 50, daysPlayed: { 1: 52 } },
    { start: "2026-10-11", visitors: 443, players: 134, newPlayers: 93, daysPlayed: { 1: 95, 3: 9, 7: 8 } },
  ],
  sources: [{ source: "share", recent: 16, prior: 8, recentPlayers: 12, priorPlayers: 8 }],
  window: {
    visitors: 1028,
    firstVisits: 978,
    firstVisitPlayed: 253,
    players: 326,
    playerDays: 922,
    sharedDays: 161,
    afterShare: { shared: { cohort: 157, returned: 107 }, notShared: { cohort: 745, returned: 365 } },
  },
  scores: { tiers: [{ tier: "Legend", finished: 223, shared: 43, cohort: 218, returned: 139 }], buckets: { 9: 232 } },
};

afterEach(() => vi.unstubAllGlobals());

describe("AnalyticsV2Page", () => {
  it("asks for the reader's puzzle and draws the scorecard and every section", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: REPORT }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    expect(await screen.findByRole("heading", { name: "Scorecard" })).toBeTruthy();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("list=analytics-v2&today=2026-10-22");
    for (const name of ["Acquisition", "Retention", "Engagement", "Virality", "Momentum", "Why players come back"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    // D7: 20 of 250 is 8%, in the gap between going nowhere (under 5%) and promising (10%).
    const d7 = screen.getByRole("rowheader", { name: "D7 retention" }).closest("tr")!;
    expect(d7.textContent).toContain("8%");
    expect(d7.textContent).toContain("In between");
    // Activation: 253 of 978 first-time visitors banked a word, 26%, short of in between (30%).
    const activation = screen.getByRole("rowheader", { name: "Activation" }).closest("tr")!;
    expect(activation.textContent).toContain("26%");
    expect(activation.textContent).toContain("Going nowhere");
  });

  it("leaves a visitor rate blank when its window starts before visits were tracked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ report: REPORT }), { status: 200 })));
    render(<AnalyticsV2Page />);

    await screen.findByRole("heading", { name: "Retention" });
    expect(screen.getAllByText(/visitors not enough history/)).toHaveLength(3);
  });

  it("marks each scorecard number with its change since yesterday's report", async () => {
    // Yesterday D1 was 30 of 281 (11%), today 35 of 281 (12%); D7 is 8% both days.
    const yesterday = {
      ...REPORT,
      today: "2026-10-21",
      retention: { ...REPORT.retention, d1: { ...REPORT.retention.d1, players: { cohort: 281, returned: 30 } } },
    };
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ report: url.includes("today=2026-10-21") ? yesterday : REPORT }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    expect(await screen.findByLabelText("up 1 pt since yesterday")).toBeTruthy();
    const d7 = screen.getByRole("rowheader", { name: "D7 retention" }).closest("tr")!;
    expect(d7.querySelector('[aria-label="no change since yesterday"]')).toBeTruthy();
  });

  it("tries a failed read once more by itself before showing Try again", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++calls === 1 ? new Response("", { status: 504 }) : new Response(JSON.stringify({ report: REPORT }), { status: 200 }))),
    );
    render(<AnalyticsV2Page />);

    expect(await screen.findByRole("heading", { name: "Scorecard" })).toBeTruthy();
  });

  it("asks for yesterday's report only once today's has arrived", async () => {
    let answerToday: (r: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) =>
      url.includes("today=2026-10-22")
        ? new Promise<Response>((resolve) => (answerToday = resolve))
        : Promise.resolve(new Response(JSON.stringify({ report: REPORT }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answerToday(new Response(JSON.stringify({ report: REPORT }), { status: 200 }));
    await screen.findByRole("heading", { name: "Scorecard" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("today=2026-10-21");
  });

  it("still draws the scorecard, without changes, when yesterday's report fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("today=2026-10-21")
          ? new Response("", { status: 502 })
          : new Response(JSON.stringify({ report: REPORT }), { status: 200 }),
      ),
    );
    render(<AnalyticsV2Page />);

    await screen.findByRole("heading", { name: "Scorecard" });
    expect(screen.queryByLabelText(/since yesterday/)).toBeNull();
  });

  it("counts the window over the past 30 days, then today or two picked dates", async () => {
    const ranged = (url: string) => {
      const q = new URL(url, "http://x").searchParams;
      const from = q.get("from");
      const to = q.get("to");
      const today = from === "2026-10-22";
      const firstVisits = today ? 40 : 978;
      const firstVisitPlayed = today ? 30 : 253;
      // Nobody whose first word was today has a day 1 that is over.
      const retention = today ? {} : { ...REPORT.retention, d1: { ...REPORT.retention.d1, players: { cohort: 100, returned: 30 } } };
      return {
        ...REPORT,
        range:
          from && to
            ? {
                from,
                to,
                window: { ...REPORT.window, firstVisits, firstVisitPlayed, playerDays: today ? 50 : 900 },
                sources: [],
                scores: REPORT.scores,
                retention,
                prior: { playerDays: today ? 40 : 600, visitorDays: 0 },
              }
            : null,
      };
    };
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ report: ranged(url) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    await screen.findByRole("heading", { name: "Scorecard" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("&from=2026-09-22&to=2026-10-21");
    expect(screen.getByRole("button", { name: "Past 30 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("Past 30 days.").length).toBeGreaterThan(0);
    // The scorecard and retention follow the window: D1 is 30 of its 100, not 35 of the 28 days' 281.
    const d1 = screen.getByRole("rowheader", { name: "D1 retention" }).closest("tr")!;
    expect(d1.textContent).toContain("30%");
    expect(screen.getByText("D1", { selector: "dt" }).closest("div")!.textContent).toContain("of 100 players");
    // 900 player-days over 30 days, against 600 over the 30 before.
    const dau = screen.getAllByText("Daily active players", { selector: "dt" }).map((dt) => dt.closest("div")!.textContent);
    expect(dau).toContain("Daily active players30.0+50% on the 30 days before");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findAllByText("Today so far.")).not.toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("&from=2026-10-22&to=2026-10-22"))).toBe(true);
    const visitors = screen.getByText("First-time visitors", { selector: "dt" }).closest("div")!;
    expect(visitors.textContent).toContain("40");
    // The scorecard follows the window: 30 of today's 40, not 253 of 978.
    const activation = screen.getByRole("rowheader", { name: "Activation" }).closest("tr")!;
    expect(activation.textContent).toContain("75%");
    expect(screen.getByRole("rowheader", { name: "D1 retention" }).closest("tr")!.textContent).toContain("Too early");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("&from=2026-10-01&to=2026-10-22"))).toBe(true),
    );
    expect(await screen.findAllByText("2026-10-01 to 2026-10-22 (today so far).")).not.toHaveLength(0);
  });

  it("asks for yesterday's report over the window as it stood yesterday", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: REPORT }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => String((call as unknown[])[0]))).toContain(
        "/api/review?list=analytics-v2&today=2026-10-21&from=2026-09-21&to=2026-10-20",
      ),
    );
  });

  it("no longer asks for the experiments, which have their own page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: REPORT }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsV2Page />);

    await screen.findByRole("heading", { name: "Scorecard" });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).not.toContain("experiments");
    expect(screen.queryByRole("heading", { name: /Experiment/ })).toBeNull();
  });
});
