import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreakState } from "../game/types";

const trackReminderAdded = vi.fn();
vi.mock("../analytics", () => ({ trackReminderAdded }));

const { ComeBackCard } = await import("./ComeBackCard");

const streak: StreakState = {
  currentStreak: 2,
  longestStreak: 2,
  totalCompleted: 2,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

describe("ComeBackCard", () => {
  beforeEach(() => {
    localStorage.clear();
    trackReminderAdded.mockClear();
  });

  it("says when the next drop lands and what tomorrow does for the streak", () => {
    render(<ComeBackCard date="2026-10-23" streak={streak} />);
    expect(screen.getByText(/Next drop in/)).toBeInTheDocument();
    expect(screen.getByText("Play tomorrow to make it a 3-day streak.")).toBeInTheDocument();
    expect(screen.getByText(/Tomorrow earns a 🧊 freeze/)).toBeInTheDocument();
  });

  it("adds a Google Calendar reminder and stops asking", () => {
    const { unmount } = render(<ComeBackCard date="2026-10-23" streak={streak} />);
    fireEvent.click(screen.getByRole("button", { name: /Remind me daily/ }));
    const google = screen.getByRole("link", { name: "Google Calendar" });
    expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\//);
    fireEvent.click(google);
    expect(trackReminderAdded).toHaveBeenCalledWith("google");
    expect(screen.getByText("Daily reminder added")).toBeInTheDocument();

    unmount();
    render(<ComeBackCard date="2026-10-24" streak={streak} />);
    expect(screen.queryByRole("button", { name: /Remind me daily/ })).not.toBeInTheDocument();
  });

  it("leaves the reminder off where it is not offered", () => {
    render(<ComeBackCard date="2026-10-23" streak={streak} offerReminder={false} />);
    expect(screen.queryByRole("button", { name: /Remind me daily/ })).not.toBeInTheDocument();
  });
});
