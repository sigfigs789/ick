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
  // Seven in ten guessers finish, a number apart from the others.
  completed: Math.round(guessed * 0.7),
  // A bit under half the guessers are back so far, a number apart from Shared's.
  returned: { cohort, returned, soFar, guessers: { cohort: 0, returned: 0, soFar: Math.round(guessed * 0.48) } },
  // Half of those back so far came the next day, and a quarter of the guessers.
  nextDay: { cohort: 0, returned: 0, soFar: Math.round(soFar / 2), guessers: { cohort: 0, returned: 0, soFar: Math.round(guessed * 0.24) } },
});

const groups = {
  all: metrics(100, 80, 50, 30, 40, 20),
  new: metrics(70, 50, 25, 10),
  returning: metrics(30, 30, 25, 20, 10, 8),
};

const dayGroups = (players: number) => ({
  all: { players, acted: players - 2, guessed: players - 4, shared: 0, completed: 0, returned: 1, nextDay: 1 },
  new: { players: 1, acted: 1, guessed: 1, shared: 0, completed: 0, returned: 0, nextDay: 0 },
  returning: { players: players - 1, acted: 0, guessed: 0, shared: 0, completed: 0, returned: 0, nextDay: 0 },
});

/** The shape `analytics_overview` returns. */
const REPORT = {
  today: "2026-10-16",
  firstDay: "2026-08-10",
  from: "2026-10-10",
  to: "2026-10-16",
  groups,
  modes: {
    all: { standard: metrics(85, 66, 35, 12, 20, 5), freeform: metrics(20, 17, 15, 4) },
    new: { standard: metrics(60, 42, 18, 5), freeform: metrics(12, 9, 8, 2) },
    returning: { standard: metrics(25, 24, 17, 7), freeform: metrics(8, 8, 7, 2) },
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
  botsFiltered: 84,
  daily: [
    { date: "2026-10-15", closed: false, groups: dayGroups(40) },
    { date: "2026-10-16", closed: false, groups: dayGroups(20) },
  ],
  weekly: [
    {
      start: "2026-10-11", end: "2026-10-17", groups: { all: 120, new: 80, returning: 40 },
      flow: { new: 80, kept: 30, resurrected: 10, resurrectedStayed: 3, lost: 70 },
      nextWeekOver: false,
      played: { oneDay: 30, twoToThree: 10, fourPlus: 10 },
    },
    {
      start: "2026-10-04", end: "2026-10-10", groups: { all: 100, new: 70, returning: 30 },
      flow: { new: 70, kept: 26, resurrected: 4, resurrectedStayed: 1, lost: 0 },
      nextWeekOver: true,
      played: { oneDay: 20, twoToThree: 5, fourPlus: 0 },
    },
    { start: "2026-09-27", end: "2026-10-03", groups: { all: 0, new: 0, returning: 0 } },
  ],
  cohorts: [
    { start: "2026-10-11", players: 80, guessers: 20, weeks: [] },
    {
      start: "2026-10-04", players: 70, guessers: 20,
      weeks: [{ players: 14, guessers: 8 }],
    },
    {
      start: "2026-09-27", players: 50, guessers: 10,
      weeks: [{ players: 10, guessers: 5 }, { players: 5, guessers: 4 }],
    },
  ],
  sources: [
    { source: "direct", players: 50, guessed: 15, returned: { cohort: 0, returned: 0, soFar: 5 } },
    { source: "share", players: 12, guessed: 9, returned: { cohort: 0, returned: 0, soFar: 6 } },
    { source: "news.ycombinator.com", players: 8, guessed: 1, returned: { cohort: 0, returned: 0, soFar: 0 } },
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
    bots: [
      {
        playerId: "6d3f9ffe-1d46-4ae7-bf8a-b9c68bebd2a4",
        visits: 3, puzzles: 2, avgScore: 36.5, avgWords: 4, avgRejected: 10, chatDays: 1, messages: 2,
        firstSeen: "2026-10-15T03:51:53+00:00", lastSeen: "2026-10-16T23:45:10+00:00",
      },
      {
        playerId: "8475da09-7190-486f-a93f-df8d826dac52",
        visits: 2, puzzles: 1, avgScore: 34.36, avgWords: 4, avgRejected: 17.5, chatDays: 0, messages: 0,
        firstSeen: "2026-10-14T03:51:53+00:00", lastSeen: "2026-10-15T20:00:00+00:00",
      },
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
    // Guessers back so far, of the guessers, shown before any seven days close.
    expect(everyone).toHaveTextContent("48% of guessers");
    expect(within(section("Key numbers")).getByRole("columnheader", { name: "Shared" })).toBeInTheDocument();
    // Finishers, of the players and of the guessers.
    expect(everyone).toHaveTextContent("35 35%70% of guessers");
    // Back the next day, of the players and of the guessers.
    expect(everyone).toHaveTextContent("15 15%24% of guessers");
    expect(within(section("Key numbers")).getByRole("columnheader", { name: "Completed" })).toBeInTheDocument();
    expect(within(section("Key numbers")).getByRole("columnheader", { name: "Back next day" })).toBeInTheDocument();
    // Every table of the key numbers has the new columns.
    for (const title of ["Play screen test", "Chat", "Idle hint test"]) {
      expect(within(section(title)).getByRole("columnheader", { name: "Completed" })).toBeInTheDocument();
      expect(within(section(title)).getByRole("columnheader", { name: "Back next day" })).toBeInTheDocument();
    }
    // The play-screen test pairs every grouping's rows by variant.
    expect(within(section("Play screen test")).getAllByRole("row", { name: /^Everyone/ })).toHaveLength(1);
    // Named v1 and v2, never "new", which reads as new players.
    expect(within(section("Play screen test")).getAllByRole("cell", { name: "v1" })).toHaveLength(3);
    expect(within(section("Play screen test")).getAllByRole("cell", { name: "v2" })).toHaveLength(3);
    const fresh = within(section("Key numbers")).getByRole("row", { name: /^New players/ });
    expect(fresh).toHaveTextContent("10 14%");
    expect(within(section("Key numbers")).getByRole("row", { name: /^Returning players/ })).toBeInTheDocument();
    expect(within(section("Key numbers")).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText(/Started in/)).not.toBeInTheDocument();
  });

  it("opens every section on a verdict and the marks for each", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    await screen.findByRole("heading", { name: "Key numbers" });
    // Half the window's players guessed: great, with the marks that make it so.
    const day = within(section("Day by day"));
    expect(day.getByText("Great")).toBeInTheDocument();
    expect(section("Day by day")).toHaveTextContent("50% of players guessed");
    expect(section("Day by day")).toHaveTextContent("Weak under 30% · Promising 30% to 50% · Great 50% or more");
    // Nobody's next day is over yet, so there is nothing to judge.
    expect(within(section("Key numbers")).getByText("Too early")).toBeInTheDocument();
    expect(section("Key numbers")).toHaveTextContent("back for the next puzzle · needs 20 players whose next day is over");
    // 12 new players from share links over 20 sharers.
    expect(section("Where new players come from")).toHaveTextContent("Great0.60 new players per sharer");
    for (const title of [
      "Growth", "Retention by arrival week", "Core players", "Resurrected players",
      "Puzzle type", "Play screen test", "Chat", "Idle hint test", "Muse AI",
    ]) {
      expect(section(title)).toHaveTextContent(/(Weak|Promising|Great|Too early)/);
    }
  });

  it("says how many automated visitors the numbers leave out", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Key numbers" });
    expect(within(section("Key numbers")).getByText(/84 automated visitors left out/)).toBeInTheDocument();
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

  it("tables weekly active players and WAU growth for the grouping picked", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Growth" });
    const growth = section("Growth");
    const week = (name: RegExp) => within(growth).getByRole("row", { name });

    expect(week(/^Oct 11 to Oct 17 so far/)).toHaveTextContent("120+20%");
    // Nothing the week before to grow from.
    expect(week(/^Oct 4 to Oct 10/)).toHaveTextContent("100–");
    await userEvent.click(within(growth).getByRole("button", { name: "Returning players" }));
    expect(week(/^Oct 11 to Oct 17/)).toHaveTextContent("40+33%");
    await userEvent.click(within(growth).getByRole("button", { name: "New players" }));
    expect(week(/^Oct 11 to Oct 17/)).toHaveTextContent("80+14%");
  });

  it("tables retention by arrival week, for everyone or the first week's guessers", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Retention by arrival week" });
    const cohorts = section("Retention by arrival week");
    const row = (name: RegExp) => within(cohorts).getByRole("row", { name });

    // As many week columns as the oldest row has weeks.
    expect(within(cohorts).getByRole("columnheader", { name: "Week 2" })).toBeInTheDocument();
    expect(within(cohorts).queryByRole("columnheader", { name: "Week 3" })).toBeNull();
    // The last week of each row is still counting up.
    expect(row(/^Sep 27/)).toHaveTextContent("Sep 275020%10% so far");
    expect(row(/^Oct 4/)).toHaveTextContent("Oct 47020% so far");
    expect(row(/^Oct 11/)).toHaveTextContent("Oct 1180");
    await userEvent.click(within(cohorts).getByRole("button", { name: "Guessed in their first week" }));
    expect(row(/^Sep 27/)).toHaveTextContent("Sep 271050%40% so far");
    expect(row(/^Oct 4/)).toHaveTextContent("Oct 42040% so far");
  });

  it("tables the core players: how many of each week's puzzles its players played", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Core players" });
    const core = section("Core players");

    expect(within(core).getByRole("row", { name: /^Oct 11 to Oct 17 so far/ })).toHaveTextContent(
      "5030 60%10 20%10 20%",
    );
    expect(within(core).getByRole("row", { name: /^Oct 4 to Oct 10/ })).toHaveTextContent("2520 80%5 20%0 0%");
  });

  it("tables each week's new, kept, resurrected and lost players", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Resurrected players" });
    const flow = section("Resurrected players");

    // Stayed is still counting up while the week after is.
    expect(within(flow).getByRole("row", { name: /^Oct 11 to Oct 17 so far/ })).toHaveTextContent(
      "12080 67%30 25%10 8%3 30% so far70+20",
    );
    expect(within(flow).getByRole("row", { name: /^Oct 4 to Oct 10/ })).toHaveTextContent(
      "10070 70%26 26%4 4%1 25%0+74",
    );
  });

  it("tables the window's new players by source, and the new players per sharer", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Where new players come from" });
    const sources = section("Where new players come from");

    // 12 from share links, over the 20 players who shared.
    expect(sources).toHaveTextContent("Share links brought 12 new players, from 20 players who shared: 0.60 per sharer.");
    expect(within(sources).getByRole("row", { name: /^Share link/ })).toHaveTextContent("12 17%9 75%6 50%");
    expect(within(sources).getByRole("row", { name: /^Direct/ })).toHaveTextContent("50 71%15 30%5 10%");
    // A site the page has no name for keeps its host.
    expect(within(sources).getByRole("rowheader", { name: "news.ycombinator.com" })).toBeInTheDocument();
  });

  it("tables the key numbers for both puzzle types, and the chat split, for every grouping", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Puzzle type" });

    const types = section("Puzzle type");
    expect(within(types).getAllByText("Standard")).toHaveLength(3);
    expect(within(types).getAllByText("Freeform")).toHaveLength(3);
    // Every key number has its column, as in Key numbers.
    for (const name of ["Players", "Did something", "Guessed", "Completed", "Shared", "Back next day", "Back within 7 days"]) {
      expect(within(types).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    const standard = within(types).getByRole("row", { name: /^Everyone Standard/ });
    expect(standard).toHaveTextContent("85");
    expect(standard).toHaveTextContent("66 78%");
    expect(standard).toHaveTextContent("35 41%");
    // Completed and shared over the players, and over the guessers.
    expect(standard).toHaveTextContent("25 29%71% of guessers");
    expect(standard).toHaveTextContent("14 16%40% of guessers");
    expect(standard).toHaveTextContent("12 14%49% of guessers");
    // The pair's second row is Everyone's Freeform, under the same label.
    const [freeform] = within(types).getAllByRole("row", { name: /^Freeform/ });
    expect(freeform).toHaveTextContent("20");
    expect(freeform).toHaveTextContent("15 75%");

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

  it("breaks Muse AI out by bot, under its leaderboard name", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Muse AI" });

    const muse = section("Muse AI");
    const first = within(muse).getByRole("row", { name: /^BoldCinder11/ });
    expect(first).toHaveTextContent(/Oct 16.*36\.50.*Yes, 2 sent$/);
    expect(within(muse).getByRole("row", { name: /^IdleOsprey15/ })).toHaveTextContent(/34\.36.*No$/);
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
