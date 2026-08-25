import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardPage } from "./LeaderboardPage";
import { hasJoined, joinBoard, loadPlayerId } from "../game/player";

// Names on the board are words the players found, not handles they picked.
const WEEKLY = [
  { rank: 1, playerId: "11111111-1111-4111-8111-111111111111", name: "asphyxiate", score: 41.2, best: 9.9, puzzles: 5 },
  { rank: 2, playerId: "22222222-2222-4222-8222-222222222222", name: "inkling", score: 24.6, best: 9.4, puzzles: 3 },
];
const ALL_TIME = [
  { rank: 1, playerId: "22222222-2222-4222-8222-222222222222", name: "inkling", score: 310.5, best: 10, puzzles: 40 },
  { rank: 2, playerId: "11111111-1111-4111-8111-111111111111", name: "asphyxiate", score: 180, best: 9.9, puzzles: 22 },
];

/** Put a played-on-its-day puzzle in storage, so this browser has a name. */
function playedToday(date: string, word: string, zipf: number) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({
      date,
      drop: "ink",
      acceptedWords: [{ word, rarity: "Rare", zipf }],
      rejectedAttempts: [],
      completed: true,
      firstWordAt: `${date}T19:00:00.000Z`,
      completedAt: `${date}T19:04:00.000Z`,
    })
  );
}

const OPEN = {
  weekStart: "2026-08-23",
  ready: true,
  players: 14,
  minPlayers: 10,
  weekly: WEEKLY,
  allTime: ALL_TIME,
};

