import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreakState } from "../game/types";
import { ComeBackCard } from "./ComeBackCard";

const tracked = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ isReporting: () => true, trackComeBackAssigned: tracked }));

const streak: StreakState = {
  currentStreak: 2,
  longestStreak: 2,
  totalCompleted: 2,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
};

afterEach(() => {
  localStorage.clear();
  tracked.mockClear();
});

describe("ComeBackCard", () => {
  it("says the one thing tomorrow is worth to the shown arm", async () => {
    localStorage.setItem("ick:come-back-test", "shown");
    render(<ComeBackCard streak={streak} date="2026-10-22" />);
    expect(await screen.findByText(/Tomorrow earns a 🧊 freeze/)).toBeInTheDocument();
    expect(screen.queryByText(/make it a 3-day streak/)).not.toBeInTheDocument();
    expect(tracked).not.toHaveBeenCalled();
  });

  it("shows nothing to the hidden arm", async () => {
    localStorage.setItem("ick:come-back-test", "hidden");
    const { container } = render(<ComeBackCard streak={streak} date="2026-10-22" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a new player and reports the draw once", async () => {
    const { unmount } = render(<ComeBackCard streak={streak} date="2026-10-22" />);
    await vi.waitFor(() => expect(tracked).toHaveBeenCalledTimes(1));
    const variant = tracked.mock.calls[0][0];
    expect(["shown", "hidden"]).toContain(variant);
    expect(localStorage.getItem("ick:come-back-test")).toBe(variant);
    unmount();
    render(<ComeBackCard streak={streak} date="2026-10-22" />);
    await Promise.resolve();
    expect(tracked).toHaveBeenCalledTimes(1);
  });
});
