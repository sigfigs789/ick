import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsPage } from "./AnalyticsPage";
import { findHighlights } from "./analyticsFormat";
import { parseAnalytics } from "../game/review";

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
    { source: "direct", visits: 600, firstVisits: 100, engaged: 400 },
    { source: "reddit", visits: 100, firstVisits: 80, engaged: 90 },
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

    expect(await screen.findByText("Players today")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/review?list=analytics&days=60&key=sesame");
    // Next-day retention: 72 of 180.
    const nextDay = screen.getByText("72 of 180").closest(".analytics__tile")!;
    expect(within(nextDay as HTMLElement).getByText("40%")).toBeInTheDocument();
    // Day 30 has nobody old enough yet, and says so rather than printing 0%.
    expect(screen.getByText("not enough days yet")).toBeInTheDocument();
  });

  it("counts today by the viewer's calendar date, not the latest puzzle played", async () => {
    // Behind the latest puzzle: somebody further east is already on the 27th.
    clock.today = "2026-09-26";
    stubFetch({ ...REPORT, chat: CHAT });
    const { unmount } = render(<AnalyticsPage />);
    let tile = (await screen.findByText("Players today")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("50")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("puzzle 2026-09-26")).toBeInTheDocument();
    const looked = screen.getByText("Looked, didn't play").closest(".analytics__tile")!;
    expect(within(looked as HTMLElement).getByText("0")).toBeInTheDocument();
    const chat = screen.getByText("Chat viewers today").closest(".analytics__tile")!;
    expect(within(chat as HTMLElement).getByText("14")).toBeInTheDocument();
    expect(within(chat as HTMLElement).getByText("3 sent, 31 messages")).toBeInTheDocument();
    unmount();

    // Ahead of it: the viewer's day has begun and nobody is on it yet.
    clock.today = "2026-09-28";
    stubFetch();
    render(<AnalyticsPage />);
    tile = (await screen.findByText("Players today")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("0")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("puzzle 2026-09-28")).toBeInTheDocument();
  });

  it("counts the players who looked without playing", async () => {
    stubFetch();
    render(<AnalyticsPage />);

    const tile = (await screen.findByText("Looked, didn't play")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("7")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("19 over 7 puzzles, 11 never played")).toBeInTheDocument();
    expect(screen.getByLabelText("2026-09-27 (Sun): 40 players, 3 new, 7 only looked")).toBeInTheDocument();
    expect(screen.getByText(/60 engaged visits began on the/)).toBeInTheDocument();
    const sessions = screen.getByText("Only looked", { selector: ".analytics__tile-label" }).closest(".analytics__tile")!;
    expect(within(sessions as HTMLElement).getByText("10%")).toBeInTheDocument();
  });

  it("says a look has not been recorded rather than printing zero", async () => {
    stubFetch({ ...REPORT, totals: { ...REPORT.totals, lookersSince: null } });
    render(<AnalyticsPage />);

    const tile = (await screen.findByText("Looked, didn't play")).closest(".analytics__tile")!;
    expect(within(tile as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("not recorded yet")).toBeInTheDocument();
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
    await screen.findByText("Players today");
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
    expect(screen.getByText("Share-link taps in the window: 12 via copied Freeform links.")).toBeInTheDocument();
  });

  it("leaves the starting-mode section out when it failed", async () => {
    stubFetch({ ...REPORT, onboarding: null });
    render(<AnalyticsPage />);
    await screen.findByText("Players today");
    expect(screen.queryByText("New players by starting mode")).not.toBeInTheDocument();
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
