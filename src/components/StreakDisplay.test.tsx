import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreakDisplay } from "./StreakDisplay";
import type { StreakState } from "../game/types";

const streak: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompleted: 0,
  crushedIt: 0,
  elite: 0,
};

describe("StreakDisplay", () => {
  it("hides the flame until a streak reaches two days", () => {
    const { rerender } = render(<StreakDisplay streak={streak} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 1 }} />);
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    rerender(<StreakDisplay streak={{ ...streak, currentStreak: 2 }} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("shows the current puzzle's total rarity and top score", () => {
    render(<StreakDisplay streak={streak} totalRarity={21.4} topRarity={8.7} />);

    const scores = document.querySelector(".streak-display__rarity-scores");
    expect(scores?.textContent).toBe("Total21.4Top8.7");
    expect(screen.queryByText("High score")).not.toBeInTheDocument();
  });
});
