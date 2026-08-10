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
  highScore: 0,
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
});
