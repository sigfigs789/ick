import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { YesterdaysBest } from "./YesterdaysBest";
import { bestFind, foundByLabel, namedFinder } from "../game/yesterdaysBest";
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

describe("namedFinder", () => {
  it("names the first finder, or the reader when they were one", () => {
    expect(namedFinder([OTHER, SELF], 2, null)).toEqual({ id: OTHER, self: false, others: 1 });
    expect(namedFinder([OTHER, SELF], 2, SELF)).toEqual({ id: SELF, self: true, others: 1 });
  });

  it("never counts fewer others than the ids it was given", () => {
    expect(namedFinder([OTHER, SELF], 1, null)?.others).toBe(1);
    expect(namedFinder([], 3, null)).toBeUndefined();
  });
});

describe("foundByLabel", () => {
  it("counts the others in words", () => {
    expect(foundByLabel("CalmOtter3", 0)).toBe("Found by CalmOtter3");
    expect(foundByLabel("CalmOtter3", 1)).toBe("Found by CalmOtter3 and 1 other player");
    expect(foundByLabel("CalmOtter3", 4)).toBe("Found by CalmOtter3 and 4 other players");
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

  it("names the reader first when they found it too", async () => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: SELF }));
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 3, foundOn: YESTERDAY }], [OTHER, SELF]);
    render(<YesterdaysBest date={TODAY} isToday />);

    expect(
      await screen.findByText(`Found by ${handleFor(SELF)} and 2 other players`),
    ).toBeInTheDocument();
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
