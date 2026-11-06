import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StreakState } from "../game/types";
import { ComeBackCard } from "./ComeBackCard";

const streak: StreakState = {
  currentStreak: 2,
  longestStreak: 2,
  freezePlays: 3,
  totalCompleted: 2,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

describe("ComeBackCard", () => {
  it("says the one thing tomorrow is worth to everyone", async () => {
    render(<ComeBackCard streak={streak} date="2026-10-22" />);
    expect(await screen.findByText(/Tomorrow earns a 🧊 freeze/)).toBeInTheDocument();
    expect(screen.queryByText(/make it a 3-day streak/)).not.toBeInTheDocument();
  });

  it("explains a freeze or a lazy weekend when the line is selected", async () => {
    render(<ComeBackCard streak={streak} date="2026-10-22" />);
    const line = await screen.findByRole("button", { name: /Tomorrow earns a 🧊 freeze/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(line);
    expect(screen.getByRole("dialog", { name: "Streak freezes" })).toHaveTextContent(/keeps your streak going/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves a line with nothing to explain as plain text", async () => {
    // Cap full, no weekend left this week: beating the best is all that's ahead.
    const capped = { ...streak, currentStreak: 5, longestStreak: 6, bankedFreezes: 1 };
    render(<ComeBackCard streak={capped} date="2026-10-30" />);
    expect(await screen.findByText(/days to beat your best streak/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

});
