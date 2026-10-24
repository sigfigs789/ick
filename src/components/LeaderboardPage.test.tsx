import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardPage } from "./LeaderboardPage";
import { hasJoined, joinBoard } from "../game/player";
import { handleFor } from "../game/handle";
import { todayDateString } from "../game/date";
import { MODE_CHOICE_START, resetModeCache, setMode } from "../game/mode";
import { setDevDateOverride } from "../dev/devDate";

// No names come from the server: the client derives a handle from each player
// id, so the same player is recognisable on both boards without anything being
// stored. `windowWord` is what they found inside that board's window.
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
// The second board counts the month, and says so.
const MONTH_BOARD = "This month";
// Somebody a long way down both boards, which is where almost everybody is.
const CAROL = "33333333-3333-4333-8333-333333333333";

const WEEKLY = [
  {
    rank: 1,
    playerId: ALICE,
    windowWord: "quixotic",
    windowZipf: 2.33,
    score: 41.2,
    puzzles: 5,
  },
  {
    rank: 2,
    playerId: BOB,
    windowWord: "wrinkle",
    windowZipf: 3.31,
    score: 24.6,
    puzzles: 3,
  },
];
// One puzzle's worth of scoring, which is what the daily board counts: nobody
// is on it with more than a day's total.
const DAILY = [
  {
    rank: 1,
    playerId: BOB,
    windowWord: "kerfuffle",
    windowZipf: 3.11,
    score: 9.4,
    puzzles: 1,
  },
];
const ALL_TIME = [
  {
    rank: 1,
    playerId: BOB,
    windowWord: "inkling",
    windowZipf: 2.9,
    score: 310.5,
    puzzles: 40,
  },
  {
    rank: 2,
    playerId: ALICE,
    windowWord: "asphyxiate",
    windowZipf: 2.09,
    score: 180,
    puzzles: 22,
  },
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
    }),
  );
}

const WORDS = [
  { word: "asphyxiate", zipf: 2.09, finders: 3 },
  { word: "quixotic", zipf: 2.33, finders: 1 },
];

const OPEN = {
  weekStart: "2026-08-23",
  daily: DAILY,
  weekly: WEEKLY,
  allTime: ALL_TIME,
  words: WORDS,
};

/** Answer the board fetch; a `null` body makes the request fail instead. */
function stubFetch(body: unknown = OPEN) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // Score submissions are POSTs and answered blandly; only the GET matters.
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (init?.method === "PUT")
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (body === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Which pill shows the board with this heading. */
function pillFor(heading: string): string {
  if (heading === "Streaks") return "Streak";
  if (/week/i.test(heading)) return "Week";
  if (/month/i.test(heading) || /^[A-Z][a-z]+ \d{4}$/.test(heading)) return "Month";
  return "Day";
}

/**
 * One board, by its heading, picking it with the pills first if another board
 * is showing -- the page shows one at a time.
 */
function board(heading: string): HTMLElement {
  const shown = screen.queryByRole("region", { name: heading });
  if (shown) return shown;
  fireEvent.click(screen.getByRole("button", { name: pillFor(heading) }));
  return board(heading);
}

/** The rows of one board, by its heading. */
function boardRows(heading: string) {
  return within(board(heading)).getAllByRole("listitem");
}

/**
 * The detail line of one row, on its own.
 *
 * Read from the element rather than the row's whole text content: a row
 * concatenates to things like "quixotic 7.941.2", where the score that follows
 * makes a substring assertion pass for a number that was never displayed.
 */
function rowMeta(heading: string, index: number): string {
  return (
    boardRows(heading)[index].querySelector(".leaderboard__meta")
      ?.textContent ?? ""
  );
}

/** The last of a list, without `Array.prototype.at` -- see tsconfig's lib. */
function lastOf(items: readonly string[]): string {
  return items[items.length - 1] ?? "";
}

/** The URLs of every board read the page made, in order. */
function boardUrls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method !== "POST")
    .map(([url]) => String(url));
}

