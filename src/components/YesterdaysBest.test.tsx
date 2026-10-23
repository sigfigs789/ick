import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { YesterdaysBest } from "./YesterdaysBest";
import { bestFind, finderTotal, orderedFinders, otherPlayers } from "../game/yesterdaysBest";
import { handleFor } from "../game/handle";
import { PLAYER_KEY } from "../game/player";
import { forgetPageCaches } from "../game/pageCache";
import { dropForDate } from "../game/drop";
import { formatDateLabel } from "../game/date";
import type { FoundWord } from "../game/leaderboard";

const TODAY = "2026-10-23";
const YESTERDAY = "2026-10-22";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/**
 * Answer the feed fetch and the finders fetch; a `null` makes that request fail
 * instead.
 */
function stubFetch(words: unknown, finders: unknown = []) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = String(url).includes("finders=") ? { finders } : { words };
    if (Object.values(body)[0] === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function find(word: string, zipf: number, finders = 1): FoundWord {
  return { word, zipf, finders, rarity: "Rare", foundOn: YESTERDAY, today: true };
}

beforeEach(() => {
  localStorage.clear();
  forgetPageCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bestFind", () => {
  it("picks the rarest word", () => {
    expect(bestFind([find("cat", 5), find("quixotic", 2.3), find("dog", 4)])?.word).toBe(
      "quixotic",
    );
  });

  it("breaks a tie on fewer finders, then the alphabet", () => {
    expect(bestFind([find("b", 2, 3), find("c", 2, 1)])?.word).toBe("c");
    expect(bestFind([find("b", 2), find("a", 2)])?.word).toBe("a");
  });

  it("has nothing to say about an empty day", () => {
    expect(bestFind([])).toBeUndefined();
  });
});

describe("orderedFinders", () => {
  it("keeps first finder first, or puts the reader first when they were one", () => {
    expect(orderedFinders([OTHER, SELF], null)).toEqual([OTHER, SELF]);
    expect(orderedFinders([OTHER, SELF], SELF)).toEqual([SELF, OTHER]);
  });
});

describe("finderTotal", () => {
  it("never counts fewer finders than the ids it was given", () => {
    expect(finderTotal([OTHER, SELF], 1)).toBe(2);
    expect(finderTotal([OTHER], 3)).toBe(3);
  });
});

describe("otherPlayers", () => {
  it("counts the others in words", () => {
    expect(otherPlayers(1)).toBe("1 other player");
    expect(otherPlayers(4)).toBe("4 other players");
  });
});

describe("the yesterday's best line", () => {
  it("names the rarest word found on yesterday's drop", async () => {
    const fetchMock = stubFetch(
      [
        { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: YESTERDAY },
        { word: "physical", zipf: 4.9, finders: 6, foundOn: YESTERDAY },
      ],
      [OTHER],
    );
    render(<YesterdaysBest date={TODAY} isToday />);

    expect(await screen.findByText("asphyxiate")).toBeInTheDocument();
    expect(await screen.findByText(`Found by ${handleFor(OTHER)}`)).toBeInTheDocument();
    expect(document.querySelector(".rarity-badge")).toBeNull();
    expect(document.querySelector(".yesterdays-best__score .rarity-badge__dot")).not.toBeNull();
    expect(
      screen.getByText(new RegExp(`Yesterday's best for .${dropForDate(YESTERDAY)}.`)),
    ).toBeInTheDocument();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`today=${YESTERDAY}`);
  });

  it("names the day before an archived puzzle by its date", async () => {
    const fetchMock = stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: "2026-10-21" }]);
    render(<YesterdaysBest date={YESTERDAY} isToday={false} />);

    expect(await screen.findByText("asphyxiate")).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${formatDateLabel("2026-10-21")}'s best for .${dropForDate("2026-10-21")}.`),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Yesterday's best/)).toBeNull();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("today=2026-10-21");
  });

  it("names both finders when there are two, the reader first", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: SELF }));
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 2, foundOn: YESTERDAY }], [OTHER, SELF]);
    render(<YesterdaysBest date={TODAY} isToday />);

    expect(
      await screen.findByText(`Found by ${handleFor(SELF)} and ${handleFor(OTHER)}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the other finders as a list when there are three or more", async () => {
    const THIRD = "33333333-3333-4333-8333-333333333333";
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 4, foundOn: YESTERDAY }], [OTHER, SELF, THIRD]);
    render(<YesterdaysBest date={TODAY} isToday />);

    const others = await screen.findByRole("button", { name: "3 other players" });
    expect(others.closest(".yesterdays-best__finders")).toHaveTextContent(
      `Found by ${handleFor(OTHER)} and 3 other players`,
    );
    expect(screen.queryByRole("list")).toBeNull();

    fireEvent.click(others);
    expect(others).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    // The fourth finder's id never arrived, so it is counted rather than named.
    expect(items).toEqual([handleFor(SELF), handleFor(THIRD), "and 1 more"]);

    fireEvent.click(others);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("falls back to the count when the finders can't be read", async () => {
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 2, foundOn: YESTERDAY }], null);
    render(<YesterdaysBest date={TODAY} isToday />);

    expect(await screen.findByText("Found by 2 players")).toBeInTheDocument();
  });

  it("stays silent when yesterday's finds can't be read", async () => {
    const fetchMock = stubFetch(null);
    const { container } = render(<YesterdaysBest date={TODAY} isToday />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent for a day nobody found anything", async () => {
    const fetchMock = stubFetch([]);
    const { container } = render(<YesterdaysBest date={TODAY} isToday />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
