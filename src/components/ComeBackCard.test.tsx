import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StreakState } from "../game/types";
import { ComeBackCard } from "./ComeBackCard";

// Words banked on the puzzle average Legend, so a share now would earn Amaterasu.
vi.mock("../game/shareFlames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/shareFlames")>()),
  shareFireTier: (words: unknown[]) => (words.length > 0 ? "Legend" : null),
}));

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
    render(<ComeBackCard streak={streak} date="2026-10-22" words={[]} />);
    expect(await screen.findByText(/Tomorrow earns a 🧊 freeze/)).toBeInTheDocument();
    expect(screen.queryByText(/make it a 3-day streak/)).not.toBeInTheDocument();
  });

  it("explains a freeze or a lazy weekend when the line is selected", async () => {
    render(<ComeBackCard streak={streak} date="2026-10-22" words={[]} />);
    const line = await screen.findByRole("button", { name: /Tomorrow earns a 🧊 freeze/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(line);
    expect(screen.getByRole("dialog", { name: "Streak freezes" })).toHaveTextContent(/keeps your streak going/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the share badge a share now would earn, ahead of tomorrow", async () => {
    render(<ComeBackCard streak={streak} date="2026-10-22" words={[{ zipf: 1 } as never]} />);
    expect(await screen.findByRole("button", { name: 'Share today to earn 🌑 "Amaterasu" Achievement!' })).toBeInTheDocument();
    expect(screen.queryByText(/Tomorrow earns/)).not.toBeInTheDocument();
  });

  it("leaves a line with nothing to explain as plain text", async () => {
    // Cap full, no weekend left this week: beating the best is all that's ahead.
    const capped = { ...streak, currentStreak: 5, longestStreak: 6, bankedFreezes: 1 };
    render(<ComeBackCard streak={capped} date="2026-10-30" words={[]} />);
    expect(await screen.findByText(/days to beat your best streak/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

});