/** The bodies of every score submission the page made. */
function submissions(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(
      ([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as Record<
          string,
          unknown
        >,
    );
}

/**
 * Read the page as if it were `date`.
 *
 * What the boards are headed and which windows they will step to both come from
 * the day the page is opened on, so a test about either has to fix it rather
 * than take whatever day the suite happens to run on.
 *
 * Local noon rather than midnight, so the calendar date is the same one in every
 * timezone the suite might run in -- the page reads the player's local date, and
 * a midnight instant lands on the day before for half the world.
 */
function onDay(date: string) {
  // Timers keep advancing on their own: the page polls and waits, and a clock
  // frozen solid would hang every `waitFor` in the test. Real timers first, so
  // a test setting its own day over the suite's default is installing one mock
  // rather than a second on top of it.
  vi.useRealTimers();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${date}T12:00:00`));
}

beforeEach(() => {
  localStorage.clear();
  window.history.pushState(null, "", "/leaderboard");
  // A Friday late in a month, unless a test says otherwise. The page
  // congratulates last week's winner from Monday to Thursday and last month's
  // from the second to the fifth (see game/congrats.ts), and either costs a
  // request -- so a suite running on whatever day it happens to be run would
  // count a different number of fetches on most of them. Noon local, so the
  // calendar date is the same one in every timezone.
  onDay("2026-08-28");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the leaderboard page", () => {
  it("shows all three boards at once, each ranked as the database ordered it", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // All on screen together -- there is no tab to click and no board hidden
    // behind one. This is the whole layout decision, so it is asserted directly.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows("Today")[0]).toHaveTextContent(handleFor(BOB));
    expect(boardRows("Today")[0]).toHaveTextContent("9.4");
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");

    const monthly = boardRows(MONTH_BOARD);
    // A different order from the weekly board, which is the point of both.
    expect(monthly[0]).toHaveTextContent(handleFor(BOB));
    expect(monthly[0]).toHaveTextContent("310.5");
  });

  it("shows the streak board beside the others when the server sends one", async () => {
    stubFetch({
      ...OPEN,
      streak: [
        { rank: 1, playerId: ALICE, current: 21, best: 21 },
        { rank: 2, playerId: BOB, current: 3, best: 40, frozen: true, covered: true },
        // Every saved freeze spent on missed days: the hourglass, not the ice.
        { rank: 3, playerId: CAROL, current: 2, best: 6, frozen: true, covered: true, atRisk: true },
        {
          rank: 4,
          playerId: "44444444-4444-4444-8444-444444444444",
          current: 1,
          best: 6,
          frozen: true,
          covered: true,
        },
        // Missed yesterday, with a saved freeze still left for today.
        {
          rank: 5,
          playerId: "55555555-5555-4555-8555-555555555555",
          current: 15,
          best: 15,
          covered: true,
        },
        // Ended a day or two ago: kept, at the length it reached, with a skull.
        {
          rank: null,
          playerId: "66666666-6666-4666-8666-666666666666",
          current: 9,
          best: 12,
          lost: true,
        },
        // Below the lost run, and ranked as if it were not there.
        { rank: 6, playerId: "77777777-7777-4777-8777-777777777777", current: 8, best: 8 },
      ],
      streakSelf: null,
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("Streaks")).toHaveLength(7));
    expect(boardRows("Streaks")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows("Streaks")[0]).toHaveTextContent("21");
    // Ranked by the run they are on, with their longest kept as the detail.
    expect(boardRows("Streaks")[1]).toHaveTextContent("Longest 40");
    // One icon a row: fire for a run played through yesterday, ice while a
    // saved freeze is covering it or ready to, an hourglass when missing today
    // ends it.
    expect(boardRows("Streaks")[0]).toHaveTextContent("🔥");
    expect(boardRows("Streaks")[0]).not.toHaveTextContent(/🧊|⏳/u);
    expect(boardRows("Streaks")[1]).toHaveTextContent("🧊");
    expect(boardRows("Streaks")[1]).not.toHaveTextContent(/🔥|⏳/u);
    expect(boardRows("Streaks")[1]).toHaveTextContent("covered by a saved freeze");
    expect(boardRows("Streaks")[2]).toHaveTextContent("⏳");
    expect(boardRows("Streaks")[2]).not.toHaveTextContent(/🔥|🧊/u);
    expect(boardRows("Streaks")[2]).toHaveTextContent("covered by a saved freeze");
    expect(boardRows("Streaks")[2]).toHaveTextContent("at risk today");
    // A one-day run is a start, not a streak: no icon at all.
    expect(boardRows("Streaks")[3]).not.toHaveTextContent(/🔥|🧊|⏳/u);
    // The free day with a freeze to spare is not at risk: ice, for the freeze
    // standing ready to cover today.
    expect(boardRows("Streaks")[4]).toHaveTextContent("🧊");
    expect(boardRows("Streaks")[4]).not.toHaveTextContent(/🔥|⏳|at risk/u);
    expect(boardRows("Streaks")[4]).toHaveTextContent("a saved freeze will cover today");
    expect(boardRows("Streaks")[5]).toHaveTextContent("💀");
    expect(boardRows("Streaks")[5]).not.toHaveTextContent(/🔥|🧊|⏳/u);
    expect(boardRows("Streaks")[5]).toHaveTextContent("9");
    expect(boardRows("Streaks")[5]).toHaveTextContent("lost");
    // Struck out and unnumbered; the next live run takes the rank it left.
    expect(boardRows("Streaks")[5]).toHaveClass("leaderboard__row--lost");
    expect(boardRows("Streaks")[5].querySelector(".leaderboard__rank")).toBeEmptyDOMElement();
    expect(boardRows("Streaks")[6]).not.toHaveClass("leaderboard__row--lost");
    expect(boardRows("Streaks")[6].querySelector(".leaderboard__rank")).toHaveTextContent(/^6$/);
    expect(board("Streaks")).toHaveTextContent(/Streak\s*Longest streak/);
    // No window, so nothing to step through.
    const streaks = board("Streaks");
    expect(within(streaks).queryByRole("button", { name: /previous/i })).toBeNull();
  });

  it("shows a dancer on a Saturday run not played yet, which says Saturdays don't break streaks", async () => {
    stubFetch({
      ...OPEN,
      streak: [
        { rank: 1, playerId: ALICE, current: 21, best: 21 },
        { rank: 2, playerId: BOB, current: 3, best: 40, frozen: true, covered: true, resting: true },
        { rank: 3, playerId: CAROL, current: 1, best: 6, resting: true },
      ],
      streakSelf: null,
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("Streaks")).toHaveLength(3));
    // Played today: fire, as on any day.
    expect(boardRows("Streaks")[0]).toHaveTextContent("🔥");
    expect(boardRows("Streaks")[0]).not.toHaveTextContent(/🕺|💃/u);
    // Resting, even under a freeze and even on a one-day run: the dancer alone.
    for (const row of boardRows("Streaks").slice(1)) {
      expect(row).toHaveTextContent(/🕺|💃/u);
      expect(row).not.toHaveTextContent(/🔥|🧊|⏳/u);
    }
    const dancer = within(boardRows("Streaks")[1]).getByRole("button", { name: /Saturday rest day/ });
    expect(dancer).toHaveAttribute("title", expect.stringContaining("Saturdays don't break streaks"));
    fireEvent.click(dancer);
    expect(within(boardRows("Streaks")[1]).getByRole("dialog")).toHaveTextContent(
      "Saturdays don't break streaks"
    );
  });

  it("leaves the streak board out when the server has none", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(screen.queryByRole("region", { name: "Streaks" })).toBeNull();
  });

  it("crowns the top row of each board and leaves the rest plain", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The prize sits on the board now rather than on a plaque under it: leading
    // is the thing being played for, and on a window that has closed the top row
    // is the champion anyway, so one treatment says both.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    for (const heading of ["Today", "This week", MONTH_BOARD]) {
      const rows = boardRows(heading);
      expect(rows[0]).toHaveClass("leaderboard__row--leader");
      expect(rows[0].querySelector(".leaderboard__rank-trophy")).toBeTruthy();
      // The digit the trophy stands in for is still read out: "first" is what a
      // screen reader needs from the column, and a trophy is not a rank.
      expect(rows[0]).toHaveTextContent("1");
    }
    // And nobody else: a board where every row looked won would say nothing.
    expect(boardRows("This week")[1]).not.toHaveClass(
      "leaderboard__row--leader",
    );
    expect(
      boardRows("This week")[1].querySelector(".leaderboard__rank-trophy"),
    ).toBeNull();
  });

  it("puts each player's best find in the window under their total", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Two numbers on the row, and they answer different questions: 41.2 is a
    // week of playing added up, 8.1 is how good the best day in it was.
    // `quixotic` is Alice's find this week, and it is priced from the
    // dictionary here rather than from the `windowZipf` the row carried, so
    // everyone holding the word shows the same number.
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");
    expect(boardRows("This week")[0]).toHaveTextContent("8.1");
    // The same player's best over the month is a different find, so the two
    // boards do not simply repeat one number.
    expect(boardRows(MONTH_BOARD)[1]).toHaveTextContent("8.4");

    // The word goes with its score, as it does on the app's board: the find a
    // player is proudest of is the word, not the number.
    expect(boardRows("This week")[0]).toHaveTextContent("quixotic · 8.1");
    expect(
      boardRows("This week")[0].querySelector(".leaderboard__best-word"),
    ).toHaveAttribute("title", "quixotic");
  });

  it("shows a Mythic-or-better find to two decimals, and the total to one", async () => {
    stubFetch({
      ...OPEN,
      weekly: [
        {
          rank: 1,
          playerId: ALICE,
          // Mythic on a measured frequency, where the top ranks are decided on
          // hundredths: at one decimal this and a 9.84 would print the same
          // number, and the shown value is what the rank itself keys off.
          windowWord: "caoutchouc",
          windowZipf: 1.07,
          score: 41.2,
          puzzles: 5,
        },
        {
          rank: 2,
          playerId: BOB,
          // A perfect score reads "10.00" rather than "10.0", the same as it
          // does on a badge in the game.
          windowWord: "enshittification",
          windowZipf: -1.57,
          score: 24.6,
          puzzles: 3,
        },
      ],
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows("This week")[0]).toHaveTextContent("9.81");
    expect(boardRows("This week")[1]).toHaveTextContent("10.00");
    // The total carries two decimals too: it is a sum of words priced to the
    // cent, so a tenth of it is a digit the player cannot account for.
    expect(boardRows("This week")[0]).toHaveTextContent("41.20");
  });

  it("shows a total's hundredths rather than rounding them into the tenth", async () => {
    stubFetch({
      ...OPEN,
      daily: [
        {
          rank: 1,
          playerId: ALICE,
          // 10 + 10 + 9.95 + 10: a day of three perfect finds and one priced a
          // nickel under. At one decimal the sum lands on the half and rounds
          // up to a flat 40, which is the number this board used to print and
          // no player could add their finds up to.
          windowWord: "togethership",
          windowZipf: -1.57,
          score: 39.95,
          puzzles: 1,
        },
      ],
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    expect(boardRows("Today")[0]).toHaveTextContent("39.95");
  });

  it("leaves the score off a find today's dictionary cannot price", async () => {
    stubFetch({
      ...OPEN,
      weekly: [
        {
          rank: 1,
          playerId: ALICE,
          // A word the dictionary has since dropped, on a row stored before
          // frequencies were kept: there is no score to show, and "0.0" would
          // read as a result rather than as the gap it is.
          windowWord: "zzzzzzzz",
          score: 41.2,
          puzzles: 5,
        },
      ],
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(1));
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");
    expect(boardRows("This week")[0]).not.toHaveTextContent("0.0");
    // The word itself is still a find worth showing; only its number is gone.
    expect(boardRows("This week")[0]).toHaveTextContent("zzzzzzzz");
  });

  it("says when the monthly board resets, and names no dates", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // The board is bounded to this month server-side, from a window the page
    // sends -- so the one thing left to say is the day it turns over, which is
    // the first of next month.
    const region = board(MONTH_BOARD);
    expect(region).toHaveTextContent(MONTH_BOARD);
    // The weekday first, then the date it falls on.
    expect(region).toHaveTextContent(/^This month\s*Resets \w+day, \w+ 1/);
    // What it used to say: a season, with the two hand-picked dates it ran
    // between under the name.
    expect(region).not.toHaveTextContent(/Season/);
    expect(region).not.toHaveTextContent(/–/);
  });

  it("makes each board's list reachable by keyboard, since it scrolls", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Five rows of the board are on screen and the rest are scrolled to, so
    // the list is a scrolling region -- and a region that only a thumb can
    // reach is one a keyboard cannot read.
    await waitFor(() =>
      expect(within(board("This week")).getByRole("list")).toHaveAttribute(
        "tabindex",
        "0",
      ),
    );
    expect(within(board(MONTH_BOARD)).getByRole("list")).toHaveAttribute(
      "tabindex",
      "0",
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
      expect(
        screen.getByText("Only puzzles played on the day they drop count"),
      ).toBeInTheDocument(),
    );
    const monthly = board(MONTH_BOARD);
    expect(monthly).not.toHaveTextContent(
      "Only puzzles played on the day they drop count",
    );
  });

  it("says a month counts each player's best 26 days", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() =>
      expect(screen.getByText("A month counts your best 26 days")).toBeInTheDocument(),
    );
  });

  it("says a week counts each player's best four days", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() =>
      expect(screen.getByText("A week counts your best 4 days of 7")).toBeInTheDocument(),
    );
  });

  it("says when the weekly board turns over, and no more than that", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    const region = board("This week");
    // Beside the heading, where the monthly board's own reset line sits, so the
    // two boards start level when they are side by side.
    expect(region).toHaveTextContent("Resets on Sundays");
    // No dates and no countdown: a week is the window you are already in, and
    // "this week" says which days it counts.
    expect(region).not.toHaveTextContent("From Sunday on");
    expect(region).not.toHaveTextContent(/Resets in \d/);
    expect(region).not.toHaveTextContent(/Aug \d+ – \d+/);
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
    await waitFor(() =>
      expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE)),
    );
    expect(rowMeta("This week", 0)).toBe("5 puzzles");
  });

  it("gives the same player the same name on both boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Whoever beat you this week is findable on the all-time board under the
    // same name -- derived from their id, so it cannot drift between the two.
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(boardRows(MONTH_BOARD)[1]).toHaveTextContent(handleFor(ALICE));
  });

  it("shows each board's own best find for every player", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The word a player is proudest of is on their row, as it is on the app's
    // board -- and it is the find inside *this* board's window, so the same
    // player can carry a different word on the week and on the month.
    await waitFor(() =>
      expect(boardRows(MONTH_BOARD)[0]).toHaveTextContent(handleFor(BOB)),
    );
    expect(rowMeta(MONTH_BOARD, 0)).toBe("40 puzzles");
    expect(boardRows(MONTH_BOARD)[0]).toHaveTextContent("inkling");
    expect(boardRows("This week")[0]).toHaveTextContent("quixotic");
    expect(boardRows(MONTH_BOARD)[1]).toHaveTextContent("asphyxiate");
    expect(boardRows(MONTH_BOARD)[1]).not.toHaveTextContent("quixotic");
  });

  it("counts the puzzles behind each score", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(rowMeta("This week", 0)).toContain("5 puzzles"));
    expect(rowMeta("This week", 1)).toContain("3 puzzles");
  });

  it("says what both numbers on the right of every row are", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // One header per board, over the column it labels. Every other figure on a
    // row says what it is in words; the scores, which are what the board is
    // ranked by, had been left to be inferred.
    await waitFor(() =>
      expect(screen.getAllByText("Total score")).toHaveLength(1),
    );
    // And the second figure in the same column gets the same treatment -- an
    // unlabelled number under a labelled one reads as a second total.
    expect(screen.getAllByText("Best find")).toHaveLength(1);

    // Stacked in the order the figures are, so the mapping is read straight
    // down rather than guessed. Asserted on the header's own text, since which
    // label belongs to which number is the whole point of the two lines.
    const header = screen.getAllByText("Total score")[0].parentElement;
    expect(header).toHaveTextContent(/^Total score\s*Best find$/);
  });

  it("marks the player's own row on both boards", async () => {
    const me = joinBoard();
    stubFetch({
      ...OPEN,
      weekly: [WEEKLY[0], { ...WEEKLY[1], playerId: me ?? "" }],
      allTime: [{ ...ALL_TIME[0], playerId: me ?? "" }, ALL_TIME[1]],
    });
    render(<LeaderboardPage />);

    await waitFor(() =>
      expect(boardRows("This week")[1]).toHaveTextContent("you"),
    );
    expect(boardRows(MONTH_BOARD)[0]).toHaveTextContent("you");
    expect(boardRows("This week")[0]).not.toHaveTextContent("you");
  });

  it("shows a player below the cut their own row, at their real rank", async () => {
    joinBoard();
    stubFetch({
      ...OPEN,
      weeklySelf: {
        rank: 61,
        playerId: CAROL,
        windowWord: "inkling",
        windowZipf: 2.9,
        score: 12,
        puzzles: 2,
      },
      allTimeSelf: {
        rank: 214,
        playerId: CAROL,
        windowWord: "quixotic",
        windowZipf: 2.33,
        score: 88,
        puzzles: 19,
      },
    });
    render(<LeaderboardPage />);

    // Last in the board's own list, docked to the bottom of it: the top stays
    // the top, and the player still gets an answer to "where am I".
    await waitFor(() => expect(boardRows("This week")).toHaveLength(3));
    const mine = boardRows("This week")[2];
    // The real rank, not a position inside what fits on screen.
    expect(mine).toHaveTextContent("61");
    expect(mine).toHaveTextContent("you");
    expect(boardRows(MONTH_BOARD)[2]).toHaveTextContent("214");
  });

  it("shows no extra row when the player is on the board", async () => {
    joinBoard();
    stubFetch();
    render(<LeaderboardPage />);

    // Nothing below the cut to show, so the board is just the board.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows(MONTH_BOARD)).toHaveLength(2);
  });

  it("counts one puzzle on the day board, and says when it turns over", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    // The shortest window the game has, and the one anybody can still win from
    // nothing: by Thursday a week's board is mostly a week's play.
    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    expect(
      within(board("Today")).getByText(
        "Resets at midnight",
      ),
    ).toBeInTheDocument();
    // Asked for as a date rather than derived from the week: a puzzle belongs
    // to the player's own local calendar day.
    const url = new URL(String(fetchMock.mock.calls[0][0]), "https://wordink.app");
    expect(url.searchParams.get("day")).toBe(todayDateString());
  });

  it("says so when nobody has scored on the day yet", async () => {
    stubFetch({ ...OPEN, daily: [] });
    render(<LeaderboardPage />);

    // A board everybody starts level on is empty every morning, which is an
    // invitation rather than a failure.
    expect(
      await screen.findByText("Nobody's scored yet today. Be first."),
    ).toBeInTheDocument();
  });

  it("asks for the week's board from its Sunday", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    const since =
      new URL(url, "https://wordink.app").searchParams.get("since") ?? "";
    // A Sunday, whatever day the test runs on.
    expect(new Date(`${since}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("offers a retry when the boards can't be loaded", async () => {
    const fetchMock = stubFetch(null);
    render(<LeaderboardPage />);

    expect(
      await screen.findByText(/Couldn't load the boards/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    // Counted by URL rather than by call: a load is two requests now, the
    // boards and the feed beside them, and it is the boards being retried.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => !String(url).includes("words=1"),
        ),
      ).toHaveLength(2),
    );
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
      row.classList.contains("leaderboard__row--you"),
    );
    expect(you).toHaveLength(1);
    expect(you[0].textContent).toContain(handleFor(ALICE));
  });

  it("says your handle under the page's title, so you know what to look for", async () => {
    localStorage.setItem("ick:player", JSON.stringify({ id: ALICE }));
    stubFetch();
    render(<LeaderboardPage />);

    // Above the boards and not waiting on them: the point of the line is that
    // it answers "which one am I" before there is a board to scan.
    expect(screen.getByText(/Playing as/)).toHaveTextContent(
      `Playing as ${handleFor(ALICE)}`,
    );
  });

  it("says nothing about a handle a browser without an id doesn't have", async () => {
    // No id in storage, as on a page rendered without Root above it. A name
    // derived from nothing would be a name that changes on the next open.
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(screen.queryByText(/Playing as/)).toBeNull();
  });

  it("asks for nothing: no call to action, and no explanation under it", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // The page is the boards and the finds. Everything that used to sit under
    // them -- the button, the paragraph about there being no account or email,
    // the count of imported puzzles -- reported a joining that now happens
    // before anybody gets here, silently, with nothing to announce.
    expect(
      screen.queryByRole("button", { name: "Put me on the board" }),
    ).toBeNull();
    expect(screen.queryByText(/No account, no email/)).toBeNull();
    expect(screen.queryByText(/Counted/)).toBeNull();
    expect(screen.queryByText(/Nothing to count/)).toBeNull();
  });
});

