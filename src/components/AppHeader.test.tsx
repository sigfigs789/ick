import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";
import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { navigate, useRoute } from "../routes";

vi.mock("../analytics", () => ({
  trackLeaderboardOpened: vi.fn(),
  trackFoundWordsOpened: vi.fn(),
}));

const howToPlay = vi.fn();

/**
 * The header wired to the real router, which is the only way to see the thing
 * it is for: a tab is a tab because pressing it changes the page under it.
 */
function Harness({ instructionsOpen = false }: { instructionsOpen?: boolean }) {
  const route = useRoute();
  return (
    <AppHeader
      route={route}
      instructionsOpen={instructionsOpen}
      onHowToPlay={howToPlay}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

describe("the header", () => {
  it("names all three pages, and says which one you are on", () => {
    render(<Harness />);

    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Leaderboards")).toBeInTheDocument();
    expect(screen.getByText("Found words")).toBeInTheDocument();
    // Labels, not a row of glyphs: a trophy and a scroll cannot say which of
    // the two lists of words is which.
    expect(screen.getByRole("button", { name: /^Play$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("goes to each page, and moves the current marker with it", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: /Leaderboards/ }));
    // A real page at a real URL, not a modal over the puzzle.
    expect(window.location.pathname).toBe("/leaderboard");
    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toHaveAttribute("aria-current", "page");

    // And straight across to the other one, without passing through the game --
    // which is the whole reason the header is on every page.
    await userEvent.click(screen.getByRole("button", { name: "Found words" }));
    expect(window.location.pathname).toBe("/found-words");
    expect(trackLeaderboardOpened).toHaveBeenCalledWith("header");
    expect(trackFoundWordsOpened).toHaveBeenCalledWith("header");
  });

  it("keeps the wordmark as the page's h1 only on the puzzle", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "WordInk",
    );

    // The other two pages have a heading of their own that says what they are,
    // and two h1s is a worse answer to "what is this" than either alone.
    unmount();
    window.history.pushState(null, "", "/leaderboard");
    render(<Harness />);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("WordInk")).toBeInTheDocument();
  });

  it("asks for the rules from any page", async () => {
    window.history.pushState(null, "", "/found-words");
    render(<Harness />);

    // It used to live on the game alone, so a reader of the boards had to go
    // back to the puzzle to check what a rank was made of.
    await userEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(howToPlay).toHaveBeenCalled();
  });

  it("badges the leaderboard until it has been visited, then never again", async () => {
    const { unmount } = render(<Harness />);

    // The badge is part of the tab's accessible name, so a screen reader hears
    // the announcement rather than only seeing it.
    await userEvent.click(
      screen.getByRole("button", { name: "Leaderboards (new)" }),
    );
    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toBeInTheDocument();

    // And it stays gone across a reload, which is what "once" has to mean.
    unmount();
    window.history.pushState(null, "", "/");
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toBeInTheDocument();
  });

  it("retires the badge when the leaderboard is reached some other way", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Leaderboards (new)" }),
    ).toBeInTheDocument();

    // The results panel links straight to the board, and so does a shared URL.
    // Arriving is meeting it, from whichever direction.
    act(() => navigate("leaderboard"));
    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toBeInTheDocument();
  });

  it("names what is new in a callout, once the rules are behind them", () => {
    render(<Harness />);

    // The dot alone cannot say what it is pointing at; the callout can.
    expect(screen.getByText("New leaderboard")).toBeInTheDocument();
  });

  it("holds the callout back while the rules are still open", () => {
    // A first-timer has the how-to-play sheet open over this header, and a
    // callout pointing at a tab they cannot reach yet announces nothing.
    const { rerender } = render(<Harness instructionsOpen />);
    expect(screen.queryByText("New leaderboard")).not.toBeInTheDocument();

    rerender(<Harness instructionsOpen={false} />);
    expect(screen.getByText("New leaderboard")).toBeInTheDocument();
  });

  it("does not badge the leaderboard for a player who has already met it", () => {
    localStorage.setItem("ick:seen:leaderboard", "1");
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("New leaderboard")).not.toBeInTheDocument();
  });
});
