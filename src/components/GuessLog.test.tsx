import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuessLog } from "./GuessLog";
import type { AcceptedWord, StreakState } from "../game/types";

const streak: StreakState = {
  currentStreak: 1,
  longestStreak: 1,
  totalCompleted: 1,
  crushedIt: 1,
  elite: 0,
  highScore: 6.8,
};

describe("GuessLog", () => {
  it("shows an empty state with no guesses", () => {
    render(<GuessLog acceptedWords={[]} />);
    expect(screen.getByText(/no words yet/i)).toBeInTheDocument();
  });

  it("lists each accepted word with its rarity", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
      { word: "stroll", rarity: "Common", zipf: 4.1 },
    ];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText("strange")).toBeInTheDocument();
    expect(screen.getByText("strut")).toBeInTheDocument();
    expect(screen.getByText("stroll")).toBeInTheDocument();
    // Guesses count up: three played, of four.
    expect(screen.getByText(/3 of 4 guesses/)).toBeInTheDocument();
  });

  it("counts against the six-guess limit an archive puzzle played with", () => {
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} date="2024-01-01" />);
    expect(screen.getByText(/1 of 6 guesses/)).toBeInTheDocument();
  });

  it("names the common form when scoring on it cost the guess real points", () => {
    // "materialnesses" is unmeasured, so its own score would be a flat 10;
    // it is scored as "material" instead, six points lower.
    const words: AcceptedWord[] = [
      { word: "materialnesses", rarity: "Common", zipf: 4.95 },
    ];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText(/scored as its common form, “material”/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /scored as its common form "material"/i })
    ).toBeInTheDocument();
  });

  it("leaves a word alone when its base barely changed the score", () => {
    const words: AcceptedWord[] = [{ word: "played", rarity: "Common", zipf: 4.79 }];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByText(/scored as its common form/i)).not.toBeInTheDocument();
  });

  it("crowns the rarest word as the best one", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
    ];
    render(<GuessLog acceptedWords={words} />);
    const strutEntry = screen.getByText("strut").closest("li");
    expect(strutEntry).toHaveClass("guess-log__entry--best");
    const strangeEntry = screen.getByText("strange").closest("li");
    expect(strangeEntry).not.toHaveClass("guess-log__entry--best");
  });

  it("copies the tier square, word, and score when tapped and flashes a confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} />);

    await userEvent.click(screen.getByRole("button", { name: /copy "strange"/i }));

    // "🟫 strange (<score>)" — the brown square is the Common tier.
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^🟫 strange \(.+\)$/));
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("shows all trackers without a duplicate completion heading", () => {
    const words: AcceptedWord[] = [{ word: "strut", rarity: "Rare", zipf: 3.2 }];
    render(<GuessLog acceptedWords={words} completed streak={streak} />);
    expect(screen.queryByRole("heading", { name: /you won/i })).not.toBeInTheDocument();
    expect(screen.getByText("Crushed it")).toBeInTheDocument();
    expect(screen.getByText("Elite")).toBeInTheDocument();
    expect(screen.queryByText(/guess.*left/i)).not.toBeInTheDocument();
  });
});

describe("GuessLog retry", () => {
  const words: AcceptedWord[] = [
    { word: "strange", rarity: "Common", zipf: 4.6 },
    { word: "strut", rarity: "Rare", zipf: 3.2 },
  ];

  it("offers no retry when the puzzle isn't the one it belongs to", () => {
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByRole("button", { name: /retry a word/i })).not.toBeInTheDocument();
  });

  it("arms, then swaps out the word the player picks", async () => {
    const onRetry = vi.fn();
    render(<GuessLog acceptedWords={words} canRetry onRetry={onRetry} />);

    // Until it is armed, tapping a word still copies it.
    await userEvent.click(screen.getByRole("button", { name: /retry a word/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Retry "strange"/i }));

    expect(onRetry).toHaveBeenCalledWith("strange");
    // And it disarms itself, so the next tap copies again rather than dropping
    // a second word.
    expect(screen.getByRole("button", { name: /^Copy "strut"/i })).toBeInTheDocument();
  });

  it("says the limit up front, before the button is ever pressed", () => {
    render(<GuessLog acceptedWords={words} canRetry onRetry={vi.fn()} />);
    expect(screen.getByText(/one retry per puzzle/i)).toBeInTheDocument();
  });

  it("says what arming does without repeating the limit already stated above it", async () => {
    render(<GuessLog acceptedWords={words} canRetry onRetry={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /retry a word/i }));

    expect(screen.getByText(/select a word to clear and try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/once per day/i)).not.toBeInTheDocument();
  });

  it("backs out without spending anything", async () => {
    const onRetry = vi.fn();
    render(<GuessLog acceptedWords={words} canRetry onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: /retry a word/i }));
    await userEvent.click(screen.getByRole("button", { name: /never mind/i }));

    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Copy "strange"/i })).toBeInTheDocument();
  });

  it("replaces the control with a quiet, inert note once the retry is spent", () => {
    render(<GuessLog acceptedWords={words} retrySpent />);
    expect(screen.queryByRole("button", { name: /retry a word/i })).not.toBeInTheDocument();
    // The button's own spot now says what happened to it -- no separate
    // counter needed to learn the retry is gone.
    expect(screen.getByText(/retry used/i)).toBeInTheDocument();
    expect(screen.queryByText(/once per day/i)).not.toBeInTheDocument();
  });

  it("says nothing about retries at all on a puzzle that never offered one", () => {
    render(<GuessLog acceptedWords={words} />);
    expect(screen.queryByRole("button", { name: /retry a word/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/retry used/i)).not.toBeInTheDocument();
  });

  it("still offers the retry on a puzzle the last guess finished", () => {
    render(<GuessLog acceptedWords={words} completed streak={streak} canRetry onRetry={vi.fn()} />);
    // The case the feature exists for: the slot is spent and the score is bad.
    expect(screen.getByRole("button", { name: /retry a word/i })).toBeInTheDocument();
  });
});

describe("GuessLog guess count", () => {
  it("shows only the guess count in the header -- no separate retry fraction", () => {
    // The retry used to sit here too, as a second "X of Y" beside the guess
    // count. It is a single yes/no reserve, not a running tally, so pairing
    // it with a real multi-step count read as the same kind of number when it
    // wasn't. That state now lives entirely on the retry control itself.
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} canRetry />);
    expect(screen.getByText(/1 of 4 guesses/)).toBeInTheDocument();
    expect(screen.queryByText(/retr(y|ies)$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ retr/i)).not.toBeInTheDocument();
  });
});
