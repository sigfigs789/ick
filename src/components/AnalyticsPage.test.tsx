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
};

const dayGroups = (players: number) => ({
  all: { players, acted: players - 2, guessed: players - 4, shared: 0, returned: 1 },
  new: { players: 1, acted: 1, guessed: 1, shared: 0, returned: 0 },
  returning: { players: players - 1, acted: 0, guessed: 0, shared: 0, returned: 0 },
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
  },
  chatSince: "2026-09-29",
  idleHint: {
    all: { control: metrics(20, 18, 8, 5), treatment: metrics(22, 21, 12, 9) },
    new: { control: metrics(12, 10, 4, 2), treatment: metrics(13, 12, 7, 5) },
    returning: { control: metrics(8, 8, 4, 3), treatment: metrics(9, 9, 5, 4) },
  },
  idleHintSince: "2026-10-18",
  daily: [
    { date: "2026-10-15", closed: false, groups: dayGroups(40) },
    { date: "2026-10-16", closed: false, groups: dayGroups(20) },
  ],
  muse: {
    visits: 5,
    browsers: 1,
    puzzles: 3,
    avgScore: 35.789,
    avgWords: 4,
    avgRejected: 12.5,
    chatDays: 1,
    messages: 2,
    firstSeen: "2026-10-14T03:51:53+00:00",
    lastSeen: "2026-10-16T23:45:10+00:00",
    days: [
      { date: "2026-10-16", visits: 3, puzzles: 2, avgScore: 36.5, avgWords: 4, avgRejected: 10, chatOpened: true, messages: 2 },
      { date: "2026-10-15", visits: 2, puzzles: 1, avgScore: 34.36, avgWords: 4, avgRejected: 17.5, chatOpened: false, messages: 0 },
    ],
  },
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
    expect(within(section("Key numbers")).getByRole("row", { name: /^Returning players/ })).toBeInTheDocument();
    expect(within(section("Key numbers")).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText(/Started in/)).not.toBeInTheDocument();
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
    expect(within(chat).getAllByText("Opened chat")).toHaveLength(3);
    expect(within(chat).getAllByText("Didn't")).toHaveLength(3);
    expect(within(chat).getByText(/since Sep 29/)).toBeInTheDocument();
  });

  it("tables the key numbers for each idle hint arm, by grouping", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Idle hint test" });

    // One report: the idle hint numbers come with the rest.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const idle = section("Idle hint test");
    expect(within(idle).getByRole("columnheader", { name: "Arm" })).toBeInTheDocument();
    expect(within(idle).getAllByText("No hint")).toHaveLength(3);
    expect(within(idle).getAllByText("Hint")).toHaveLength(3);
    const everyone = within(idle).getByRole("row", { name: /^Everyone/ });
    expect(everyone).toHaveTextContent("20");
    expect(everyone).toHaveTextContent("8 40%");
    expect(within(idle).getByText(/since Oct 18/)).toBeInTheDocument();
  });

  it("tables Muse AI apart from the players, in all and by puzzle", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Muse AI" });

    const muse = section("Muse AI");
    expect(within(muse).getByText(/left out of every number above, last seen Oct 16/)).toBeInTheDocument();
    const all = within(muse).getByRole("row", { name: /^All/ });
    expect(all).toHaveTextContent("35.79");
    expect(all).toHaveTextContent("12.50");
    expect(all).toHaveTextContent("Opened on 1, 2 sent");
    expect(within(muse).getByRole("row", { name: /^Fri Oct 16/ })).toHaveTextContent("Yes, 2 sent");
    expect(within(muse).getByRole("row", { name: /^Thu Oct 15/ })).toHaveTextContent(/34\.36.*No$/);
  });

  it("says Muse AI has not played when the report has no sign of it", async () => {
    stubFetch({ ...REPORT, muse: undefined });
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Muse AI" });

    const muse = section("Muse AI");
    expect(within(muse).getByText(/not seen yet/)).toBeInTheDocument();
    expect(within(muse).getAllByRole("row")).toHaveLength(2);
    expect(within(muse).getByRole("row", { name: /^All/ })).toHaveTextContent("–");
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
