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
import { previousMonthName, todayDateString } from "../game/date";

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

/**
 * The plaque under one board, by the board's heading.
 *
 * The element and not the whole board region: a champion is very often also a
 * live row on the board above their own plaque, so "the board does not mention
 * this player" is never the assertion wanted -- it is "the plaque does not name
 * them", and only the plaque can answer that.
 */
function plaque(heading: string) {
  return within(screen.getByRole("region", { name: heading })).getByText(
    (_, element) =>
      element?.classList.contains("leaderboard__champion") ?? false,
  );
}

/** The rows of one board, by its heading. */
function boardRows(heading: string) {
  return within(screen.getByRole("region", { name: heading })).getAllByRole(
    "listitem",
  );
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
 * The plaques under the boards depend on which day they are read on: on the day
 * a window turned over the name it carries can still change, because that window
 * closes at a different moment for every player (see game/week.ts), and the
 * plaque says so. So a test about a plaque has to fix the day, or it passes six
 * days out of seven and fails on the one nobody runs the suite on.
 *
 * Local noon rather than midnight, so the calendar date is the same one in every
 * timezone the suite might run in -- the page reads the player's local date, and
 * a midnight instant lands on the day before for half the world.
 */
function onDay(date: string) {
  // Timers keep advancing on their own: the page polls and waits, and a clock
  // frozen solid would hang every `waitFor` in the test.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${date}T12:00:00`));
}

/** A day in the middle of both windows, where every plaque is final. */
const MIDWEEK = "2026-08-26";
/** A Sunday: the weekly board's window turned over this morning. */
const SUNDAY = "2026-08-30";
/** The first, and a Tuesday -- so only the monthly plaque is provisional. */
const FIRST_OF_MONTH = "2026-09-01";

beforeEach(() => {
  localStorage.clear();
  window.history.pushState(null, "", "/leaderboard");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

    const monthly = boardRows(MONTH_BOARD);
    // A different order from the weekly board, which is the point of both.
    expect(monthly[0]).toHaveTextContent(handleFor(BOB));
    expect(monthly[0]).toHaveTextContent("310.5");
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

    // The word itself stays off the row. It is on the page under Today's finds,
    // where it belongs to the day rather than standing as a claim about a
    // player -- and unlabelled numbers are what the column is.
    expect(boardRows("This week")[0]).not.toHaveTextContent("quixotic");
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
    // The total is a sum and keeps its single decimal -- the two-decimal rule
    // is about one word's score, which is the line `formatScore` draws.
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");
  });

  it("leaves the line off a find today's dictionary cannot price", async () => {
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
  });

  it("names last week's champion under the weekly board, and last month's under the monthly one", async () => {
    // Midweek, where both windows closed days ago and both plaques are final.
    onDay(MIDWEEK);
    stubFetch({
      ...OPEN,
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
      lastMonth: {
        rank: 1,
        playerId: CAROL,
        windowWord: "abaci",
        windowZipf: 2.65,
        score: 214.8,
        puzzles: 28,
      },
    });
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // Both boards above are windows that move -- this week resets on Sunday --
    // so the closed window's winner is the only record anywhere that they won.
    const weekly = screen.getByRole("region", { name: "This week" });
    expect(weekly).toHaveTextContent("Last week's champion");
    expect(weekly).toHaveTextContent(handleFor(BOB));
    expect(weekly).toHaveTextContent("61.2");

    // Under the monthly board, the plaque is that board's own window one step
    // back -- the same relation last week's champion has to the weekly board.
    const monthlyBoard = screen.getByRole("region", { name: MONTH_BOARD });
    // Named by month rather than dated: "July's champion" places instantly.
    expect(monthlyBoard).toHaveTextContent(
      `${previousMonthName(todayDateString())}'s champion`,
    );
    expect(monthlyBoard).toHaveTextContent(handleFor(CAROL));
    expect(monthlyBoard).toHaveTextContent("214.8");
  });

  it("keeps a champion out of the ranked rows they are not competing in", async () => {
    stubFetch({
      ...OPEN,
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
    });
    render(<LeaderboardPage />);

    // Still two rows: last week's winner sits under the board, not in it, or a
    // reader would take them for this week's third place.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
  });

  it("holds the plaque open when nobody won the window, and says when it fills", async () => {
    onDay(MIDWEEK);
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // A first week, or a month before the game existed. The plaque still goes
    // down on both boards -- with nothing invented in the place a winner will
    // go, because an absent one ended the two columns unlevel and read as a
    // load failure.
    //
    // What it says is the day it gets engraved, which is the question an empty
    // box actually raises. Each board's answer is the same for every window it
    // will ever name, so this is one constant per board and not a date.
    for (const [heading, when] of [
      ["This week", "on Monday"],
      [MONTH_BOARD, "on the 2nd"],
    ]) {
      expect(plaque(heading)).toHaveTextContent(`Crowned ${when}`);
      expect(plaque(heading)).toHaveTextContent(`Champion crowned ${when}`);
    }
    expect(screen.queryByText(/'s champion/)).toBeNull();
  });

  it("still names last week's winner on a week nobody has scored in yet", async () => {
    onDay(MIDWEEK);
    stubFetch({
      ...OPEN,
      weekly: [],
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
    });
    render(<LeaderboardPage />);

    // The empty board is exactly when the champion is the only thing there is
    // to show -- and the week that just ended is why it is empty.
    const weekly = await screen.findByRole("region", { name: "This week" });
    expect(weekly).toHaveTextContent("Last week's champion");
    expect(weekly).toHaveTextContent(handleFor(BOB));
  });

  it("names last week's winner on Sunday, with the caveat behind an i", async () => {
    onDay(SUNDAY);
    stubFetch({
      ...OPEN,
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
      lastMonth: {
        rank: 1,
        playerId: CAROL,
        windowWord: "abaci",
        windowZipf: 2.65,
        score: 214.8,
        puzzles: 28,
      },
    });
    render(<LeaderboardPage />);

    // Sunday is the day the week's result is the freshest thing on the page, so
    // it is named in full like every other day -- the plaque used to go blank
    // here, and a player coming back for their own win found an empty box.
    await screen.findByRole("region", { name: "This week" });
    const weekly = plaque("This week");
    expect(weekly).toHaveTextContent(handleFor(BOB));
    expect(weekly).toHaveTextContent("61.2");

    // What Sunday adds is the caveat, not a silence: the week closed at each
    // player's own midnight and the last of those is the better part of a day
    // after the first, so this name can still change. Folded behind the "i",
    // because it is the right name for almost everybody reading it.
    const why = within(weekly).getByRole("button", {
      name: "Why this winner can still change",
    });
    expect(why).toHaveAttribute("aria-expanded", "false");
    // Read from the element rather than the plaque's text: the sentence is in
    // the markup unopened too, so a screen reader never has to press anything
    // for it. Closed means visually hidden, not absent.
    const note = weekly.querySelector(".leaderboard__champion-note");
    expect(note).toHaveTextContent(
      "Not everyone has finished playing yet. The official winner can change until Monday.",
    );
    expect(note).toHaveClass("sr-only");

    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(note).not.toHaveClass("sr-only");

    // Only the weekly window turned over today, so the monthly plaque is as
    // final as it was yesterday and carries no caveat at all.
    const monthly = plaque(MONTH_BOARD);
    expect(monthly).toHaveTextContent(handleFor(CAROL));
    expect(monthly).toHaveTextContent("214.8");
    expect(
      within(monthly).queryByRole("button", {
        name: "Why this winner can still change",
      }),
    ).toBeNull();
  });

  it("names the winner with no caveat on the days it cannot change", async () => {
    // Midweek: last week closed on Saturday and every clock on earth agrees
    // about it, so there is nothing left to footnote. An "i" sitting on the
    // plaque all week would say "can change until Monday" on a Wednesday, which
    // is simply false -- and would train a reader past noticing it on Sunday.
    onDay(MIDWEEK);
    stubFetch({
      ...OPEN,
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
    });
    render(<LeaderboardPage />);

    await screen.findByRole("region", { name: "This week" });
    const weekly = plaque("This week");
    expect(weekly).toHaveTextContent(handleFor(BOB));
    expect(
      within(weekly).queryByRole("button", {
        name: "Why this winner can still change",
      }),
    ).toBeNull();
    expect(weekly).not.toHaveTextContent("can change until");
  });

  it("marks the monthly plaque provisional on the first, and only that one", async () => {
    onDay(FIRST_OF_MONTH);
    stubFetch({
      ...OPEN,
      lastMonth: {
        rank: 1,
        playerId: CAROL,
        windowWord: "abaci",
        windowZipf: 2.65,
        score: 214.8,
        puzzles: 28,
      },
      lastWeek: {
        rank: 1,
        playerId: BOB,
        windowWord: "wrinkle",
        windowZipf: 3.31,
        score: 61.2,
        puzzles: 7,
      },
    });
    render(<LeaderboardPage />);

    // The same caveat, one window up, and its own day to say it on. A Tuesday,
    // so the weekly plaque is untouched and the two rules are visibly separate.
    await screen.findByRole("region", { name: MONTH_BOARD });
    const monthly = plaque(MONTH_BOARD);
    expect(monthly).toHaveTextContent(handleFor(CAROL));
    expect(monthly).toHaveTextContent("214.8");
    fireEvent.click(
      within(monthly).getByRole("button", {
        name: "Why this winner can still change",
      }),
    );
    // The month's deadline, not the week's: one constant per board.
    expect(
      monthly.querySelector(".leaderboard__champion-note"),
    ).toHaveTextContent("can change until the 2nd.");

    const weekly = plaque("This week");
    expect(weekly).toHaveTextContent(handleFor(BOB));
    expect(
      within(weekly).queryByRole("button", {
        name: "Why this winner can still change",
      }),
    ).toBeNull();
  });

  it("says when the plaque fills on a turnover day nobody has won", async () => {
    onDay(SUNDAY);
    stubFetch();
    render(<LeaderboardPage />);

    // No champion in the response and it is Sunday. The empty plaque is left to
    // the one thing it is true of -- a window nobody won -- and says the day it
    // gets engraved, which is the question an empty box raises. There is no
    // name here to footnote, so no "i" either.
    await screen.findByRole("region", { name: "This week" });
    const weekly = plaque("This week");
    expect(weekly).toHaveTextContent("Crowned on Monday");
    expect(
      within(weekly).queryByRole("button", {
        name: "Why this winner can still change",
      }),
    ).toBeNull();
  });

  it("says when the monthly board resets, and names no dates", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    // The board is bounded to this month server-side, from a window the page
    // sends -- so the one thing left to say is the day it turns over, which is
    // the first of next month.
    const board = screen.getByRole("region", { name: MONTH_BOARD });
    expect(board).toHaveTextContent(MONTH_BOARD);
    // The weekday first, then the date it falls on.
    expect(board).toHaveTextContent(/^This month\s*Resets \w+day, \w+ 1/);
    // What it used to say: a season, with the two hand-picked dates it ran
    // between under the name.
    expect(board).not.toHaveTextContent(/Season/);
    expect(board).not.toHaveTextContent(/–/);
  });

  it("makes each board's list reachable by keyboard, since it scrolls", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // Five rows of the fifteen are on screen and the rest are scrolled to, so
    // the list is a scrolling region -- and a region that only a thumb can
    // reach is one a keyboard cannot read.
    await waitFor(() =>
      expect(screen.getByRole("list", { name: /This week/ })).toHaveAttribute(
        "tabindex",
        "0",
      ),
    );
    expect(
      screen.getByRole("list", { name: new RegExp(MONTH_BOARD) }),
    ).toHaveAttribute("tabindex", "0");
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
    const monthly = screen.getByRole("region", { name: MONTH_BOARD });
    expect(monthly).not.toHaveTextContent(
      "Only puzzles played on the day they drop count",
    );
  });

  it("says when the weekly board turns over, and no more than that", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    const board = screen.getByRole("region", { name: "This week" });
    // Beside the heading, where the monthly board's own reset line sits, so the
    // two boards start level when they are side by side.
    expect(board).toHaveTextContent("Resets on Sundays");
    // No dates and no countdown: a week is the window you are already in, and
    // "this week" says which days it counts.
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

  it("keeps every player's find off both boards", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    // A find is shown with what it scored, and the scoring system is still being
    // corrected -- so the words stay under Today's finds and the boards say only
    // what somebody played and what it added up to.
    await waitFor(() =>
      expect(boardRows(MONTH_BOARD)[0]).toHaveTextContent(handleFor(BOB)),
    );
    expect(rowMeta(MONTH_BOARD, 0)).toBe("40 puzzles");
    expect(boardRows(MONTH_BOARD)[0]).not.toHaveTextContent("inkling");
    expect(boardRows("This week")[0]).not.toHaveTextContent("quixotic");
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
      expect(screen.getAllByText("Total score")).toHaveLength(2),
    );
    // And the second figure in the same column gets the same treatment -- an
    // unlabelled number under a labelled one reads as a second total.
    expect(screen.getAllByText("Best find")).toHaveLength(2);

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

  it("still shows the finds when only the boards fail", async () => {
    // Two requests, and only one of them broken. They are separate on purpose
    // (the boards carry a player id and the feed does not), so they fail
    // separately too.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(null, { status: 202 });
        if (!String(url).includes("words=1"))
          return new Response("nope", { status: 502 });
        return new Response(JSON.stringify({ words: WORDS }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<LeaderboardPage />);

    // The boards say so, and the feed underneath is unaffected -- hiding words
    // that arrived perfectly well would be losing the half of the page that
    // still works.
    expect(
      await screen.findByText(/Couldn't load the boards/),
    ).toBeInTheDocument();
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
      row.classList.contains("leaderboard__row--you"),
    );
    expect(you).toHaveLength(1);
    expect(you[0].textContent).toContain(handleFor(ALICE));
  });

  it("says your handle in the header, so you know what to look for", async () => {
    localStorage.setItem("ick:player", JSON.stringify({ id: ALICE }));
    stubFetch();
    render(<LeaderboardPage />);

    // Above the boards and not waiting on them: the point of the line is that
    // it answers "which one am I" before there is a board to scan.
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent(`Playing as ${handleFor(ALICE)}`);
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
  it("goes back to the puzzle from the header and the footer", async () => {
    stubFetch();
    render(<LeaderboardPage />);

    await userEvent.click(
      screen.getByRole("button", { name: "Back to the puzzle" }),
    );
    expect(window.location.pathname).toBe("/");

    window.history.pushState(null, "", "/leaderboard");
    await userEvent.click(
      screen.getByRole("button", { name: "Back to today's puzzle" }),
    );
    expect(window.location.pathname).toBe("/");
  });
});

describe("recent finds", () => {
  /** The words feed's list items. */
  function finds() {
    return within(
      screen.getByRole("region", { name: "Today's finds" }),
    ).getAllByRole("listitem");
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
    // text runs together as "8.43 players", where a substring match would pass
    // for a number never displayed.
    await waitFor(() => expect(finds()[0]).toHaveTextContent("EXTREMELY RARE"));
    expect(finds()[0].querySelector(".rarity-badge__score")?.textContent).toBe(
      "8.4",
    );
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
    const section = await screen.findByRole("region", {
      name: "Today's finds",
    });
    expect(
      section.querySelector(".found-words__drop")?.textContent,
    ).toBeTruthy();
    // And nothing under the heading restating it.
    expect(
      screen.queryByText("Every word found on today's puzzle."),
    ).toBeNull();
  });

  it("shows the feed even when nobody is on the boards yet", async () => {
    stubFetch({
      weekStart: "2026-08-23",
      weekly: [],
      allTime: [],
      words: WORDS,
    });
    render(<LeaderboardPage />);

    // The feed works from the first word, which is what makes an empty board
    // safe to show: the page is never empty while the boards fill up.
    await waitFor(() => expect(finds()).toHaveLength(2));
    expect(
      screen.getByRole("region", { name: "This week" }),
    ).toBeInTheDocument();
  });

  it("says so plainly when nobody has found anything today", async () => {
    // A pinned day with somewhere to step back to: past the finds epoch and
    // past this week's reset, so the feed's floor sits behind it. The empty
    // section only survives when there is an earlier day to reach (see the
    // Sunday case below), so reading the clock instead of setting it makes this
    // test pass or fail on whichever day CI happens to run -- which is how it
    // broke when a Sunday came around.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 9, 0, 0));
    try {
      stubFetch({ ...OPEN, words: [] });
      render(<LeaderboardPage />);

      // The section stays, because it now carries the way back through the week
      // -- and an empty morning is exactly when yesterday's finds are the thing
      // worth reaching. What used to be a missing section is one sentence.
      expect(
        await vi.waitFor(() =>
          screen.getByText("Nobody's found anything yet today."),
        ),
      ).toBeInTheDocument();
      expect(
        within(
          screen.getByRole("region", { name: "Today's finds" }),
        ).queryAllByRole("listitem"),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the section away entirely when there is nowhere to go and nothing to show", async () => {
    // A Sunday: the week reset this morning, so there is no earlier day of it
    // to step back to, and an empty section with a heading and two dead buttons
    // would be worse than no section.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 9, 0, 0));
    try {
      stubFetch({ ...OPEN, words: [] });
      render(<LeaderboardPage />);
      await vi.waitFor(() => expect(boardRows("This week")).toHaveLength(2));
      expect(
        screen.queryByRole("region", { name: "Today's finds" }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
    return within(
      screen.getByRole("region", { name: "Today's finds" }),
    ).getAllByRole("listitem");
  }

  it("marks a word that turned up since the last look, and puts it on top", async () => {
    let words = [
      { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...OPEN, words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
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
    // A word nobody had seen opens a row for itself, which is the animation
    // that says so -- not the glow-and-travel a re-found word gets.
    expect(finds()[0].className).toContain("--arrived");
    expect(finds()[0].className).not.toContain("refound");
    // The word that was already there is not re-announced.
    expect(finds()[1].className).not.toContain("arrived");
  });

  it("marks a word somebody else has now found, back on top with its count up", async () => {
    // The feed is ordered on a word's most recent sighting, so a word already on
    // screen returns to the top when a new player finds it. That is the same
    // event as a new word landing and gets the same animation -- otherwise the
    // row that just travelled the length of the list would look untouched.
    let words = [
      { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" },
      { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-08-25" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...OPEN, words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<LeaderboardPage />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(finds()[0]).toHaveTextContent("inkling");

    words = [
      { word: "asphyxiate", zipf: 2.09, finders: 2, foundOn: "2026-08-25" },
      { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" },
    ];
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));

    expect(finds()[0]).toHaveTextContent("asphyxiate");
    expect(finds()[0]).toHaveTextContent("2 players");
    // Glowing, but as a word that travelled rather than one that appeared: the
    // arrival animation opens a row's height from nothing, which is the one
    // thing a row already on screen is not doing.
    expect(finds()[0].className).toContain("refound");
    expect(finds()[0].className).not.toContain("--arrived");
    // The one it pushed down is unchanged and says nothing.
    expect(finds()[1].className).not.toContain("refound");
    expect(finds()[1].className).not.toContain("--arrived");
  });

  it("stops marking it once the arrival has played", async () => {
    let words = [
      { word: "inkling", zipf: 2.9, finders: 1, foundOn: "2026-08-25" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...OPEN, words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<LeaderboardPage />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));

    words = [
      { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-08-25" },
      ...words,
    ];
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(finds()[0].className).toContain("arrived");

    // Otherwise an unrelated re-render would replay the animation later. Held
    // until the longest animation has finished -- see the timeout in the page.
    await act(async () => void (await vi.advanceTimersByTimeAsync(2800)));
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
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("words=1"))
        .length;
    const opened = boardCalls();

    await vi.advanceTimersByTimeAsync(180_000);

    // The boards are the request carrying this player's id, so they are the one
    // the CDN cannot share. Re-asking every minute would buy a rank that had
    // almost certainly not moved, at the price of a private query per open page.
    expect(boardCalls()).toBe(opened);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("words=1"))
        .length,
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
    const polled = fetchMock.mock.calls
      .slice(opened)
      .map(([url]) => String(url));
    expect(polled.length).toBeGreaterThan(0);
    expect(polled.every((url) => !url.includes("&t="))).toBe(true);
  });

  it("stops polling while the tab is hidden, and catches up on return", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardPage />);
    await vi.advanceTimersByTimeAsync(0);

    const hidden = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
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

/*
 * Stepping the feed back through the week.
 *
 * A day's finds used to be gone at the reader's own midnight, so anybody who
 * opened the page in the morning had missed them -- and the words are the part
 * of this page people come back for. Back as far as the week's reset, which is
 * the same window the board above the feed ranks.
 */
describe("earlier days of the week", () => {
  // A Wednesday, so the week's Sunday is three steps back and there is room to
  // hit the floor without leaving the week. Well clear of the first day any find
  // was recorded (2026-08-26), so the reset is the bound under test here rather
  // than that one, which has a test of its own below.
  const WEDNESDAY = new Date(2026, 8, 16, 9, 0, 0);
  const TODAY = "2026-09-16";
  const TUESDAY = "2026-09-15";
  const SUNDAY = "2026-09-13";

  const YESTERDAY_WORDS = [{ word: "linkboy", zipf: 1.4, finders: 2 }];

  /** Answer the feed per day, and record which days were asked for. */
  function stubDays(perDay: Record<string, unknown[]> = {}) {
    const asked: string[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 202 });
      const href = String(url);
      if (href.includes("words=1")) {
        const day = new URL(href, "http://x").searchParams.get("today") ?? "";
        asked.push(day);
        return new Response(JSON.stringify({ words: perDay[day] ?? [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(OPEN), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, asked };
  }

  const back = () =>
    screen.getByRole("button", { name: "Finds from the day before" });
  const forward = () =>
    screen.getByRole("button", { name: "Finds from the day after" });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(WEDNESDAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the day before, headed with its own date and drop", async () => {
    const { asked } = stubDays({
      [TODAY]: WORDS,
      [TUESDAY]: YESTERDAY_WORDS,
    });
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    fireEvent.click(back());

    // The heading moves with the list: the drop is what makes a find mean
    // anything, so a word can never sit under another day's heading.
    await vi.waitFor(() => expect(screen.getByText("linkboy")).toBeTruthy());
    const section = screen.getByRole("region", { name: "Finds from Sep 15" });
    expect(within(section).getByText("linkboy")).toBeTruthy();
    expect(screen.queryByText("asphyxiate")).toBeNull();
    expect(asked).toEqual([TODAY, TUESDAY]);
  });

  it("asks for nothing until somebody presses back", async () => {
    const { asked } = stubDays();
    render(<LeaderboardPage />);

    // One day fetched on open, and it is today's. A reader who never steps back
    // costs exactly what they cost before this existed.
    await vi.waitFor(() => expect(asked).toEqual([TODAY]));
  });

  it("stops at the week's reset", async () => {
    stubDays();
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(back()).toBeEnabled());

    // Wednesday back to Sunday, and no further: the feed is the week the board
    // above it ranks, not an archive of the game.
    fireEvent.click(back());
    fireEvent.click(back());
    fireEvent.click(back());
    await vi.waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Finds from Sep 13" }),
      ).toBeTruthy(),
    );
    expect(back()).toBeDisabled();
    expect(SUNDAY).toBe("2026-09-13");
  });

  it("offers no step back past the first day any find was recorded", async () => {
    // The finds table is younger than the game. On the first day it holds, the
    // week's reset is still three days further back -- and every one of those
    // days would answer "nobody found anything on this puzzle", which is a
    // sentence about the schema rather than about the players.
    vi.setSystemTime(new Date(2026, 7, 26, 9, 0, 0));
    const { asked } = stubDays({ "2026-08-26": WORDS });
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    expect(asked).toEqual(["2026-08-26"]);
    expect(back()).toBeDisabled();
    fireEvent.click(back());
    expect(asked).toEqual(["2026-08-26"]);
  });

  it("walks forward again, and stops on today", async () => {
    stubDays({ [TUESDAY]: YESTERDAY_WORDS });
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(forward()).toBeDisabled());

    fireEvent.click(back());
    await vi.waitFor(() => expect(forward()).toBeEnabled());
    fireEvent.click(forward());

    await vi.waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Today's finds" }),
      ).toBeTruthy(),
    );
    // Today is the end of the road forward; there is no puzzle past it.
    expect(forward()).toBeDisabled();
  });

  it("holds the list's height while the next day loads", async () => {
    // Nothing resolves, so the page stays in the moment between the press and
    // the answer -- which is the only moment this is about.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(null, { status: 202 });
        if (String(url).includes("words=1"))
          return new Response(JSON.stringify({ words: WORDS }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        return new Response(JSON.stringify(OPEN), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    fireEvent.click(back());

    // Rows rather than a spinner: what a reader notices in that moment is the
    // page jumping under their thumb, not a missing message.
    const placeholders = document.querySelectorAll(
      ".found-words__item--placeholder",
    );
    expect(placeholders.length).toBeGreaterThanOrEqual(WORDS.length);
  });

  it("leaves a finished day alone rather than polling it", async () => {
    const { asked } = stubDays({ [TUESDAY]: YESTERDAY_WORDS });
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(asked).toEqual([TODAY]));

    fireEvent.click(back());
    await vi.waitFor(() => expect(asked).toEqual([TODAY, TUESDAY]));

    // No score can ever be added to a past puzzle -- the game refuses one -- so
    // a poll here is a request a minute to be handed the same rows back.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(asked).toEqual([TODAY, TUESDAY]);
  });

  it("does not animate a day the reader asked for", async () => {
    stubDays({ [TODAY]: WORDS, [TUESDAY]: YESTERDAY_WORDS });
    render(<LeaderboardPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    fireEvent.click(back());
    await vi.waitFor(() => expect(screen.getByText("linkboy")).toBeTruthy());

    // The arrival flash means "this turned up while you were looking". A whole
    // day appearing because a button was pressed is not that.
    expect(document.querySelector(".found-words__item--arrived")).toBeNull();
  });
});

/**
 * Both boards are windows that move, and the reader can move them.
 *
 * The week and the month step independently, because they are two different
 * questions and comparing one against the other is the whole reason the page
 * carries two boards. Everything here is read on a midweek Wednesday, well
 * inside both windows, so no plaque is being held (see `onDay`).
 */
describe("stepping the boards through past windows", () => {
  /** A Wednesday: this week starts Sunday the 23rd, and this month on the 1st. */
  const WEDNESDAY = "2026-08-26";
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
  ) {
    const asked: string[] = [];
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
      if (key === options.fail) return new Response("nope", { status: 502 });
      const body = perWindow[key] ?? {};
      return new Response(
        JSON.stringify({
          weekStart: params.get("since"),
          weekly: body.weekly ?? [],
          allTime: body.allTime ?? [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, asked };
  }

  const step = (name: string) => screen.getByRole("button", { name });

  beforeEach(() => onDay(WEDNESDAY));

  it("asks for the week the reader stepped back to, and walks forward again", async () => {
    const { asked } = stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
      [`${LAST_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(BOB, 33.1) },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous week"));

    // The heading moves with the rows: a window's standings must never sit
    // under the name of a different window.
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Week of Aug 16" }),
      ).toBeTruthy(),
    );
    // Read from the row rather than from the board, which also carries the
    // champion's name on the plaque under it.
    expect(boardRows("Week of Aug 16")[0].textContent).toContain(
      handleFor(BOB),
    );
    expect(screen.queryByText(handleFor(ALICE))).toBeNull();

    // And forward, back to the window the page opened on.
    fireEvent.click(step("Next week"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "This week" })).toBeTruthy(),
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
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous month"));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "July 2026" })).toBeTruthy(),
    );
    // The two windows are independent: only the month moved.
    expect(screen.getByRole("region", { name: "This week" })).toBeTruthy();
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
      expect(screen.getByRole("region", { name: "July 2026" })).toBeTruthy(),
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

  it("crowns a closed week from its own final standings", async () => {
    stubWindows({
      [`${THIS_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(ALICE, 41.2) },
      [`${LAST_WEEK}/${THIS_MONTH}`]: { weekly: rowFor(BOB, 33.1) },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous week"));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Week of Aug 16" }),
      ).toBeTruthy(),
    );

    // A week that has finished is its own answer: the board is the final
    // standing, and the plaque under it is who topped it -- not the week before,
    // which is what the live board's plaque names.
    const engraved = plaque("Week of Aug 16");
    expect(engraved.textContent).toContain("Champion");
    expect(engraved.textContent).toContain(handleFor(BOB));
  });

  it("carries the turnover-day caveat onto the week just gone", async () => {
    // A Sunday: the week that closed this morning is the one behind the live
    // board, and it has not closed at the same moment for everybody yet.
    onDay("2026-08-30");
    stubWindows({
      "2026-08-30/2026-08-01": { weekly: rowFor(ALICE, 41.2) },
      "2026-08-23/2026-08-01": { weekly: rowFor(BOB, 33.1) },
    });
    render(<LeaderboardPage />);
    await waitFor(() =>
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
    );

    fireEvent.click(step("Previous week"));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Week of Aug 23" }),
      ).toBeTruthy(),
    );

    // The board a reader stepped back to is the same window the live board's
    // plaque names, so it has to say the same thing about it: the name, and the
    // mark that says it can still move.
    const engraved = plaque("Week of Aug 23");
    expect(engraved.textContent).toContain(handleFor(BOB));
    expect(
      within(engraved).getByRole("button", {
        name: "Why this winner can still change",
      }),
    ).toBeTruthy();
  });

  it("leaves a window older than that one settled", async () => {
    onDay("2026-08-30");
    stubWindows({ "2026-08-16/2026-08-01": { weekly: rowFor(BOB, 33.1) } });
    render(<LeaderboardPage />);
    await waitFor(() => expect(step("Previous week")).toBeEnabled());

    fireEvent.click(step("Previous week"));
    fireEvent.click(step("Previous week"));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Week of Aug 16" }),
      ).toBeTruthy(),
    );

    // A week that closed a week ago is closed everywhere, whatever today is.
    expect(within(plaque("Week of Aug 16")).queryByRole("button")).toBeNull();
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
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
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
      within(screen.getByRole("region", { name: MONTH_BOARD })).getByText(
        handleFor(BOB),
      ),
    ).toBeTruthy();
    await act(async () => {
      release?.();
    });
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
      expect(screen.getByText(handleFor(ALICE))).toBeTruthy(),
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
      within(screen.getByRole("region", { name: MONTH_BOARD })).getByText(
        handleFor(BOB),
      ),
    ).toBeTruthy();
  });
});
