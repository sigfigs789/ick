import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";
import { moveRange } from "./analyticsFormat";

/** The viewer's calendar date, which the page's "today" tiles are read off. */
const clock = vi.hoisted(() => ({ today: "2026-09-27" }));
vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => clock.today,
}));

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
  visitorsSince: "2026-09-20",
  totals: {
    players: 200,
    plays: 900,
    today: 40,
    last7: 120,
    last30: 180,
    avgDaysPerPlayer: 4.5,
    firstDay: "2026-08-25",
    lookersToday: 7,
    lookersLast7: 19,
    lookersNeverPlayed: 11,
    lookersSince: "2026-09-26",
  },
  window: {
    puzzles: 2,
    players: 80,
    newPlayers: 8,
    avgDaysPerPlayer: 1.13,
    avgDailyPlayers: 45,
    lookers: 7,
    dauMau: 0.3125,
    from: "2026-09-26",
    to: "2026-09-27",
  },
  daily: [
    { date: "2026-09-26", players: 50, newPlayers: 5, standard: 0, freeform: 50, lookers: 0 },
    { date: "2026-09-27", players: 40, newPlayers: 3, standard: 30, freeform: 10, lookers: 7 },
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
    visitors: 250,
    visitsWithId: 900,
    firstVisits: 300,
    engaged: 700,
    engagedByLooking: 60,
    completed: 500,
    won: 250,
    shared: 100,
    sharedOnX: 10,
    toFreeform: 12,
    toStandard: 5,
  },
  sources: [
    { source: "direct", visits: 600, visitors: 150, firstVisits: 100, engaged: 400 },
    { source: "reddit", visits: 100, visitors: 90, firstVisits: 80, engaged: 90 },
  ],
  sessions: {
    sessions: 800,
    medianVisibleMs: 185000,
    medianPlayingMs: 240000,
    medianFirstGuessMs: 21000,
    guessedShare: 0.8,
    lookedOnly: 40,
    lookedOnlyShare: 0.1,
  },
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, visits: hour })),
};

/** The shape `copy_report` returns, which api/review.ts sets on the report. */
const COPIES = {
  totals: {
    taps: 14,
    copies: 10,
    copiers: 4,
    toFreeform: 7,
    toStandard: 3,
    refused: 2,
    full: 1,
    lookupFailed: 1,
    players: 40,
    avgCopiesPerCopier: 2.5,
    avgScoreGain: 0.85,
    higherThere: 6,
    since: "2026-10-01",
  },
  daily: [{ date: "2026-10-01", copies: 10, copiers: 4, players: 40 }],
  retention: {
    nextDay: { copied: { cohort: 8, returned: 6 }, other: { cohort: 100, returned: 40 } },
    week: { copied: { cohort: 4, returned: 3 }, other: { cohort: 30, returned: 12 } },
  },
};

