import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardPage } from "./LeaderboardPage";
import { hasJoined, joinBoard } from "../game/player";
import { handleFor } from "../game/handle";
import { seasonName } from "../game/leaderboard";

// No names come from the server: the client derives a handle from each player
// id, so the same player is recognisable on both boards without anything being
// stored. `windowWord` is what they found inside that board's window.
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
// The second board is named for the season it counts, so the test asks for it
// by the same name the page builds -- one place to change when Season 2 opens.
const SEASON_BOARD = seasonName();
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

    const allTime = boardRows(SEASON_BOARD);
    // A different order from the weekly board, which is the point of both.
    expect(allTime[0]).toHaveTextContent(handleFor(BOB));
    expect(allTime[0]).toHaveTextContent("310.5");
  });

  it("names the season and the dates it runs between", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // A season is a window, so it says which one. The board is bounded to the
    // same dates server-side -- the heading is not decoration over an all-time
    // sum.
    const board = screen.getByRole("region", { name: SEASON_BOARD });
    expect(board).toHaveTextContent("Season 1");
    expect(board).toHaveTextContent("Aug 1 – Dec 31 2026");
  });

  it("makes each board's list reachable by keyboard, since it scrolls", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Five rows of the fifteen are on screen and the rest are scrolled to, so
    // the list is a scrolling region -- and a region that only a thumb can
    // reach is one a keyboard cannot read.
    await waitFor(() => expect(screen.getByRole("list", { name: /This week/ })).toHaveAttribute("tabindex", "0"));
    expect(screen.getByRole("list", { name: new RegExp(SEASON_BOARD) })).toHaveAttribute(
      "tabindex",
      "0"
    );
  });

  it("puts the rule that governs both boards above both of them", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // It used to be a caption on the season, where it read as something
    // peculiar to that board. It is not: the weekly board only counts a puzzle
    // played on its own day either, so it belongs to the pair -- and on the way
    // in, since it is the condition a score has to meet to be on either list.
    await waitFor(() =>
      expect(screen.getByText("Only puzzles played on the day they drop count")).toBeInTheDocument()
    );
    const season = screen.getByRole("region", { name: SEASON_BOARD });
    expect(season).not.toHaveTextContent("Only puzzles played on the day they drop count");
  });

  it("says when the weekly board turns over, and no more than that", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    const board = screen.getByRole("region", { name: "This week" });
    // Beside the heading, where the season's dates sit, so the two boards start
    // level when they are side by side.
    expect(board).toHaveTextContent("Resets on Sundays");
    // No dates and no countdown: a week is the window you are already in, and
    // "this week" says which days it counts. The season carries dates because it
    // is long enough that where you are inside it is a real question.
    expect(board).not.toHaveTextContent("From Sunday on");
    expect(board).not.toHaveTextContent(/Resets in \d/);
    expect(board).not.toHaveTextContent(/Aug \d+ – \d+/);
  });

  it("drops the subtitle over the two boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // "Ranked by total score" described a column both boards already show,
    // above two headings that each say what they count.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(screen.queryByText("Ranked by total score")).toBeNull();
  });

  it("names the player, and says how much they played", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // A handle is unmistakably a person, which is the entire reason it exists:
    // naming players after their rarest word left a leaderboard row looking
    // exactly like an entry in the list of found words below it.
    await waitFor(() => expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE)));
    expect(rowMeta("This week", 0)).toBe("5 puzzles");
  });

  it("gives the same player the same name on both boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Whoever beat you this week is findable on the all-time board under the
    // same name -- derived from their id, so it cannot drift between the two.
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows(SEASON_BOARD)[1]).toHaveTextContent(handleFor(ALICE));
  });

  it("keeps every player's find off both boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // A find is shown with what it scored, and the scoring system is still being
    // corrected -- so the words stay under Today's finds and the boards say only
    // what somebody played and what it added up to.
    await waitFor(() => expect(boardRows(SEASON_BOARD)[0]).toHaveTextContent(handleFor(BOB)));
    expect(rowMeta(SEASON_BOARD, 0)).toBe("40 puzzles");
    expect(boardRows(SEASON_BOARD)[0]).not.toHaveTextContent("inkling");
    expect(boardRows("This week")[0]).not.toHaveTextContent("quixotic");
  });

  it("counts the puzzles behind each score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(rowMeta("This week", 0)).toContain("5 puzzles"));
    expect(rowMeta("This week", 1)).toContain("3 puzzles");
  });

  it("says what the number on the right of every row is", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // One header per board, over the column it labels. Every other figure on a
    // row says what it is in words; the score, which is what the board is
    // ranked by, had been left to be inferred.
    await waitFor(() => expect(screen.getAllByText("Total score")).toHaveLength(2));
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
    expect(boardRows(SEASON_BOARD)[0]).toHaveTextContent("you");
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
    expect(boardRows(SEASON_BOARD)[2]).toHaveTextContent("214");
  });

  it("shows no extra row when the player is on the board", async () => {
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    // Nothing below the cut to show, so the board is just the board.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows(SEASON_BOARD)).toHaveLength(2);
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
    // Counted by URL rather than by call: a load is two requests now, the
    // boards and the feed beside them, and it is the boards being retried.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1"))
      ).toHaveLength(2)
    );
  });

  it("still shows the finds when only the boards fail", async () => {
    // Two requests, and only one of them broken. They are separate on purpose
    // (the boards carry a player id and the feed does not), so they fail
    // separately too.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(null, { status: 202 });
        if (!String(url).includes("words=1")) return new Response("nope", { status: 502 });
        return new Response(JSON.stringify({ words: WORDS }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    render(<LeaderboardPage />);

    // The boards say so, and the feed underneath is unaffected -- hiding words
    // that arrived perfectly well would be losing the half of the page that
    // still works.
    expect(await screen.findByText(/Couldn't load the boards/)).toBeInTheDocument();
    const feed = await screen.findByRole("region", { name: "Today's finds" });
    expect(within(feed).getAllByRole("listitem")).toHaveLength(WORDS.length);
  });
});

describe("who the page thinks you are", () => {
  it("mints nobody: the identity is the app's, not this page's", async () => {
    playedToday("2026-08-20", "inkling", 2.9);
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // The id is minted on opening the app and the history goes up there (see
    // src/Root.tsx and its tests). This page rendered on its own, with no Root
    // above it, so a browser that arrived without an id still has none -- which
    // is the assertion that keeps a second minting site from growing back.
    expect(hasJoined()).toBe(false);
    expect(submissions(fetchMock)).toHaveLength(0);
  });

  it("marks your own row from the id the app already minted", async () => {
    // Whoever ALICE is, this browser is them.
    localStorage.setItem("ick:player", JSON.stringify({ id: ALICE }));
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    const you = boardRows("This week").filter((row) =>
      row.classList.contains("leaderboard__row--you")
    );
    expect(you).toHaveLength(1);
    expect(you[0].textContent).toContain(handleFor(ALICE));
  });

  it("asks for nothing: no call to action, and no explanation under it", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // The page is the boards and the finds. Everything that used to sit under
    // them -- the button, the paragraph about there being no account or email,
    // the count of imported puzzles -- reported a joining that now happens
    // before anybody gets here, silently, with nothing to announce.
    expect(screen.queryByRole("button", { name: "Put me on the board" })).toBeNull();
    expect(screen.queryByText(/No account, no email/)).toBeNull();
    expect(screen.queryByText(/Counted/)).toBeNull();
    expect(screen.queryByText(/Nothing to count/)).toBeNull();
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
    // And nothing under the heading restating it.
    expect(screen.queryByText("Every word found on today's puzzle.")).toBeNull();
  });

  it("shows the feed even when nobody is on the boards yet", async () => {
    stubFetch({ weekStart: "2026-08-23", weekly: [], allTime: [], words: WORDS });
    render(<LeaderboardPage />);

    // The feed works from the first word, which is what makes an empty board
    // safe to show: the page is never empty while the boards fill up.
    await waitFor(() => expect(finds()).toHaveLength(2));
    expect(screen.getByRole("region", { name: "This week" })).toBeInTheDocument();
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

  it("polls the feed and leaves the boards alone", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const boardCalls = () =>
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1")).length;
    const opened = boardCalls();

    await vi.advanceTimersByTimeAsync(180_000);

    // The boards are the request carrying this player's id, so they are the one
    // the CDN cannot share. Re-asking every minute would buy a rank that had
    // almost certainly not moved, at the price of a private query per open page.
    expect(boardCalls()).toBe(opened);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("words=1")).length
    ).toBeGreaterThan(1);
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

  it("re-reads the boards when the tab comes back after a real absence", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const boardCalls = () =>
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1")).length;
    const opened = boardCalls();

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    hidden.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    // A page open since this morning shows this morning's standings, and coming
    // back to the tab is exactly when somebody reads them.
    expect(boardCalls()).toBe(opened + 1);
    // Read in place: no spinner over boards the reader can already see.
    expect(screen.queryByText("Loading the boards…")).toBeNull();
    expect(boardRows("This week")).toHaveLength(2);
  });

  it("does not re-read them for a glance at another tab", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const boardCalls = () =>
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1")).length;
    const opened = boardCalls();

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    hidden.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    // Half a minute away is not new information, and the boards are this
    // player's own uncached query -- not something to put on a hair trigger.
    expect(boardCalls()).toBe(opened);
  });

  it("refreshes both halves past the cache when a reader taps refresh", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const opened = fetchMock.mock.calls.length;

    // fireEvent rather than userEvent: this block runs on fake timers, and
    // userEvent waits on real ones.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Both: a reader who taps this is refreshing the page, not one section.
    const asked = fetchMock.mock.calls
      .slice(opened)
      .map(([url]) => String(url))
      .filter((url) => !url.includes("method"));
    expect(asked.some((url) => url.includes("words=1"))).toBe(true);
    expect(asked.some((url) => !url.includes("words=1"))).toBe(true);
    // Every one of them past the shared copy. A client cannot bust a CDN cache
    // with a header, so a different URL is the only thing that can, and without
    // it the button would hand back the list the reader just told us is stale.
    expect(asked.every((url) => /&t=\d+/.test(url))).toBe(true);
  });

  it("leaves the poll on the shared copy", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const opened = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);

    // The cache is there to absorb exactly this. Only a person gets to skip it.
    const polled = fetchMock.mock.calls.slice(opened).map(([url]) => String(url));
    expect(polled.length).toBeGreaterThan(0);
    expect(polled.every((url) => !url.includes("&t="))).toBe(true);
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
