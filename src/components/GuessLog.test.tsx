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
    expect(screen.getByText(/no guesses yet/i)).toBeInTheDocument();
  });

  it("lists each accepted word with its rarity", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
    ];
    render(<GuessLog acceptedWords={words} />);
    expect(screen.getByText("strange")).toBeInTheDocument();
    expect(screen.getByText("strut")).toBeInTheDocument();
    expect(screen.getByText("2 of 6 used")).toBeInTheDocument();
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