/** Answer the board fetch; a `null` body makes the request fail instead. */
function stubFetch(body: unknown = OPEN) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // Score submissions are POSTs and answered blandly; only the GET matters.
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (body === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The rows of one board, by its heading. */
function boardRows(heading: string) {
  return within(screen.getByRole("region", { name: heading })).getAllByRole("listitem");
}

/** The bodies of every score submission the page made. */
function submissions(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

beforeEach(() => {
  localStorage.clear();
  window.history.pushState(null, "", "/leaderboard");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the leaderboard page", () => {
  it("shows both boards at once, each ranked as the database ordered it", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Both on screen together -- there is no tab to click and no board hidden
    // behind one. This is the whole layout decision, so it is asserted directly.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows("This week")[0]).toHaveTextContent("asphyxiate");
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");

    const allTime = boardRows("All time");
    // A different order from the weekly board, which is the point of both.
    expect(allTime[0]).toHaveTextContent("inkling");
    expect(allTime[0]).toHaveTextContent("310.5");
  });

  it("says it ranks by total score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    expect(screen.getByText("Ranked by total score")).toBeInTheDocument();
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
  });

  it("counts the puzzles behind each score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")[0]).toHaveTextContent("5 puzzles"));
    expect(boardRows("This week")[1]).toHaveTextContent("3 puzzles");
  });

  it("marks the player's own row on both boards", async () => {
    const me = joinBoard();
    stubFetch({
      ...OPEN,
      weekly: [WEEKLY[0], { ...WEEKLY[1], playerId: me ?? "" }],
      allTime: [{ ...ALL_TIME[0], playerId: me ?? "" }, ALL_TIME[1]],
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")[1]).toHaveTextContent("you"));
    expect(boardRows("All time")[0]).toHaveTextContent("you");
    expect(boardRows("This week")[0]).not.toHaveTextContent("you");
  });

  it("asks for the week's board from its Sunday", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    const since = new URL(url, "https://wordink.app").searchParams.get("since") ?? "";
    // A Sunday, whatever day the test runs on.
    expect(new Date(`${since}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("offers a retry when the boards can't be loaded", async () => {
    const fetchMock = stubFetch(null);
    render(<LeaderboardPage />);

    expect(await screen.findByText(/Couldn't load the boards/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("before the boards open", () => {
  it("shows the player count instead of a board", async () => {
    stubFetch({ weekStart: "2026-08-23", ready: false, players: 6, minPlayers: 10, weekly: [], allTime: [] });
    render(<LeaderboardPage />);

    const status = await screen.findByRole("region", { name: "Leaderboard status" });
    expect(status).toHaveTextContent("6 of 10 players");
    expect(status).toHaveTextContent(/4 to go/);
    // No board at all, not an empty one -- a three-name table teaches a new
    // player that nobody plays this.
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull();
    expect(screen.queryByRole("region", { name: "All time" })).toBeNull();
  });

  it("says scores are already counting, so joining early isn't wasted", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    stubFetch({ weekStart: "2026-08-23", ready: false, players: 1, minPlayers: 10, weekly: [], allTime: [] });
    render(<LeaderboardPage />);

    expect(await screen.findByText(/scores are already being counted/)).toBeInTheDocument();
    // Joining is still offered: collecting starts before displaying does.
    expect(screen.getByRole("button", { name: "Put me on the board" })).toBeInTheDocument();
  });

  it("withholds the boards even if rows arrive alongside a false flag", async () => {
    stubFetch({ weekStart: "2026-08-23", ready: false, players: 3, minPlayers: 10, weekly: WEEKLY, allTime: ALL_TIME });
    render(<LeaderboardPage />);

    await screen.findByRole("region", { name: "Leaderboard status" });
    expect(screen.queryByText("asphyxiate")).toBeNull();
  });
});

describe("joining the board", () => {
  it("offers to join under the player's own rarest word", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    stubFetch();
    render(<LeaderboardPage />);

    // Nothing to type: the name is the find. asphyxiate scores 8.30 today and
    // inkling 7.11, so the rarer of the two is the offer.
    playedToday("2026-08-21", "asphyxiate", 2.09);
    render(<LeaderboardPage />);
    expect(screen.getAllByText("asphyxiate")[0]).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("joins in one tap and brings the browser's own history along", async () => {
    // Three remembered days: one played on its own date, one half-played on its
    // own date, and one pulled out of the archive weeks later.
    localStorage.setItem(
      "ick:progress:2026-08-20",
      JSON.stringify({
        date: "2026-08-20",
        drop: "ink",
        acceptedWords: [{ word: "inkling", rarity: "Rare", zipf: 2.9 }],
        rejectedAttempts: [],
        completed: true,
        firstWordAt: "2026-08-20T19:00:00.000Z",
        completedAt: "2026-08-20T19:04:00.000Z",
      })
    );
    localStorage.setItem(
      "ick:progress:2026-08-21",
      JSON.stringify({
        date: "2026-08-21",
        drop: "ink",
        acceptedWords: [{ word: "wrinkle", rarity: "Uncommon", zipf: 3.31 }],
        rejectedAttempts: [],
        completed: false,
        firstWordAt: "2026-08-21T08:00:00.000Z",
      })
    );
    localStorage.setItem(
      "ick:progress:2026-07-04",
      JSON.stringify({
        date: "2026-07-04",
        drop: "str",
        acceptedWords: [{ word: "asphyxiate", rarity: "Extremely Rare", zipf: 2.09 }],
        rejectedAttempts: [],
        completed: true,
        firstWordAt: "2026-08-24T19:00:00.000Z",
        completedAt: "2026-08-24T19:04:00.000Z",
      })
    );
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));
    expect(hasJoined()).toBe(true);

    const posts = submissions(fetchMock);
    expect(posts).toHaveLength(1);
    // Both days it can prove were played on their own date, including the one
    // never finished. Archive play stays off the board here for the same reason
    // it does on the live path.
    expect((posts[0].scores as { date: string }[]).map((s) => s.date)).toEqual([
      "2026-08-20",
      "2026-08-21",
    ]);
    // And named by the best of *those* days -- asphyxiate is rarer, but it was
    // archive play, so it cannot name the player either.
    expect(posts[0].name).toBe("inkling");
    expect(await screen.findByText(/Counted 2 puzzles you'd already played/)).toBeInTheDocument();
  });

  it("tells a player with no words yet to play one first", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    expect(screen.getByText(/Play a word and you can join/)).toBeInTheDocument();
    // Nothing to join with, so nothing to press.
    expect(screen.queryByRole("button", { name: "Put me on the board" })).toBeNull();
    expect(loadPlayerId()).toBeNull();
  });

  it("says which word the player is on the board as", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));
    const note = await screen.findByText(/You're on the board as/);
    expect(note).toHaveTextContent("inkling");
    // The promise that makes the name worth having.
    expect(note).toHaveTextContent(/Beat it and this changes/);
  });

  it("keeps one identity if the join is somehow pressed twice", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    stubFetch();
    const { unmount } = render(<LeaderboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));
    const first = loadPlayerId();
    unmount();
    render(<LeaderboardPage />);
    // Already joined, so there is no button to press again -- and the id stands.
    expect(screen.queryByRole("button", { name: "Put me on the board" })).toBeNull();
    expect(loadPlayerId()).toBe(first);
  });
});

describe("leaving the page", () => {
  it("goes back to the puzzle from the header and the footer", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Back to the puzzle" }));
    expect(window.location.pathname).toBe("/");

    window.history.pushState(null, "", "/leaderboard");
    await userEvent.click(screen.getByRole("button", { name: "Back to today's puzzle" }));
    expect(window.location.pathname).toBe("/");
  });
});