describe("leaving the page", () => {
  it("goes back to the puzzle from the foot of the page", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // The back arrow that used to sit in this page's own header is gone with
    // it: the header is the app's now, and its Play tab is the way home from
    // every page (see AppHeader).
    await userEvent.click(
      screen.getByRole("button", { name: "Back to today's puzzle" }),
    );
    expect(window.location.pathname).toBe("/");
  });
});


describe("keeping the boards current", () => {
  // Fake timers go up *before* render: the polling interval is created on mount,
  // and one scheduled against the real clock would never fire under a fake one.
  // advanceTimersByTimeAsync also flushes the promises each fetch settles
  // through, so it stands in for waitFor, which cannot run on a frozen clock.
  beforeEach(() => {
    // Over the suite's own advancing clock, which is why the real ones go back
    // up first: this block needs a frozen one.
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for nothing on a timer", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);
    const opened = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(180_000);

    // The boards are the request carrying this player's id, so they are the one
    // the CDN cannot share. Re-asking every minute would buy a rank that had
    // almost certainly not moved, at the price of a private query per open
    // page. The finds are the live half, and they are their own page now.
    expect(fetchMock.mock.calls.length).toBe(opened);
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
      }),
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
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1"))
        .length;
    const opened = boardCalls();

    const hidden = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
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
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1"))
        .length;
    const opened = boardCalls();

    const hidden = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    hidden.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    // Half a minute away is not new information, and the boards are this
    // player's own uncached query -- not something to put on a hair trigger.
    expect(boardCalls()).toBe(opened);
  });

  it("refreshes the boards past the cache when a reader taps refresh", async () => {
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

    const asked = fetchMock.mock.calls.slice(opened).map(([url]) => String(url));
    expect(asked.length).toBeGreaterThan(0);
    // Past the shared copy. A client cannot bust a CDN cache with a header, so
    // a different URL is the only thing that can, and without it the button
    // would hand back the standings the reader just told us are stale.
    expect(asked.every((url) => /&t=\d+/.test(url))).toBe(true);
  });

});

