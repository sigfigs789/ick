import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { YesterdaysBest } from "./YesterdaysBest";
import { bestFind } from "../game/yesterdaysBest";
import { forgetPageCaches } from "../game/pageCache";
import { dropForDate } from "../game/drop";
import { learnableWordForDrop } from "../game/dictionary";
import type { FoundWord } from "../game/leaderboard";

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

describe("the yesterday's best line", () => {
  it("names the rarest word found on yesterday's drop", async () => {
    const fetchMock = stubFetch([
      { word: "asphyxiate", zipf: 2.09, finders: 1, foundOn: YESTERDAY },
      { word: "physical", zipf: 4.9, finders: 6, foundOn: YESTERDAY },
    ]);
    render(<YesterdaysBest date={TODAY} />);

    expect(await screen.findByText("asphyxiate")).toBeInTheDocument();
    expect(screen.getByText(/found by 1 player$/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Yesterday's best for .${dropForDate(YESTERDAY)}.`)),
    ).toBeInTheDocument();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`today=${YESTERDAY}`);
  });

  it("names the word yesterday's drop offered before the feed answers", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<YesterdaysBest date={TODAY} />);

    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(screen.queryByText(/found by/)).not.toBeInTheDocument();
  });

  it("names the word yesterday's drop offered when the finds can't be read", async () => {
    const fetchMock = stubFetch(null);
    render(<YesterdaysBest date={TODAY} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(screen.queryByText(/found by/)).not.toBeInTheDocument();
  });

  it("names the word yesterday's drop offered for a day nobody found anything", async () => {
    const fetchMock = stubFetch([]);
    render(<YesterdaysBest date={TODAY} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(OFFERED)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Yesterday's best for .${dropForDate(YESTERDAY)}.`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/found by/)).not.toBeInTheDocument();
  });
});
