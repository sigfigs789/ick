import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardPage } from "./LeaderboardPage";
import { hasJoined, joinBoard, loadPlayerId } from "../game/player";

// Names on the board are words the players found, not handles they picked.
// A player's name is their rarest word ever and is the same on both boards --
// that is what lets you recognise the same rival week after week. The weekly
// board additionally carries what they found *this* week.
const WEEKLY = [
  { rank: 1, playerId: "11111111-1111-4111-8111-111111111111", name: "asphyxiate", nameZipf: 2.09, windowWord: "quixotic", windowZipf: 2.33, score: 41.2, puzzles: 5 },
  { rank: 2, playerId: "22222222-2222-4222-8222-222222222222", name: "inkling", nameZipf: 2.9, windowWord: "wrinkle", windowZipf: 3.31, score: 24.6, puzzles: 3 },
];
const ALL_TIME = [
  { rank: 1, playerId: "22222222-2222-4222-8222-222222222222", name: "inkling", nameZipf: 2.9, windowWord: "inkling", windowZipf: 2.9, score: 310.5, puzzles: 40 },
  { rank: 2, playerId: "11111111-1111-4111-8111-111111111111", name: "asphyxiate", nameZipf: 2.09, windowWord: "asphyxiate", windowZipf: 2.09, score: 180, puzzles: 22 },
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

const WORDS = [
  { word: "asphyxiate", zipf: 2.09, finders: 3 },
  { word: "quixotic", zipf: 2.33, finders: 1 },
];

const OPEN = {
  weekStart: "2026-08-23",
  ready: true,
  opensOn: "2026-08-30",
  weekly: WEEKLY,
  allTime: ALL_TIME,
  words: WORDS,
};

/** Answer the board fetch; a `null` body makes the request fail instead. */
function stubFetch(body: unknown = OPEN) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // Score submissions are POSTs and answered blandly; only the GET matters.
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (init?.method === "PUT") return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

/**
 * The detail line of one row, on its own.
 *
 * Read from the element rather than the row's whole text content: a row
 * concatenates to things like "quixotic 7.941.2", where the score that follows
 * makes a substring assertion pass for a number that was never displayed.
 */
function rowMeta(heading: string, index: number): string {
  return boardRows(heading)[index].querySelector(".leaderboard__meta")?.textContent ?? "";
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

  it("leads the weekly row with this week's find and keeps the standing name under it", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The week's find is what the weekly board is about, so it leads; the
    // standing name rides underneath so a rival is still recognisable.
    await waitFor(() => expect(boardRows("This week")[0]).toHaveTextContent("quixotic"));
    expect(rowMeta("This week", 0)).toBe("5 puzzles · known as asphyxiate");
  });

  it("shows the standing name without needing a hover", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Most of this game is played on phones, where there is no hover -- so the
    // identity is in the row's own text, and the tooltip is only a convenience.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(rowMeta("This week", 0)).toContain("asphyxiate");
    expect(boardRows("This week")[0].querySelector(".leaderboard__name")).toHaveAttribute(
      "title",
      "known as asphyxiate"
    );
  });

  it("says it once when this week's find is also the standing name", async () => {
    stubFetch({
      ...OPEN,
      weekly: [{ ...WEEKLY[0], windowWord: "asphyxiate", windowZipf: 2.09 }],
    });
    render(<LeaderboardPage />);

    // No second word to report, so the detail falls back to what it is worth
    // rather than saying "known as asphyxiate" under the word `asphyxiate`.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(1));
    expect(rowMeta("This week", 0)).toBe("5 puzzles · best 8.3");
  });

  it("keeps the same name on both boards, so a rival stays recognisable", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Whoever beat you this week is findable on the all-time board under the
    // same standing name -- which is the whole reason the name is not weekly.
    expect(rowMeta("This week", 0)).toContain("asphyxiate");
    expect(boardRows("All time")[1]).toHaveTextContent("asphyxiate");
  });

  it("shows the naming word's own worth on the all-time row", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // No second word to name here: the window is everything, so the rarest word
    // in it *is* the name. inkling is worth 7.11 today.
    await waitFor(() => expect(boardRows("All time")[0]).toHaveTextContent("inkling"));
    expect(rowMeta("All time", 0)).toBe("40 puzzles · best 7.1");
  });

  it("counts the puzzles behind each score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(rowMeta("This week", 0)).toContain("5 puzzles"));
    expect(rowMeta("This week", 1)).toContain("3 puzzles");
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
  const SHUT = {
    weekStart: "2026-08-23",
    ready: false,
    opensOn: "2026-08-30",
    weekly: [],
    allTime: [],
    words: [],
  };

  it("names the day the boards open instead of showing one", async () => {
    stubFetch(SHUT);
    render(<LeaderboardPage />);

    const status = await screen.findByRole("region", { name: "Leaderboard status" });
    // A day a player can plan around, rather than a target that may never
    // arrive.
    expect(status).toHaveTextContent("Boards open Sunday");
    expect(status).toHaveTextContent("Aug 30");
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull();
    expect(screen.queryByRole("region", { name: "All time" })).toBeNull();
  });

  it("says scores are already counting, so playing now isn't wasted", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    stubFetch(SHUT);
    render(<LeaderboardPage />);

    expect(await screen.findByText(/already being counted/)).toBeInTheDocument();
    // Joining is still offered: collecting starts before displaying does.
    expect(screen.getByRole("button", { name: "Put me on the board" })).toBeInTheDocument();
  });

  it("withholds the boards even if rows arrive alongside a false flag", async () => {
    stubFetch({ ...SHUT, weekly: WEEKLY, allTime: ALL_TIME });
    render(<LeaderboardPage />);

    await screen.findByRole("region", { name: "Leaderboard status" });
    expect(screen.queryByText("quixotic")).toBeNull();
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
    // Each day carries its own rarest word; nothing here asserts a name. The
    // board derives that from these rows, so the archive day cannot supply one
    // any more than it can supply a score.
    expect((posts[0].scores as { word: string }[]).map((s) => s.word)).toEqual([
      "inkling",
      "wrinkle",
    ]);
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
    expect(await screen.findByText(/You're on the board as/)).toHaveTextContent("inkling");
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

describe("choosing which of your finds names you", () => {
  /** A browser with three days behind it, of differing rarity. */
  function history() {
    playedToday("2026-08-19", "cat", 4.78);
    playedToday("2026-08-20", "inkling", 2.9);
    playedToday("2026-08-21", "asphyxiate", 2.09);
  }

  it("defaults to the rarest word, and offers the rest", async () => {
    history();
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    expect(await screen.findByText(/You're on the board as/)).toHaveTextContent("asphyxiate");
    await userEvent.click(screen.getByRole("button", { name: "Choose a different word" }));

    // Every day's best find, priced at today's rates, best first.
    const options = screen.getAllByRole("button", { pressed: false });
    const words = options.map((o) => o.textContent);
    expect(words.some((w) => w?.includes("inkling"))).toBe(true);
    expect(words.some((w) => w?.includes("cat"))).toBe(true);
  });

  it("marks the word in use rather than greying it out", async () => {
    history();
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Choose a different word" }));
    // The current name is the answer, not a control that failed.
    const current = screen.getByRole("button", { pressed: true });
    expect(current).toHaveTextContent("asphyxiate");
  });

  it("changes the name to a word the player chose", async () => {
    history();
    joinBoard();
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Choose a different word" }));
    await userEvent.click(screen.getByRole("button", { name: /inkling/ }));

    const renames = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(renames).toHaveLength(1);
    expect(JSON.parse(String((renames[0][1] as RequestInit).body))).toMatchObject({
      name: "inkling",
    });
    expect(await screen.findByText(/You're on the board as/)).toHaveTextContent("inkling");
  });

  it("says so when the rename didn't take, rather than showing a name that isn't set", async () => {
    history();
    joinBoard();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ok: false, reason: "not-your-word" }), { status: 409 });
      }
      if (init?.method === "POST") return new Response(null, { status: 202 });
      return new Response(JSON.stringify(OPEN), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeaderboardPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Choose a different word" }));
    await userEvent.click(screen.getByRole("button", { name: /inkling/ }));

    expect(await screen.findByText(/Couldn't change your name/)).toBeInTheDocument();
    // Still the old name: the page never claims a change the server refused.
    expect(screen.getByText(/You're on the board as/)).toHaveTextContent("asphyxiate");
  });

  it("offers no choice to a player with only one find", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    await screen.findByText(/You're on the board as/);
    // Nothing to choose between, so no control that leads nowhere.
    expect(screen.queryByRole("button", { name: "Choose a different word" })).toBeNull();
  });
});

describe("recent finds", () => {
  /** The words feed's list items. */
  function finds() {
    return within(screen.getByRole("region", { name: "Words found recently" })).getAllByRole(
      "listitem"
    );
  }

  it("lists the words other players found, rarest first", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(finds()).toHaveLength(2));
    expect(finds()[0]).toHaveTextContent("asphyxiate");
    expect(finds()[1]).toHaveTextContent("quixotic");
  });

  it("badges each word at what it is worth today", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The same badge the game shows on an accepted word, so a find reads the
    // way finding it would have. Read off the badge's own element: the row's
    // text runs together as "8.33 players", where a substring match would pass
    // for a number never displayed.
    await waitFor(() => expect(finds()[0]).toHaveTextContent("EXTREMELY RARE"));
    expect(finds()[0].querySelector(".rarity-badge__score")?.textContent).toBe("8.3");
  });

  it("says how many players found a word, when more than one did", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(finds()[0]).toHaveTextContent("3 players"));
    // One finder needs no count -- "1 players" is noise, and so is "1 player".
    expect(finds()[1]).not.toHaveTextContent("player");
  });

  it("says today's finds are held back, so nobody reads it as live", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    expect(await screen.findByText(/Today's stay hidden until tomorrow/)).toBeInTheDocument();
  });

  it("shows the feed even while the boards are still shut", async () => {
    stubFetch({
      weekStart: "2026-08-23",
      ready: false,
      opensOn: "2026-08-30",
      weekly: [],
      allTime: [],
      words: WORDS,
    });
    render(<LeaderboardPage />);

    // The feed works from day one, so the page is never empty while the boards
    // wait for their opening date.
    await waitFor(() => expect(finds()).toHaveLength(2));
    expect(screen.getByRole("region", { name: "Leaderboard status" })).toHaveTextContent(
      "Boards open Sunday"
    );
  });

  it("shows nothing at all when there are no finds yet", async () => {
    stubFetch({ ...OPEN, words: [] });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // An empty section with a heading would be worse than no section.
    expect(screen.queryByRole("region", { name: "Words found recently" })).toBeNull();
  });
});
