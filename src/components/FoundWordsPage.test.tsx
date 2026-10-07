import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FoundWordsPage } from "./FoundWordsPage";

/**
 * The finds, on their own page.
 *
 * These tests were the bottom half of LeaderboardPage.test.tsx, and moved with
 * the section they are about: the feed is its own page now, with its own URL and
 * its own tab in the header, because a list of words read through the day does
 * not belong under two boards that have not moved since breakfast.
 */

const WORDS = [
  { word: "asphyxiate", zipf: 2.09, finders: 3 },
  { word: "quixotic", zipf: 2.33, finders: 1 },
];

/** Answer the feed fetch; a `null` body makes the request fail instead. */
function stubFetch(words: unknown = WORDS) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // Score submissions are POSTs and answered blandly; only the GET matters.
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (words === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ words }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  window.history.pushState(null, "", "/found-words");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the found words page", () => {
  it("says what it is, and offers the way back to the puzzle", async () => {
    stubFetch();
    render(<FoundWordsPage />);

    // The page's title is the day it is showing, which is also what the
    // header's tab calls it -- and it moves with the reader's steps.
    expect(
      screen.getByRole("heading", { level: 1, name: /Today's finds/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Back to today's puzzle" }),
    );
    expect(window.location.pathname).toBe("/");
  });

  it("shows the section from the first open, with nothing else on the page to wait for", async () => {
    // The feed used to be gated on there being something to show, because it
    // sat under two boards that were the page. It *is* the page now: an empty
    // day is an answer it has to give out loud.
    stubFetch([]);
    render(<FoundWordsPage />);

    expect(
      await screen.findByText("Nobody's found anything yet today."),
    ).toBeInTheDocument();
  });

  it("offers a retry when the finds can't be loaded", async () => {
    const fetchMock = stubFetch(null);
    render(<FoundWordsPage />);

    expect(
      await screen.findByText(/Couldn't load these finds/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Try loading the finds again" }),
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
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
    render(<FoundWordsPage />);

    await waitFor(() => expect(finds()).toHaveLength(2));
    expect(finds()[0]).toHaveTextContent("asphyxiate");
    expect(finds()[1]).toHaveTextContent("quixotic");
  });

  it("badges each word at what it is worth today", async () => {
    stubFetch();
    render(<FoundWordsPage />);

    // The same badge the game shows on an accepted word, so a find reads the
    // way finding it would have. Read off the badge's own element: the row's
    // text runs together as "8.43 players", where a substring match would pass
    // for a number never displayed.
    await waitFor(() => expect(finds()[0]).toHaveTextContent("EXTREMELY RARE"));
    expect(finds()[0].querySelector(".rarity-badge__score")?.textContent).toBe(
      "8.4",
    );
  });

  it("prices the badge's number by the puzzle the word was found on, like its rank", async () => {
    // The rank came from the find's own puzzle and the number from the newest
    // undated profile, so on the day measured scores were lifted the two
    // disagreed: "drudging" showed 7.7 under an Extremely Rare badge (8.0 is
    // its lifted score), and a 9.3 in Freeform wore Mythic.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T18:00:00Z"));
    stubFetch([
      { word: "drudging", zipf: 2.61, finders: 1, foundOn: "2026-10-07" },
    ]);
    render(<FoundWordsPage />);

    await waitFor(() => expect(finds()[0]).toHaveTextContent("EXTREMELY RARE"));
    expect(finds()[0].querySelector(".rarity-badge__score")?.textContent).toBe(
      "8.0",
    );
  });

  it("says how many players found a word, when more than one did", async () => {
    stubFetch();
    render(<FoundWordsPage />);

    await waitFor(() => expect(finds()[0]).toHaveTextContent("3 players"));
    // One finder needs no count -- "1 players" is noise, and so is "1 player".
    expect(finds()[1]).not.toHaveTextContent("player");
  });

  it("names the drop the finds had to contain", async () => {
    stubFetch();
    render(<FoundWordsPage />);

    // Without it the list is a pile of unrelated words. In the page's title,
    // beside the day -- the two answer one question, which puzzle this is.
    await screen.findByRole("region", { name: "Today's finds" });
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.querySelector(".found-words__drop")?.textContent).toBeTruthy();
    // And said once: the section under it is labelled, not headed.
    expect(screen.getAllByText("Today's finds")).toHaveLength(1);
  });

  it("says so plainly when nobody has found anything today", async () => {
    // A pinned day rather than whatever day CI runs on, so the drop in the
    // heading and the step back through the week are the same every time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 9, 0, 0));
    try {
      stubFetch([]);
      render(<FoundWordsPage />);

      // An empty morning is exactly when yesterday's finds are the thing worth
      // reaching, and the way back through the week is right there under the
      // heading.
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
          new Response(JSON.stringify({ words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<FoundWordsPage />);
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
          new Response(JSON.stringify({ words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<FoundWordsPage />);
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
          new Response(JSON.stringify({ words }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<FoundWordsPage />);
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
    render(<FoundWordsPage />);
    await vi.advanceTimersByTimeAsync(0);
    const first = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000);

    // Today's finds land through the day, so a page left open must not sit on
    // the snapshot it opened with.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first);
  });

  it("keeps the list on screen through a refresh", async () => {
    stubFetch();
    render(<FoundWordsPage />);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);
    // A poll that blanked the list every minute would be worse than not
    // polling.
    expect(screen.getByText("asphyxiate")).toBeTruthy();
  });

  it("keeps the last good list when a refresh fails", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new Error("offline");
        return new Response(JSON.stringify({ words: WORDS }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<FoundWordsPage />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("asphyxiate")).toBeTruthy();

    fail = true;
    await vi.advanceTimersByTimeAsync(60_000);

    // One bad minute is not a reason to throw the page away.
    expect(screen.queryByText(/Couldn't load these finds/)).toBeNull();
    expect(screen.getByText("asphyxiate")).toBeTruthy();
  });

  it("refreshes past the cache when a reader taps refresh", async () => {
    const fetchMock = stubFetch();
    render(<FoundWordsPage />);
    await vi.advanceTimersByTimeAsync(0);
    const opened = fetchMock.mock.calls.length;

    // fireEvent rather than userEvent: this block runs on fake timers, and
    // userEvent waits on real ones.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Past the shared copy. A client cannot bust a CDN cache with a header, so
    // a different URL is the only thing that can, and without it the button
    // would hand back the list the reader just told us is stale.
    const asked = fetchMock.mock.calls.slice(opened).map(([url]) => String(url));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((url) => /&t=\d+/.test(url))).toBe(true);
  });

  it("leaves the poll on the shared copy", async () => {
    const fetchMock = stubFetch();
    render(<FoundWordsPage />);
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
    render(<FoundWordsPage />);
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
      // Anything that is not the feed: this page makes no other request, so it
      // is only here to fail loudly if one ever appears.
      return new Response("{}", {
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
    render(<FoundWordsPage />);
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
    render(<FoundWordsPage />);

    // One day fetched on open, and it is today's. A reader who never steps back
    // costs exactly what they cost before this existed.
    await vi.waitFor(() => expect(asked).toEqual([TODAY]));
  });

  it("keeps stepping back past the week's reset", async () => {
    stubDays();
    render(<FoundWordsPage />);
    await vi.waitFor(() => expect(back()).toBeEnabled());

    // Wednesday back to Sunday, which used to be the end of the road: the feed
    // was the week the board above it ranked. It is its own page now, and a
    // record of what has been found that forgot every Sunday night was the odd
    // thing -- so Sunday steps back too, all the way to the first day any find
    // was recorded.
    fireEvent.click(back());
    fireEvent.click(back());
    fireEvent.click(back());
    await vi.waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Finds from Sep 13" }),
      ).toBeTruthy(),
    );
    expect(SUNDAY).toBe("2026-09-13");
    expect(back()).toBeEnabled();

    fireEvent.click(back());
    await vi.waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Finds from Sep 12" }),
      ).toBeTruthy(),
    );
  });

  it("offers no step back past the first day any find was recorded", async () => {
    // The finds table is younger than the game. On the first day it holds, the
    // week's reset is still three days further back -- and every one of those
    // days would answer "nobody found anything on this puzzle", which is a
    // sentence about the schema rather than about the players.
    vi.setSystemTime(new Date(2026, 7, 26, 9, 0, 0));
    const { asked } = stubDays({ "2026-08-26": WORDS });
    render(<FoundWordsPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    expect(asked).toEqual(["2026-08-26"]);
    expect(back()).toBeDisabled();
    fireEvent.click(back());
    expect(asked).toEqual(["2026-08-26"]);
  });

  it("walks forward again, and stops on today", async () => {
    stubDays({ [TUESDAY]: YESTERDAY_WORDS });
    render(<FoundWordsPage />);
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
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<FoundWordsPage />);
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
    render(<FoundWordsPage />);
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
    render(<FoundWordsPage />);
    await vi.waitFor(() => expect(screen.getByText("asphyxiate")).toBeTruthy());

    fireEvent.click(back());
    await vi.waitFor(() => expect(screen.getByText("linkboy")).toBeTruthy());

    // The arrival flash means "this turned up while you were looking". A whole
    // day appearing because a button was pressed is not that.
    expect(document.querySelector(".found-words__item--arrived")).toBeNull();
  });
});
