import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardPage } from "./LeaderboardPage";
import { hasJoined, joinBoard, loadPlayerId } from "../game/player";
import { handleFor } from "../game/handle";

// No names come from the server: the client derives a handle from each player
// id, so the same player is recognisable on both boards without anything being
// stored. `windowWord` is what they found inside that board's window.
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
// Somebody a long way down both boards, which is where almost everybody is.
const CAROL = "33333333-3333-4333-8333-333333333333";

const WEEKLY = [
  { rank: 1, playerId: ALICE, windowWord: "quixotic", windowZipf: 2.33, score: 41.2, puzzles: 5 },
  { rank: 2, playerId: BOB, windowWord: "wrinkle", windowZipf: 3.31, score: 24.6, puzzles: 3 },
];
const ALL_TIME = [
  { rank: 1, playerId: BOB, windowWord: "inkling", windowZipf: 2.9, score: 310.5, puzzles: 40 },
  { rank: 2, playerId: ALICE, windowWord: "asphyxiate", windowZipf: 2.09, score: 180, puzzles: 22 },
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
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");

    const allTime = boardRows("All time");
    // A different order from the weekly board, which is the point of both.
    expect(allTime[0]).toHaveTextContent(handleFor(BOB));
    expect(allTime[0]).toHaveTextContent("310.5");
  });

  it("says it ranks by total score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    expect(screen.getByText("Ranked by total score")).toBeInTheDocument();
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
  });

  it("names the player, and puts their find in the detail", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // A handle is unmistakably a person, which is the entire reason it exists:
    // naming players after their rarest word left a leaderboard row looking
    // exactly like an entry in the list of found words below it.
    await waitFor(() => expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE)));
    expect(rowMeta("This week", 0)).toBe("5 puzzles · quixotic 7.9");
  });

  it("gives the same player the same name on both boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Whoever beat you this week is findable on the all-time board under the
    // same name -- derived from their id, so it cannot drift between the two.
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows("All time")[1]).toHaveTextContent(handleFor(ALICE));
  });

  it("shows each player's best ever in the all-time detail", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The all-time window is everything, so the find in its detail is their
    // rarest ever. inkling is worth 7.1 today.
    await waitFor(() => expect(boardRows("All time")[0]).toHaveTextContent(handleFor(BOB)));
    expect(rowMeta("All time", 0)).toBe("40 puzzles · inkling 7.1");
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

  it("shows a player below the cut their own row, at their real rank", async () => {
    joinBoard();
    stubFetch({
      ...OPEN,
      weeklySelf: { rank: 61, playerId: CAROL, windowWord: "inkling", windowZipf: 2.9, score: 12, puzzles: 2 },
      allTimeSelf: { rank: 214, playerId: CAROL, windowWord: "quixotic", windowZipf: 2.33, score: 88, puzzles: 19 },
    });
    render(<LeaderboardPage />);

    // Under the board rather than in it: the top stays the top, and the player
    // still gets an answer to "where am I".
    await waitFor(() => expect(boardRows("This week")).toHaveLength(3));
    const mine = boardRows("This week")[2];
    // The real rank, not a position inside what fits on screen.
    expect(mine).toHaveTextContent("61");
    expect(mine).toHaveTextContent("you");
    expect(boardRows("All time")[2]).toHaveTextContent("214");
  });

  it("shows no extra row when the player is on the board", async () => {
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    // Nothing below the cut to show, so the board is just the board.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows("All time")).toHaveLength(2);
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
    expect(screen.queryByText(handleFor(ALICE))).toBeNull();
  });
});

