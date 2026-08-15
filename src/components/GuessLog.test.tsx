import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("long-press to copy", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("copies the word and suppresses reselection on a held press", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const onSelectWord = vi.fn();
      const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
      render(<GuessLog acceptedWords={words} onSelectWord={onSelectWord} />);

      const button = screen.getByRole("button", { name: /reuse "strange"/i });
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(button);
      fireEvent.click(button);

      expect(writeText).toHaveBeenCalledWith("strange");
      expect(onSelectWord).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /copied "strange"/i })).toBeInTheDocument();
    });

    it("reselects the word on a quick tap without copying", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const onSelectWord = vi.fn();
      const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
      render(<GuessLog acceptedWords={words} onSelectWord={onSelectWord} />);

      const button = screen.getByRole("button", { name: /reuse "strange"/i });
      fireEvent.pointerDown(button);
      vi.advanceTimersByTime(100);
      fireEvent.pointerUp(button);
      fireEvent.click(button);

      expect(writeText).not.toHaveBeenCalled();
      expect(onSelectWord).toHaveBeenCalledWith("strange");
    });
  });

  it("copies the word when the copy button is clicked, without reselecting it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onSelectWord = vi.fn();
    const words: AcceptedWord[] = [{ word: "strange", rarity: "Common", zipf: 4.6 }];
    render(<GuessLog acceptedWords={words} onSelectWord={onSelectWord} />);

    await userEvent.click(screen.getByRole("button", { name: /copy "strange"/i }));

    expect(writeText).toHaveBeenCalledWith("strange");
    expect(onSelectWord).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /copied "strange"/i })).toBeInTheDocument();
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
