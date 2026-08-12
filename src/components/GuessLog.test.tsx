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
};

describe("GuessLog", () => {
  it("shows an empty state with no guesses", () => {
    render(<GuessLog acceptedWords={[]} onSelectWord={vi.fn()} />);
    expect(screen.getByText(/no guesses yet/i)).toBeInTheDocument();
  });

  it("lists each accepted word with its rarity", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
    ];
    render(<GuessLog acceptedWords={words} onSelectWord={vi.fn()} />);
    expect(screen.getByText("strange")).toBeInTheDocument();
    expect(screen.getByText("strut")).toBeInTheDocument();
    expect(screen.getByText("2 of 6 used")).toBeInTheDocument();
  });

  it("crowns the rarest word as the best one", () => {
    const words: AcceptedWord[] = [
      { word: "strange", rarity: "Common", zipf: 4.6 },
      { word: "strut", rarity: "Rare", zipf: 3.2 },
    ];
    render(<GuessLog acceptedWords={words} onSelectWord={vi.fn()} />);
    const strutEntry = screen.getByText("strut").closest("li");
    expect(strutEntry).toHaveClass("guess-log__entry--best");
    const strangeEntry = screen.getByText("strange").closest("li");
    expect(strangeEntry).not.toHaveClass("guess-log__entry--best");
  });

  it("calls onSelectWord with the word when a log entry is clicked", async () => {
    const onSelectWord = vi.fn();
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} onSelectWord={onSelectWord} />);

    await userEvent.click(screen.getByRole("button", { name: /reuse "strange"/i }));
    expect(onSelectWord).toHaveBeenCalledWith("strange");
  });

  it("shows all trackers without a duplicate completion heading", () => {
    const words: AcceptedWord[] = [{ word: "strut", rarity: "Rare", zipf: 3.2 }];
    render(
      <GuessLog
        acceptedWords={words}
        onSelectWord={vi.fn()}
        completed
        streak={streak}
      />
    );
    expect(screen.queryByRole("heading", { name: /you won/i })).not.toBeInTheDocument();
    expect(screen.getByText("Crushed it")).toBeInTheDocument();
    expect(screen.getByText("Elite")).toBeInTheDocument();
    expect(screen.queryByText(/guess.*left/i)).not.toBeInTheDocument();
  });
});
