import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopRankCelebration } from "./TopRankCelebration";

describe("TopRankCelebration", () => {
  it("names the place, with a link to the leaderboard", () => {
    render(<TopRankCelebration rank={2} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("🥈");
    expect(status).toHaveTextContent("Top 3 today!");
    expect(status).toHaveTextContent("You're #2 on today's board.");
    expect(screen.getByRole("link", { name: "See the leaderboard" })).toHaveAttribute("href", "/leaderboard");
  });

  it("crowns first place", () => {
    render(<TopRankCelebration rank={1} onDone={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("#1 today!");
  });

  it("goes on a tap of its ×, or by itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<TopRankCelebration rank={3} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