/** The shape `retention_report` returns, which api/review.ts sets on the report. */
const RETURNERS = {
  from: "2026-08-29",
  to: "2026-09-27",
  trackedSince: "2026-09-01",
  firstPuzzle: {
    totals: { players: 50, tracked: 40, nextDay: { cohort: 48, returned: 24 }, week: { cohort: 40, returned: 28 } },
    groups: [
      { split: "outcome", group: "Won", players: 20, nextDay: { cohort: 20, returned: 14 }, week: { cohort: 18, returned: 15 } },
      { split: "outcome", group: "Left before finishing", players: 8, nextDay: { cohort: 8, returned: 2 }, week: { cohort: 6, returned: 2 } },
      { split: "source", group: "direct", players: 12, nextDay: { cohort: 12, returned: 6 }, week: { cohort: 10, returned: 6 } },
      // A split the page does not know is not drawn.
      { split: "mystery", group: "Odd", players: 9, nextDay: { cohort: 9, returned: 9 }, week: { cohort: 9, returned: 9 } },
    ],
  },
  puzzles: [
    {
      date: "2026-09-27", players: 30, nextDay: { cohort: 0, returned: 0 }, newPlayers: 3, newNextDay: null,
      avgWords: 3.2, avgTop: 7.5, tracked: 25, completed: 20, won: 10, refusalsPerPlayer: 0.4, foldsPerPlayer: 0.2,
    },
    {
      date: "2026-09-26", players: 40, nextDay: { cohort: 40, returned: 10 }, newPlayers: 6,
      newNextDay: { cohort: 6, returned: 1 }, avgWords: 3, avgTop: 7, tracked: 30, completed: 25, won: 5,
      refusalsPerPlayer: 1.25, foldsPerPlayer: 0.5,
    },
  ],
  lastDay: {
    players: 12,
    last: {
      days: 12, avgWords: 2.5, avgTop: 6.1, tracked: 10, finishShare: 0.6, winShare: 0.25, refusalsPerDay: 1.5,
      foldsPerDay: 0.6, revealedShare: 0.1, lookedShare: 0.2, sharedShare: 0, afterGapShare: 0.5, freeformShare: 0.25,
    },
    usual: {
      days: 60, avgWords: 3.1, avgTop: 7.4, tracked: 50, finishShare: 0.9, winShare: 0.55, refusalsPerDay: 0.6,
      foldsPerDay: 0.3, revealedShare: 0.05, lookedShare: 0.4, sharedShare: 0.1, afterGapShare: 0.2, freeformShare: 0.25,
    },
  },
  versions: [
    { version: 33, players: 30, firstDay: "2026-09-20", lastDay: "2026-09-27", nextDay: { cohort: 80, returned: 30 } },
  ],
};

/** The shape `chat_report` returns, which api/review.ts sets on the report. */
const CHAT = {
  totals: {
    opens: 60,
    viewers: 20,
    senders: 5,
    messages: 40,
    blocked: 4,
    blockedProfane: 3,
    blockedRateLimited: 1,
    viewersToday: 6,
    sendersToday: 2,
    messagesToday: 9,
    viewersLast7: 15,
    sendersLast7: 4,
    returningViewers: 8,
    senderShare: 0.25,
    avgOpensPerViewer: 3,
    avgMessageLength: 22.4,
    since: "2026-09-26",
  },
  time: {
    views: 55,
    medianViewMs: 90000,
    avgViewMs: 136000,
    totalMs: 7500000,
    medianSendingViewMs: 240000,
    sendingViewShare: 0.2,
  },
  daily: [
    { date: "2026-09-26", viewers: 14, senders: 3, opens: 30, messages: 31, totalMs: 3000000 },
    { date: "2026-09-27", viewers: 6, senders: 2, opens: 8, messages: 9, totalMs: 720000 },
  ],
  room: { messages: 30, hidden: 1, senders: 5, last24h: 4, firstAt: "2026-09-26T01:00:00Z", lastAt: "2026-09-27T20:00:00Z" },
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
  clock.today = "2026-09-27";
});

