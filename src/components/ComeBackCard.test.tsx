import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StreakState } from "../game/types";
import { ComeBackCard } from "./ComeBackCard";

const streak: StreakState = {
  currentStreak: 2,
  longestStreak: 2,
  totalCompleted: 2,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

describe("ComeBackCard", () => {
  it("says what tomorrow does for the streak", () => {
    render(<ComeBackCard streak={streak} />);
    expect(screen.getByText("Play tomorrow to make it a 3-day streak.")).toBeInTheDocument();
    expect(screen.getByText(/Tomorrow earns a 🧊 freeze/)).toBeInTheDocument();
  });
});
