import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";
import { moveRange, windowDates } from "./analyticsFormat";

/** The viewer's calendar date, which the windows are counted back from. */
const clock = vi.hoisted(() => ({ today: "2026-10-16" }));
vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => clock.today,
}));

const metrics = (players: number, acted: number, guessed: number, soFar: number, cohort = 0, returned = 0) => ({
  players,
  acted,
  guessed,
  // Two in five guessers share, so the column has its own number to show.
  shared: Math.round(guessed * 0.4),
  returned: { cohort, returned, soFar },
});

const groups = {
  all: metrics(100, 80, 50, 30, 40, 20),
  new: metrics(70, 50, 25, 10),
  returning: metrics(30, 30, 25, 20, 10, 8),
  standard: metrics(60, 50, 35, 20),
  freeform: metrics(40, 30, 15, 10),
};

const dayGroups = (players: number) => ({
  all: { players, acted: players - 2, guessed: players - 4, shared: 0, returned: 1 },
  new: { players: 1, acted: 1, guessed: 1, shared: 0, returned: 0 },
  returning: { players: players - 1, acted: 0, guessed: 0, shared: 0, returned: 0 },
  standard: { players, acted: 0, guessed: 0, shared: 0, returned: 0 },
  freeform: { players: 0, acted: 0, guessed: 0, shared: 0, returned: 0 },
});

/** The shape `analytics_overview` returns. */
const REPORT = {
  today: "2026-10-16",
  firstDay: "2026-08-10",
  from: "2026-10-10",
  to: "2026-10-16",
  groups,
  modes: {
    standard: { guessed: 35, returned: { cohort: 20, returned: 5, soFar: 12 } },
    freeform: { guessed: 15, returned: { cohort: 0, returned: 0, soFar: 4 } },
  },
  chat: {
    all: { opened: metrics(10, 10, 8, 6, 5, 4), notOpened: metrics(90, 70, 42, 24, 35, 16) },
    new: { opened: metrics(4, 4, 2, 1), notOpened: metrics(66, 46, 23, 9) },
    returning: { opened: metrics(6, 6, 6, 5), notOpened: metrics(24, 24, 19, 15) },
    standard: { opened: metrics(8, 8, 7, 5), notOpened: metrics(52, 42, 28, 15) },
    freeform: { opened: metrics(2, 2, 1, 1), notOpened: metrics(38, 28, 14, 9) },
  },
  chatSince: "2026-09-29",
  daily: [
    { date: "2026-10-15", closed: false, groups: dayGroups(40) },
    { date: "2026-10-16", closed: false, groups: dayGroups(20) },
  ],
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

function lastUrl(fetchMock: ReturnType<typeof stubFetch>): string {
  return String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0]);
}

function section(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
}

beforeEach(() => {
  window.history.pushState(null, "", "/analytics?key=sesame");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clock.today = "2026-10-16";
});

describe("AnalyticsPage", () => {
  it("opens on the last week, and tables the key numbers for each grouping", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    await screen.findByRole("heading", { name: "Key numbers" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/review?list=analytics&from=2026-10-10&to=2026-10-16&today=2026-10-16&key=sesame",
    );
    const everyone = within(section("Key numbers")).getByRole("row", { name: /^Everyone/ });
    expect(everyone).toHaveTextContent("100");
    expect(everyone).toHaveTextContent("80 80%");
    expect(everyone).toHaveTextContent("50 50%");
    // Every return seen so far, as a share of the players.
    expect(everyone).toHaveTextContent("30 30%");
    // Sharers, of the players and -- the only ones who can -- of the guessers.
    expect(everyone).toHaveTextContent("20 20%");
    expect(everyone).toHaveTextContent("40% of guessers");
    expect(within(section("Key numbers")).getByRole("columnheader", { name: "Shared" })).toBeInTheDocument();
    // The play-screen test pairs every grouping's rows by variant.
    expect(within(section("Play screen test")).getAllByRole("row", { name: /^Everyone/ })).toHaveLength(1);
    const fresh = within(section("Key numbers")).getByRole("row", { name: /^New players/ });
    expect(fresh).toHaveTextContent("10 14%");
    for (const name of ["Returning players", "Started in Standard", "Started in Freeform"]) {
      expect(within(section("Key numbers")).getByRole("row", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it("asks for one puzzle a few days back, or all time", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Key numbers" });

    await userEvent.click(screen.getByRole("button", { name: "3 days" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toContain("from=2026-10-13&to=2026-10-13&today=2026-10-16"));
    expect(await screen.findByRole("button", { name: "3 days" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toContain("list=analytics&to=2026-10-16&today=2026-10-16"));
    expect(lastUrl(fetchMock)).not.toContain("from=");
  });

  it("reads a picked range off the date boxes", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Key numbers" });

    fireEvent.change(screen.getAllByDisplayValue("2026-10-10")[0], { target: { value: "2026-10-01" } });
    await waitFor(() => expect(lastUrl(fetchMock)).toContain("from=2026-10-01&to=2026-10-16"));
  });

  it("draws the chart for the grouping picked above it", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Day by day" });
    const chart = section("Day by day");
    const players = () => within(chart).getByRole("tab", { name: /^Players/ });

    expect(players()).toHaveTextContent("20");
    await userEvent.click(within(chart).getByRole("button", { name: "Returning players" }));
    expect(players()).toHaveTextContent("19");
  });

  it("tables both puzzle types, and the chat split for every grouping", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Puzzle type" });

    const standard = within(section("Puzzle type")).getByRole("row", { name: /^Standard/ });
    expect(standard).toHaveTextContent("35");
    expect(standard).toHaveTextContent("12 34%");
    expect(within(section("Puzzle type")).getByRole("row", { name: /^Freeform/ })).toHaveTextContent(
      "4 27%",
    );

    const chat = section("Chat");
    expect(within(chat).getAllByText("Opened chat")).toHaveLength(5);
    expect(within(chat).getAllByText("Didn't")).toHaveLength(5);
    expect(within(chat).getByText(/since Sep 29/)).toBeInTheDocument();
  });

  it("says when the report could not load", async () => {
    stubFetch(null);
    render(<AnalyticsPage />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("windowDates", () => {
  it("counts each window back from today, both ends included", () => {
    expect(windowDates({ kind: "day", ago: 0 }, "2026-10-16")).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(windowDates({ kind: "day", ago: 7 }, "2026-10-16")).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(windowDates({ kind: "span", days: 7 }, "2026-10-16")).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    expect(windowDates({ kind: "span", days: 30 }, "2026-10-16")).toEqual({ from: "2026-09-17", to: "2026-10-16" });
    expect(windowDates({ kind: "span", days: null }, "2026-10-16")).toEqual({ from: null, to: "2026-10-16" });
  });
});

describe("moveRange", () => {
  it("drags the other end along when one would cross it", () => {
    const range = { from: "2026-10-05", to: "2026-10-10" };
    expect(moveRange(range, "from", "2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(moveRange(range, "to", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(moveRange(range, "from", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-10-10" });
  });
});