describe("AnalyticsPage", () => {
  it("leads with the headline numbers and retention", async () => {
    const fetchMock = stubFetch();
    render(<AnalyticsPage />);

    const players = (await screen.findByText("Players", { selector: ".analytics__tile-label" })).closest(".analytics__tile")!;
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/review?list=analytics&days=60&key=sesame");
    // Every headline tile counts over the window, not a fixed span of puzzles.
    expect(within(players as HTMLElement).getByText("80")).toBeInTheDocument();
    expect(within(players as HTMLElement).getByText("over the last 2 puzzles")).toBeInTheDocument();
    const fresh = screen.getByText("New players", { selector: ".analytics__tile-label" }).closest(".analytics__tile")!;
    expect(within(fresh as HTMLElement).getByText("8")).toBeInTheDocument();
    expect(within(fresh as HTMLElement).getByText("10% of the players")).toBeInTheDocument();
    // DAU/MAU as the report computed it, not the window's own players.
    const sticky = screen.getByText("Stickiness").closest(".analytics__tile")!;
    expect(within(sticky as HTMLElement).getByText("31%")).toBeInTheDocument();
    expect(within(sticky as HTMLElement).getByText("DAU ÷ 30-day players, averaged")).toBeInTheDocument();
    const perPlayer = screen.getByText("Days per player").closest(".analytics__tile")!;
    expect(within(perPlayer as HTMLElement).getByText("1.1")).toBeInTheDocument();
    expect(screen.queryByText("Last 7 puzzles")).toBeNull();
    expect(screen.queryByText("All time")).toBeNull();
    // Next-day retention: 72 of 180.
    const nextDay = screen.getByText("72 of 180").closest(".analytics__tile")!;
    expect(within(nextDay as HTMLElement).getByText("40%")).toBeInTheDocument();
    // Day 30 has nobody old enough yet, and says so rather than printing 0%.
    expect(screen.getByText("not enough days yet")).toBeInTheDocument();
  });

  it("calls visits with no source unattributed, not direct", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    expect(await screen.findByRole("rowheader", { name: "unattributed" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "direct" })).toBeNull();
  });

  it("counts today's chat by the viewer's calendar date, not the latest puzzle played", async () => {
    // Behind the latest puzzle: somebody further east is already on the 27th.
    clock.today = "2026-09-26";
    stubFetch({ ...REPORT, chat: CHAT });
    render(<AnalyticsPage />);
    const chat = (await screen.findByText("Chat viewers today")).closest(".analytics__tile")!;
    expect(within(chat as HTMLElement).getByText("14")).toBeInTheDocument();
    expect(within(chat as HTMLElement).getByText("3 sent, 31 messages")).toBeInTheDocument();
  });

  it("counts distinct visitors and how often each opens the game", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    const visitors = (await screen.findByText("Visitors", { selector: ".analytics__tile-label" })).closest(".analytics__tile")!;
    expect(within(visitors as HTMLElement).getByText("250")).toBeInTheDocument();
    expect(within(visitors as HTMLElement).getByText("distinct, recorded from 2026-09-20")).toBeInTheDocument();
    // 900 visits that carry an id, over 250 visitors -- not the 1,000 visits in all.
    const perVisitor = screen.getByText("Visits per visitor").closest(".analytics__tile")!;
    expect(within(perVisitor as HTMLElement).getByText("3.6")).toBeInTheDocument();
    expect(within(perVisitor as HTMLElement).getByText("average, over 900 opens")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Visitors" })).toBeInTheDocument();
  });

  it("says visitors have not been recorded rather than printing zero", async () => {
    stubFetch({ ...REPORT, visitorsSince: null });
    render(<AnalyticsPage />);

    const visitors = (await screen.findByText("Visitors", { selector: ".analytics__tile-label" })).closest(".analytics__tile")!;
    expect(within(visitors as HTMLElement).getByText("not recorded yet")).toBeInTheDocument();
    expect(screen.queryByText("Visits per visitor")).toBeNull();
  });

  it("labels the hours on a 12-hour clock", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    expect(await screen.findByLabelText("12am–1am MT: 0 visits")).toBeInTheDocument();
    expect(screen.getByLabelText("11pm–12am MT: 23 visits")).toBeInTheDocument();
    expect(screen.getByText("3pm")).toBeInTheDocument();
  });

  it("counts the players who looked without playing", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    const tile = (await screen.findByText("Looked, didn't play")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("7")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("11 have never played")).toBeInTheDocument();
    expect(screen.getByLabelText("2026-09-27 (Sun): 40 players (30 Standard, 10 Freeform), 3 new, 7 only looked")).toBeInTheDocument();
    expect(screen.getByText(/60 engaged visits began on the/)).toBeInTheDocument();
    const sessions = screen.getByText("Only looked", { selector: ".analytics__tile-label" }).closest(".analytics__tile")!;
    expect(within(sessions as HTMLElement).getByText("10%")).toBeInTheDocument();
  });

  it("names a one-mode day's mode rather than a zero for the other", async () => {
    stubFetch();
    render(<AnalyticsPage />);
    expect(await screen.findByLabelText("2026-09-26 (Sat): 50 players, all Freeform, 5 new")).toBeInTheDocument();
  });

  it("says a look has not been recorded rather than printing zero", async () => {
    stubFetch({ ...REPORT, totals: { ...REPORT.totals, lookersSince: null } });
    render(<AnalyticsPage />);

    const tile = (await screen.findByText("Looked, didn't play")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("not recorded yet")).toBeInTheDocument();
  });

  it("shows how often words are copied across, and the copiers' retention", async () => {
    stubFetch({ ...REPORT, copies: COPIES });
    render(<AnalyticsPage />);

    const copied = (await screen.findByText("Words copied")).closest(".analytics__tile")!;
    expect(within(copied as HTMLElement).getByText("10")).toBeInTheDocument();
    expect(within(copied as HTMLElement).getByText("7 to Freeform, 3 to Standard")).toBeInTheDocument();
    expect(screen.getByText("10% of 40 players")).toBeInTheDocument();
    expect(screen.getByText("+0.85")).toBeInTheDocument();
    expect(screen.getByText("2 refused, 1 game finished, 1 lookup failed")).toBeInTheDocument();
    const nextDay = screen.getByText("Next day, per player-day").closest("tr")!;
    expect(nextDay).toHaveTextContent("75%");
    expect(nextDay).toHaveTextContent("40%");
    expect(screen.getByLabelText("2026-10-01 (Thu): 4 of 40 players copied 10 words")).toBeInTheDocument();
  });

  it("leaves the copies section out when its numbers failed", async () => {
    stubFetch({ ...REPORT, copies: null });
    render(<AnalyticsPage />);
    await screen.findByText("Looked, didn't play");
    expect(screen.queryByText("Standard vs Freeform: words copied across")).not.toBeInTheDocument();
  });

  it("splits who comes back by their first puzzle, each puzzle, their last day and the build", async () => {
    stubFetch({ ...REPORT, returners: RETURNERS });
    render(<AnalyticsPage />);

    const first = within(
      (await screen.findByText("Who comes back: their first puzzle")).closest("section")!,
    );
    expect(first.getByText("10 untracked (iOS app, Reddit, or older)")).toBeInTheDocument();
    const won = first.getByRole("rowheader", { name: "Won" }).closest("tr")!;
    expect(won).toHaveTextContent("70%");
    // 70% against everybody's 50%.
    expect(within(won).getByText("+20 pts")).toHaveClass("analytics__delta--up");
    expect(within(first.getByText("Left before finishing").closest("tr")!).getByText("−25 pts")).toHaveClass(
      "analytics__delta--down",
    );
    expect(screen.getByText("How the first puzzle ended")).toBeInTheDocument();
    expect(first.getByRole("rowheader", { name: "unattributed" }).closest("tr")).toHaveTextContent("50%");
    expect(screen.queryByText("Odd")).not.toBeInTheDocument();

    const live = screen.getByText("09-27 Sun").closest("tr")!;
    expect(live).toHaveTextContent("still live");
    const yesterday = screen.getByText("09-26 Sat").closest("tr")!;
    expect(yesterday).toHaveTextContent("25%");
    expect(yesterday).toHaveTextContent("17%");
    expect(yesterday).toHaveTextContent("1.25");

    const refused = screen.getByRole("rowheader", { name: "Guesses refused" }).closest("tr")!;
    expect(refused).toHaveTextContent("1.50");
    expect(refused).toHaveTextContent("0.60");
    expect(screen.getByText("Came back after missing a puzzle").closest("tr")).toHaveTextContent("50%");

    expect(screen.getByText("2026-09-20 to 2026-09-27").closest("tr")).toHaveTextContent("38%");
  });

  it("says who stopped is too few to show rather than printing a table", async () => {
    stubFetch({ ...REPORT, returners: { ...RETURNERS, lastDay: { players: 3, last: null, usual: null } } });
    render(<AnalyticsPage />);
    expect(await screen.findByText("3 stopped, fewer than five: not shown.")).toBeInTheDocument();
  });

  it("leaves the comeback sections out when their numbers failed", async () => {
    stubFetch({ ...REPORT, returners: null });
    render(<AnalyticsPage />);
    await screen.findByText("Looked, didn't play");
    expect(screen.queryByText("Who comes back: their first puzzle")).not.toBeInTheDocument();
  });

  it("shows who opens the chat, who talks and how long they stay", async () => {
    stubFetch({ ...REPORT, chat: CHAT });
    render(<AnalyticsPage />);

    const today = (await screen.findByText("Chat viewers today")).closest(".analytics__tile")!;
    expect(within(today as HTMLElement).getByText("6")).toBeInTheDocument();
    expect(within(today as HTMLElement).getByText("2 sent, 9 messages")).toBeInTheDocument();
    const senders = screen.getByText("Senders").closest(".analytics__tile")!;
    expect(within(senders as HTMLElement).getByText("25% of viewers")).toBeInTheDocument();
    const median = screen.getByText("Median time open").closest(".analytics__tile")!;
    expect(within(median as HTMLElement).getByText("1m 30s")).toBeInTheDocument();
    const total = screen.getByText("Total time in chat").closest(".analytics__tile")!;
    expect(within(total as HTMLElement).getByText("2h 05m")).toBeInTheDocument();
    expect(screen.getByText("3 profanity, 1 too fast")).toBeInTheDocument();
    expect(
      screen.getByLabelText("2026-09-27 (Sun): 6 viewers, 2 sent 9 messages, 12m 00s in chat"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("30 messages in the room all time, from 5 players, 4 in the last 24 hours, 1 hidden."),
    ).toBeInTheDocument();
  });

  it("says chat has not been recorded yet, and leaves the section out when it failed", async () => {
    stubFetch({ ...REPORT, chat: { ...CHAT, totals: { ...CHAT.totals, since: null }, daily: [] } });
    const { unmount } = render(<AnalyticsPage />);
    expect(await screen.findByText("No chat opens recorded yet.")).toBeInTheDocument();
    unmount();

    stubFetch({ ...REPORT, chat: null });
    render(<AnalyticsPage />);
    await screen.findByText("New players", { selector: ".analytics__tile-label" });
    expect(screen.queryByText("Chat viewers today")).not.toBeInTheDocument();
    expect(screen.queryByText("No chat opens recorded yet.")).not.toBeInTheDocument();
  });

  it("tables new players by the mode they started in", async () => {
    const arm = (reason: string, mode: string, extra: object) => ({
      reason,
      mode,
      players: 40,
      played: 30,
      playedDays: 60,
      avgDaysPlayed: 1.5,
      d1: { cohort: 20, returned: 5 },
      d7: { cohort: 0, returned: 0 },
      week1: { cohort: 0, returned: 0 },
      sharers: 4,
      shares: 10,
      switched: 2,
      ...extra,
    });
    stubFetch({
      ...REPORT,
      onboarding: {
        since: "2026-09-30",
        arms: [
          arm("split", "standard", {}),
          arm("split", "freeform", { d1: { cohort: 20, returned: 9 }, sharers: 10 }),
          arm("shared", "freeform", { players: 8, sharers: 2, shares: 4 }),
        ],
        arrivals: [{ link: "share", mode: "freeform", arrivals: 12 }],
      },
    });
    render(<AnalyticsPage />);

    const freeform = (await screen.findByRole("rowheader", { name: "Random split · Freeform" })).closest("tr")!;
    expect(within(freeform).getByText("45%")).toBeInTheDocument();
    expect(within(freeform).getByText("25%")).toBeInTheDocument();
    const standard = screen.getByRole("rowheader", { name: "Random split · Standard" }).closest("tr")!;
    expect(within(standard).getByText("0.25")).toBeInTheDocument();
    const shared = screen.getByRole("rowheader", { name: "Friend's link · Freeform" }).closest("tr")!;
    expect(within(shared).getByText("0.50")).toBeInTheDocument();
    expect(screen.getByText("Share-link taps in the window: 12 on Freeform links copied with the Share button and pasted elsewhere.")).toBeInTheDocument();
  });

  it("leaves the starting-mode section out when it failed", async () => {
    stubFetch({ ...REPORT, onboarding: null });
    render(<AnalyticsPage />);
    await screen.findByText("New players", { selector: ".analytics__tile-label" });
    expect(screen.queryByText("Standard vs Freeform: new players by starting mode")).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=7&"))).toBe(true),
    );
  });

  it("reads today's puzzle alone in the today window", async () => {
    const fetchMock = stubFetch({
      ...REPORT,
      windowDays: 1,
      visitsSince: "2026-09-27",
      window: {
        ...REPORT.window,
        puzzles: 1,
        players: 40,
        newPlayers: 3,
        avgDaysPerPlayer: 1,
        avgDailyPlayers: 40,
        dauMau: 0.25,
        from: "2026-09-27",
        to: "2026-09-27",
      },
      daily: [REPORT.daily[1]],
    });
    render(<AnalyticsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("days=1&date=2026-09-27&")),
      ).toBe(true),
    );
    expect(screen.getByText(/^Events on today's puzzle \(stamped from 2026-09-27\)/)).toBeInTheDocument();
    expect(screen.getByText(/^Today's puzzle, split by the rules/)).toBeInTheDocument();
    expect(screen.getByText(/Pick a longer window to hop between days/)).toBeInTheDocument();
    const players = screen.getByText("Players", { selector: ".analytics__tile-label" }).closest(".analytics__tile")!;
    expect(within(players as HTMLElement).getByText("puzzle 2026-09-27")).toBeInTheDocument();
    // One puzzle has no spread of days to measure, so this says so rather than
    // 1.0; DAU/MAU still has its 30-day denominator.
    expect(screen.getAllByText("needs more than one puzzle")).toHaveLength(1);
    const sticky = screen.getByText("Stickiness").closest(".analytics__tile")!;
    expect(within(sticky as HTMLElement).getByText("25%")).toBeInTheDocument();
  });

  it("reads a picked calendar range, and a preset clears it", async () => {
    const ranged = {
      ...REPORT,
      windowDays: 5,
      window: { ...REPORT.window, puzzles: 5, from: "2026-09-16", to: "2026-09-20" },
    };
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) =>
      new Response(JSON.stringify({ report: String(url).includes("date=2026-09-20") ? ranged : REPORT }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AnalyticsPage />);

    const from = await screen.findByLabelText("From");
    // The inputs start on the preset's own days.
    expect(from).toHaveValue("2026-09-26");
    expect(screen.getByLabelText("to")).toHaveValue("2026-09-27");
    // Moving the start alone keeps the end: 2026-09-16 to 2026-09-27.
    fireEvent.change(from, { target: { value: "2026-09-16" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=12&date=2026-09-27&"))).toBe(true),
    );
    fireEvent.change(await screen.findByLabelText("to"), { target: { value: "2026-09-20" } });
    await screen.findByText("2026-09-16 to 2026-09-20");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("days=5&date=2026-09-20&"))).toBe(true);
    const players = screen.getByText("Players", { selector: ".analytics__tile-label" }).closest(".analytics__tile")!;
    expect(within(players as HTMLElement).getByText("2026-09-16 to 2026-09-20")).toBeInTheDocument();
    expect(screen.getByText(/^The puzzles from 2026-09-16 to 2026-09-20, split by the rules/)).toBeInTheDocument();
    expect(screen.getByText(/^Events from 2026-09-16 to 2026-09-20 \(Mountain Time\)/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /days|Today/ })) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    fetchMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() => expect(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0])).toContain("days=30&key"));
  });

  it("keeps a picked range in order and within a year", () => {
    const range = { from: "2026-09-10", to: "2026-09-20" };
    expect(moveRange(range, "from", "2026-09-12")).toEqual({ from: "2026-09-12", to: "2026-09-20" });
    // An end moved past the other drags it along.
    expect(moveRange(range, "from", "2026-09-25")).toEqual({ from: "2026-09-25", to: "2026-09-25" });
    expect(moveRange(range, "to", "2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-09-01" });
    // More than 365 days pulls the other end in to exactly a year.
    expect(moveRange(range, "from", "2025-01-01")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(moveRange(range, "to", "2027-12-31")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
  });

  it("says so when the report cannot load", async () => {
    stubFetch(null);
    render(<AnalyticsPage />);
    expect(await screen.findByText(/Couldn.t load this list/)).toBeInTheDocument();
  });
});
