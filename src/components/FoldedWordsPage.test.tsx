import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoldedWordsPage } from "./FoldedWordsPage";
import { cacheFolds, clearFoldCache, type FoldedWord } from "../game/folds";

/**
 * A handful of folds standing in for the dictionary's hundred thousand.
 *
 * Seeded through the cache the page already reads on mount, so these tests are
 * about the page -- what it shows, what the search does, how much of it is on
 * screen -- rather than about the scan, which has its own tests in
 * game/folds.test.ts. One test below does let the real scan run.
 */
const FIXTURES: FoldedWord[] = [
  {
    word: "abaci",
    base: "abacus",
    ownZipf: 1.2,
    baseZipf: 3.4,
    ownRarity: "Mythic",
    baseRarity: "Rare",
    drop: 1.95,
  },
  {
    word: "outwilled",
    base: "will",
    ownZipf: 0,
    baseZipf: 6.1,
    ownRarity: "Legend",
    baseRarity: "Very Common",
    drop: 7.78,
  },
  {
    word: "zippers",
    base: "zipper",
    ownZipf: 3,
    baseZipf: 3.2,
    ownRarity: "Rare",
    baseRarity: "Rare",
    drop: 0.2,
  },
];

beforeEach(() => {
  clearFoldCache();
  cacheFolds(FIXTURES);
  window.history.pushState(null, "", "/folded-words");
});

afterEach(() => {
  clearFoldCache();
});

describe("the fold table", () => {
  it("names the word, the common form it scores as, and both scores", () => {
    render(<FoldedWordsPage />);

    const row = screen.getByText("abaci").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("abacus")).toBeInTheDocument();
    // The score the word's own frequency would have earned, then the one it
    // actually gets -- both as the game renders them elsewhere.
    expect(within(row!).getByText("MYTHIC")).toBeInTheDocument();
    expect(within(row!).getByText("RARE")).toBeInTheDocument();
    expect(row).toHaveTextContent("On its own:");
    expect(row).toHaveTextContent("Folded:");
  });

  it("opens on the folds that cost the most", () => {
    render(<FoldedWordsPage />);
    const shown = screen
      .getAllByRole("listitem")
      .map((row) => row.querySelector(".folds__word")?.textContent);
    expect(shown).toEqual(["outwilled", "abaci", "zippers"]);
  });

  it("reorders alphabetically when asked", async () => {
    render(<FoldedWordsPage />);

    await userEvent.click(screen.getByRole("button", { name: "A–Z" }));
    const shown = screen
      .getAllByRole("listitem")
      .map((row) => row.querySelector(".folds__word")?.textContent);
    expect(shown).toEqual(["abaci", "outwilled", "zippers"]);
    expect(screen.getByRole("button", { name: "A–Z" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("searches both sides of the fold", async () => {
    render(<FoldedWordsPage />);
    const search = screen.getByRole("searchbox");

    // The word you played...
    await userEvent.type(search, "abaci");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 word matching")).toBeInTheDocument();

    // ...and the common form, which is the other question this page is asked.
    await userEvent.clear(search);
    await userEvent.type(search, "will");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("outwilled");
  });

  it("says so when a search finds nothing", async () => {
    render(<FoldedWordsPage />);

    await userEvent.type(screen.getByRole("searchbox"), "qqqq");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.getByText(/No folded word matches/),
    ).toBeInTheDocument();
  });

  it("counts the whole list, not the rows on screen", () => {
    render(<FoldedWordsPage />);
    expect(screen.getByText("3 words")).toBeInTheDocument();
  });

  it("shows a page of rows at a time, and hands over the rest on request", async () => {
    // Long enough to page, so the button under the list is the thing under
    // test rather than the fixtures above.
    clearFoldCache();
    cacheFolds(
      Array.from({ length: 250 }, (_, i) => ({
        ...FIXTURES[0],
        word: `word${String(i).padStart(3, "0")}`,
        drop: 250 - i,
      })),
    );
    render(<FoldedWordsPage />);

    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    // The count is the whole answer, not the part of it on screen.
    expect(screen.getByText("250 words")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Show 100 more/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(200);

    await userEvent.click(screen.getByRole("button", { name: /Show 50 more/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(250);
    expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
  });

  it("starts a new question at the top of its answer", async () => {
    clearFoldCache();
    cacheFolds(
      Array.from({ length: 250 }, (_, i) => ({
        ...FIXTURES[0],
        word: `word${String(i).padStart(3, "0")}`,
        drop: 250 - i,
      })),
    );
    render(<FoldedWordsPage />);

    await userEvent.click(screen.getByRole("button", { name: /Show 100 more/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(200);

    // A reader who searches is asking something else; keeping their place in
    // the last answer would hand them 200 rows of a different list.
    await userEvent.type(screen.getByRole("searchbox"), "word");
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
  });

  it("scans the dictionary when nothing is cached, and says so while it does", async () => {
    clearFoldCache();
    render(<FoldedWordsPage />);

    // The one thing the page can say before it has an answer: that it is
    // working, and roughly how far along.
    expect(screen.getByText(/still reading the dictionary/)).toBeInTheDocument();

    await waitFor(
      () => {
        expect(
          screen.queryByText(/still reading the dictionary/),
        ).not.toBeInTheDocument();
      },
      { timeout: 30_000 },
    );

    // The real table, built by the real scorer.
    await userEvent.type(screen.getByRole("searchbox"), "abaci");
    const row = screen.getByText("abaci").closest("li");
    expect(within(row!).getByText("abacus")).toBeInTheDocument();
  }, 40_000);
});
