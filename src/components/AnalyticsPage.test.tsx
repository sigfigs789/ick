import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";

const split = (key: string, isNew: boolean, players: number, days: number, played: number, cohort: number, returned: number) => ({
  key,
  isNew,
  players,
  days,
  played,
  back: { cohort, returned },
});

/** The shape `analytics_report` returns, trimmed to a few days. */
const REPORT = {
  asOf: "2026-09-27",
  windowDays: 60,
  daily: [
    { date: "2026-09-26", newAppeared: 10, newPlayed: 6, returningAppeared: 40, returningPlayed: 35, newBack: { cohort: 10, returned: 3 } },
    { date: "2026-09-27", newAppeared: 8, newPlayed: 5, returningAppeared: 42, returningPlayed: 36, newBack: { cohort: 0, returned: 0 } },
  ],
  modes: [
    split("standard", true, 12, 12, 9, 10, 4),
    split("standard", false, 30, 70, 60, 50, 40),
    split("freeform", true, 6, 6, 2, 5, 1),
  ],
  sources: [split("direct", true, 9, 9, 5, 8, 2), split("untracked", false, 4, 9, 9, 0, 0)],
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

function row(name: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(`^${name}`) });
}

describe("AnalyticsPage", () => {
  it("compares the modes, new and returning, by played and back within a week", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    await screen.findByRole("heading", { name: "Standard vs Freeform" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/review?list=analytics&days=60&key=sesame");
    const standardNew = row("Standard · new");
    expect(within(standardNew).getByText("12")).toBeInTheDocument();
    expect(within(standardNew).getByText("75%")).toBeInTheDocument();
    expect(within(standardNew).getByText("40%")).toBeInTheDocument();
    expect(within(row("Freeform · new")).getByText("33%")).toBeInTheDocument();
    expect(within(row("Standard · returning")).getByText("86%")).toBeInTheDocument();
  });

  it("names the sources, and leaves a rate it cannot know yet as a dash", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    await screen.findByRole("heading", { name: "By source" });
    expect(within(row("unattributed · new")).getByText("56%")).toBeInTheDocument();
    expect(within(row("untracked \\(app, Reddit\\) · returning")).getByText("—")).toBeInTheDocument();
  });

  it("reads the window picked", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    await user.click(await screen.findByRole("button", { name: "7 days" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=7&"))).toBe(true),
    );
  });

  it("says when nobody has played", async () => {
    stubFetch({ asOf: null, windowDays: 60, daily: [], modes: [], sources: [] });
    render(<AnalyticsPage />);

    expect(await screen.findByText("Nobody has played yet.")).toBeInTheDocument();
  });
});