/**
 * Both boards are windows that move, and the reader can move them.
 *
 * The week and the month step independently, because they are two different
 * questions and comparing one against the other is the whole reason the page
 * carries two boards. Everything here is read on a Friday late in the month,
 * well inside both windows and clear of every congratulation (see `onDay`).
 */
describe("stepping the boards through past windows", () => {
  /** A Friday: this week starts Sunday the 23rd, and this month on the 1st. */
  const FRIDAY = "2026-08-28";
  const THIS_WEEK = "2026-08-23";
  const LAST_WEEK = "2026-08-16";
  const THIS_MONTH = "2026-08-01";
  const LAST_MONTH = "2026-07-01";

  /** One board row, so a window can be told apart by what it says. */
  const rowFor = (playerId: string, score: number) => [
    {
      rank: 1,
      playerId,
      windowWord: "quixotic",
      windowZipf: 2.33,
      score,
      puzzles: 4,
    },
  ];

  /**
   * Answer the boards per window, and record every window asked for.
   *
   * Keyed on the pair, because one request carries both boards: what is under
   * test is that the page asks for the windows the reader stepped to, and that
   * the board which did not move keeps the rows it had.
   */
  function stubWindows(
    perWindow: Record<string, { weekly?: unknown[]; allTime?: unknown[] }> = {},
    options: { fail?: string } = {},
    perDay: Record<string, unknown[]> = {},
  ) {
    const asked: string[] = [];
    /** Every day the reader's steps asked the day board for, in order. */
    const askedDays: string[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 202 });
      const href = String(url);
      const params = new URL(href, "http://x").searchParams;
      if (params.get("words") === "1") {
        return new Response(JSON.stringify({ words: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const key = `${params.get("since")}/${params.get("month")}`;
      asked.push(key);
      askedDays.push(params.get("day") ?? "");
      if (key === options.fail) return new Response("nope", { status: 502 });
      const body = perWindow[key] ?? {};
      return new Response(
        JSON.stringify({
          weekStart: params.get("since"),
          daily: perDay[params.get("day") ?? ""] ?? [],
          weekly: body.weekly ?? [],
          allTime: body.allTime ?? [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, asked, askedDays };
  }

  /** A board's step button, picking that board with the pills first. */
  const step = (name: string) => {
    const unit = /day|week|month/i.exec(name)?.[0] ?? "day";
    if (!screen.queryByRole("button", { name })) {
      fireEvent.click(
        screen.getByRole("button", { name: unit[0].toUpperCase() + unit.slice(1) }),
      );
    }
    return screen.getByRole("button", { name });
  };

  beforeEach(() => onDay(FRIDAY));

  it("steps the day board a puzzle at a time, without moving the two beside it", async () => {
    const YESTERDAY = "2026-08-27";
    const { asked, askedDays } = stubWindows(
      { [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) } },
      {},
      {
        [FRIDAY]: rowFor(ALICE, 9.4),
        [YESTERDAY]: rowFor(BOB, 7.1),
      },
    );
    render(<LeaderboardPage />);
    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));

    await userEvent.click(step("Previous day"));

    // The day's own date once it is not today's, and the board under it is that
    // day's final standing.
    await waitFor(() =>
      expect(boardRows("Aug 27")[0]).toHaveTextContent(handleFor(BOB)),
    );
    expect(
      within(board("Aug 27")).getByText("Final"),
    ).toBeInTheDocument();
    expect(askedDays).toEqual([FRIDAY, YESTERDAY]);
    // The long windows did not move: a day is not a week's worth of anything,
    // and stepping one says nothing about the other two.
    expect(new Set(asked)).toEqual(new Set([`${THIS_WEEK}/${THIS_MONTH}`]));
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));

    await userEvent.click(step("Next day"));
    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    // And no step past the puzzle being played, which has not happened yet.
    expect(step("Next day")).toBeDisabled();
  });

  it("asks for the week the reader stepped back to, and walks forward again", async () => {
    const { asked } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
      [`${LAST_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(BOB, 33.1) },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(within(board("This week")).getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous week"));

    // The heading moves with the rows: a window's standings must never sit
    // under the name of a different window.
    await waitFor(() =>
      expect(
        board("Week of Aug 16"),
      ).toBeTruthy(),
    );
    expect(boardRows("Week of Aug 16")[0].textContent).toContain(
      handleFor(BOB),
    );
    expect(screen.queryByText(handleFor(ALICE))).toBeNull();

    // And forward, back to the window the page opened on.
    fireEvent.click(step("Next week"));
    await waitFor(() =>
      expect(board("This week")).toBeTruthy(),
    );
    expect(boardRows("This week")[0].textContent).toContain(handleFor(ALICE));
    expect(asked).toEqual([
      `${THIS_WEEK}/${THIS_MONTH}`,
      `${LAST_WEEK}/${THIS_MONTH}`,
      `${THIS_WEEK}/${THIS_MONTH}`,
    ]);
  });

  it("steps the month without moving the week beside it", async () => {
    const { asked } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
      [`${THIS_WEEK}/${LAST_MONTH}`]: {
        weekly: rowFor(ALICE, 41.2),
        allTime: rowFor(BOB, 310.5),
      },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(within(board("This week")).getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous month"));

    await waitFor(() =>
      expect(board("July 2026")).toBeTruthy(),
    );
    // The two windows are independent: only the month moved.
    expect(board("This week")).toBeTruthy();
    expect(asked).toEqual([
      `${THIS_WEEK}/${THIS_MONTH}`,
      `${THIS_WEEK}/${LAST_MONTH}`,
    ]);
  });

  it("offers no step past the window the first puzzle fell in", async () => {
    stubWindows();
    render(<LeaderboardPage />);
    await waitFor(() => expect(step("Previous month")).toBeEnabled());

    // The game's first puzzle was 2026-07-01, so July is the first month there
    // could ever be a score in.
    fireEvent.click(step("Previous month"));
    await waitFor(() =>
      expect(board("July 2026")).toBeTruthy(),
    );
    expect(step("Previous month")).toBeDisabled();
  });

  it("offers no step forward from the window being played", async () => {
    stubWindows();
    render(<LeaderboardPage />);

    // Both boards open on the live window, which is as far forward as there is.
    await waitFor(() => expect(step("Next week")).toBeDisabled());
    expect(step("Next month")).toBeDisabled();
  });

  it("holds the board's height while another window loads, and leaves the other board alone", async () => {
    let release: (() => void) | null = null;
    const { fetchMock } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: {
        weekly: rowFor(ALICE, 41.2),
        allTime: rowFor(BOB, 310.5),
      },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(within(board("This week")).getByText(handleFor(ALICE))).toBeTruthy(),
    );

    // The next boards request hangs, so the step can be looked at mid-flight.
    const answered = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("words=1") || init?.method === "POST")
        return answered(url, init);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answered(url, init);
    });

    fireEvent.click(step("Previous week"));

    // Rows rather than a spinner, so the page does not collapse under the
    // button that was just pressed.
    await waitFor(() =>
      expect(
        document.querySelectorAll(".leaderboard__row--placeholder").length,
      ).toBeGreaterThan(0),
    );
    // And the board that did not move still says what it said.
    expect(
      within(board(MONTH_BOARD)).getByText(
        handleFor(BOB),
      ),
    ).toBeTruthy();
    await act(async () => {
      release?.();
    });
  });

  it("puts a window already read straight back, and re-reads it underneath", async () => {
    let release: (() => void) | null = null;
    const { fetchMock, asked } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
      [`${LAST_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(BOB, 38.0) },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE)),
    );
    await userEvent.click(step("Previous week"));
    await waitFor(() => expect(asked).toHaveLength(2));
    await waitFor(() =>
      expect(document.querySelectorAll(".leaderboard__row--placeholder")).toHaveLength(0),
    );

    // The check on the way back hangs, so what is on screen before it lands is
    // only what the page remembered.
    const answered = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("words=1") || init?.method === "POST")
        return answered(url, init);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answered(url, init);
    });
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(step("Next week"));

    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(
      document.querySelectorAll(".leaderboard__row--placeholder"),
    ).toHaveLength(0);
    // Still asked: a past window can move, and this is how it would show.
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await act(async () => {
      release?.();
    });
  });

  it("opens on the boards it showed last time, coming back to the page", async () => {
    const { fetchMock } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
    });
    const { unmount } = render(<LeaderboardPage />);
    await waitFor(() =>
      expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE)),
    );
    unmount();
    const callsBefore = fetchMock.mock.calls.length;

    render(<LeaderboardPage />);
    expect(boardRows("This week")[0]).toHaveTextContent(handleFor(ALICE));
    expect(screen.queryByText("Loading the boards…")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("offers a retry on the board whose window would not load", async () => {
    stubWindows(
      {
        [`${THIS_WEEK}/${THIS_MONTH}`]: {
          weekly: rowFor(ALICE, 41.2),
          allTime: rowFor(BOB, 310.5),
        },
      },
      { fail: `${LAST_WEEK}/${THIS_MONTH}` },
    );
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(within(board("This week")).getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous week"));

    // Named for the board it belongs to: the page carries three retries now.
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Try loading the week board again",
        }),
      ).toBeTruthy(),
    );
    // The failure is that board's, not the page's: the month is untouched and
    // the page never falls back to "Couldn't load the boards."
    expect(screen.queryByText(/Couldn't load the boards/)).toBeNull();
    expect(
      within(board(MONTH_BOARD)).getByText(
        handleFor(BOB),
      ),
    ).toBeTruthy();
  });
});

