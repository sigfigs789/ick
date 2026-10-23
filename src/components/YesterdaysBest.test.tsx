import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { YesterdaysBest } from "./YesterdaysBest";
import { bestFind } from "../game/yesterdaysBest";
import { forgetPageCaches } from "../game/pageCache";
import { dropForDate } from "../game/drop";
import { learnableWordForDrop } from "../game/dictionary";
import type { FoundWord } from "../game/leaderboard";
import { handleFor } from "../game/handle";

const TODAY = "2026-10-23";
const YESTERDAY = "2026-10-22";
/** What yesterday's finished puzzle revealed: the line's word with no finds to name. */
const OFFERED = learnableWordForDrop(dropForDate(YESTERDAY), YESTERDAY)!.word;

/** Answer the feed fetch; a `null` body makes the request fail instead. */
function stubFetch(words: unknown) {
  const fetchMock = vi.fn(async () => {
    if (words === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ words }), {
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

/** Open the reveal. */
function reveal() {
  fireEvent.click(screen.getByRole("button", { name: "Yesterday's Best Word" }));
}

describe("the yesterday's best word button", () => {
  it("keeps the word behind the button until it is pressed", async () => {
    const fetchMock = stubFetch([
      { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: YESTERDAY, firstPlayer: "p1" },
    ]);
    render(<YesterdaysBest date={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Yesterday's Best Word" })).toBeInTheDocument();
    expect(screen.queryByText("asphyxiate")).not.toBeInTheDocument();
    expect(screen.queryByText(OFFERED)).not.toBeInTheDocument();
  });

  it("reveals the rarest word found on yesterday's drop, its score and its first finder", async () => {
    const fetchMock = stubFetch([
      { word: "asphyxiate", zipf: 2.09, finders: 3, foundOn: YESTERDAY, firstPlayer: "p1" },
      { word: "physical", zipf: 4.9, finders: 6, foundOn: YESTERDAY, firstPlayer: "p2" },
    ]);
    render(<YesterdaysBest date={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    reveal();

    expect(await screen.findByText("asphyxiate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yesterday's Best Word" })).not.toBeInTheDocument();
    expect(document.querySelector(".yesterdays-best__score")?.textContent).toMatch(/\d/);
    expect(
      screen.getByText(`First found by ${handleFor("p1")} · 3 players found it`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Yesterday's best on .${dropForDate(YESTERDAY)}.`)),
    ).toBeInTheDocument();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`today=${YESTERDAY}`);
  });

  it("names only the first finder when nobody else found it", async () => {
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: YESTERDAY, firstPlayer: "p1" }]);
    render(<YesterdaysBest date={TODAY} />);
    reveal();

    expect(await screen.findByText(`First found by ${handleFor("p1")}`)).toBeInTheDocument();
  });

  it("counts the finders on a feed that does not name the first one", async () => {
    stubFetch([{ word: "asphyxiate", zipf: 2.09, finders: 2, foundOn: YESTERDAY }]);
    render(<YesterdaysBest date={TODAY} />);
    reveal();

    expect(await screen.findByText("Found by 2 players")).toBeInTheDocument();
  });

  it("reveals the word yesterday's drop offered before the feed answers", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<YesterdaysBest date={TODAY} />);
    reveal();

    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(screen.getByText("The best word the drop offered")).toBeInTheDocument();
  });

  it("reveals the word yesterday's drop offered when the finds can't be read", async () => {
    const fetchMock = stubFetch(null);
    render(<YesterdaysBest date={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    reveal();

    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(screen.queryByText(/found by/i)).not.toBeInTheDocument();
  });

  it("reveals the word yesterday's drop offered for a day nobody found anything", async () => {
    const fetchMock = stubFetch([]);
    render(<YesterdaysBest date={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    reveal();

    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(screen.queryByText(/found by/i)).not.toBeInTheDocument();
  });
});