describe("joining the board", () => {
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
    expect(await screen.findByText(/Counted 2 puzzles you'd already played/)).toBeInTheDocument();
  });

  it("can be joined with no history at all", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // A handle comes from the id, not from a word, so there is nothing to earn
    // before joining -- the old version made you play one first.
    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));
    expect(loadPlayerId()).not.toBeNull();
    expect(await screen.findByText(/Nothing to count yet/)).toBeInTheDocument();
  });

  it("says nothing standing about who you are once you have joined", async () => {
    stubFetch();
    const { unmount } = render(<LeaderboardPage />);
    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));

    // The confirmation is worth one showing; after that a player's own row is
    // marked on the boards, which is where they would look for themselves.
    unmount();
    render(<LeaderboardPage />);
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(screen.queryByText(/You're on the board as/)).toBeNull();
    expect(screen.queryByText(/Counted/)).toBeNull();
  });

  it("keeps one identity if the join is somehow pressed twice", async () => {
    stubFetch();
    const { unmount } = render(<LeaderboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Put me on the board" }));
    const first = loadPlayerId();
    unmount();
    render(<LeaderboardPage />);
    // Already joined, so there is no button to press again -- and the id stands,
    // which is what keeps the handle stable.
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

describe("recent finds", () => {
  /** The words feed's list items. */
  function finds() {
    return within(screen.getByRole("region", { name: "Today's finds" })).getAllByRole("listitem");
  }

  it("lists the words other players found today", async () => {
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

  it("names the drop the finds had to contain", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Without it the list is a pile of unrelated words.
    const section = await screen.findByRole("region", { name: "Today's finds" });
    expect(section.querySelector(".found-words__drop")?.textContent).toBeTruthy();
    expect(screen.getByText("The best word each player has found today.")).toBeInTheDocument();
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
    expect(screen.queryByRole("region", { name: "Today's finds" })).toBeNull();
  });
});

describe("finds arriving", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The feed's items, in order. */
  function finds() {
    return within(screen.getByRole("region", { name: "Today's finds" })).getAllByRole("listitem");
  }

  it("marks a word that turned up since the last look, and puts it on top", async () => {
    let words = [{ word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ...OPEN, words }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    render(<LeaderboardPage />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(finds()).toHaveLength(1);
    // Nothing animates on the first load: everything is new to a page that has
    // just opened, and marking it all would say twelve words just arrived.
    expect(finds()[0].className).not.toContain("arrived");

    // A rarer word lands later in the day; the feed is newest-first, so it goes
    // above the one already there and pushes it down.
    words = [
      { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-08-25" },
      ...words,
    ];
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));

    expect(finds().map((li) => li.textContent)).toHaveLength(2);
    expect(finds()[0]).toHaveTextContent("asphyxiate");
    expect(finds()[0].className).toContain("arrived");
    // The word that was already there is not re-announced.
    expect(finds()[1].className).not.toContain("arrived");
  });

  it("stops marking it once the arrival has played", async () => {
    let words = [{ word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ...OPEN, words }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    render(<LeaderboardPage />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));

    words = [{ word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-08-25" }, ...words];
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(finds()[0].className).toContain("arrived");

    // Otherwise an unrelated re-render would replay the animation later.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1400)));
    expect(finds()[0].className).not.toContain("arrived");
  });
});

describe("keeping the finds current", () => {
  // Fake timers go up *before* render: the polling interval is created on mount,
  // and one scheduled against the real clock would never fire under a fake one.
  // advanceTimersByTimeAsync also flushes the promises each fetch settles
  // through, so it stands in for waitFor, which cannot run on a frozen clock.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-checks on an interval while the page is open", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    expect(boardRows("This week")).toHaveLength(2);

    const first = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    // Today's finds land through the day, so a page left open must not sit on
    // the snapshot it opened with.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first);
  });

  it("keeps the boards on screen through a refresh", async () => {
    stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);
    // A poll that flashed "Loading the boards…" every minute would be worse
    // than not polling.
    expect(screen.queryByText("Loading the boards…")).toBeNull();
    expect(boardRows("This week")).toHaveLength(2);
  });

  it("keeps the last good data when a refresh fails", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new Error("offline");
        return new Response(JSON.stringify(OPEN), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    expect(boardRows("This week")).toHaveLength(2);

    fail = true;
    await vi.advanceTimersByTimeAsync(60_000);

    // One bad minute is not a reason to throw the page away.
    expect(screen.queryByText(/Couldn't load the boards/)).toBeNull();
    expect(boardRows("This week")).toHaveLength(2);
  });

  it("stops polling while the tab is hidden, and catches up on return", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    const before = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(180_000);
    // A backgrounded tab is not being read, so it is not worth a request.
    expect(fetchMock.mock.calls.length).toBe(before);

    hidden.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    // Coming back refreshes at once rather than waiting out the interval.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