describe("picking a board", () => {
  it("shows one board at a time, picked with the pills, starting on the day", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    // The other two are not merely scrolled past -- they are not on the page,
    // which is the difference between this and the stacked layout it replaces.
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull();
    expect(screen.queryByRole("region", { name: MONTH_BOARD })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(boardRows("This week")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Today" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(within(board(MONTH_BOARD)).getByText(
      handleFor(BOB),
    )).toBeTruthy();
  });

  it("says which window is showing", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("offers a Streak pill only when the server sent a streak board", async () => {
    stubFetch({ ...OPEN, streak: [], streakSelf: null });
    const { unmount } = render(<LeaderboardPage />);
    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Streak" })).toBeTruthy();
    unmount();

    stubFetch();
    render(<LeaderboardPage />);
    await waitFor(() => expect(boardRows("Today")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Streak" })).toBeNull();
  });
});

describe("which of the two boards it reads", () => {
  afterEach(() => {
    setDevDateOverride(null);
    resetModeCache();
  });

  it("has no picker of its own, and no line about the split", async () => {
    // The header's switch is the one control for the mode; a second copy on
    // this page said the same thing twice.
    setDevDateOverride(MODE_CHOICE_START);
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(screen.getByText(/played on the day they drop/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Standard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Freeform" })).toBeNull();
    expect(screen.queryByText(/each mode has its own board/i)).not.toBeInTheDocument();
  });

  it("follows the mode switched elsewhere", async () => {
    setDevDateOverride(MODE_CHOICE_START);
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(lastOf(boardUrls(fetchMock))).toContain("mode=standard");

    act(() => setMode("freeform"));

    // A different board is a different set of numbers, so all three windows are
    // re-read rather than relabelled.
    await waitFor(() =>
      expect(lastOf(boardUrls(fetchMock))).toContain("mode=freeform"),
    );
  });
});
