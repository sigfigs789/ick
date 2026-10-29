import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DaysClimbCelebration } from "./DaysClimbCelebration";

describe("DaysClimbCelebration", () => {
  it("names the days, the climb and the ranks, over the rising confetti", () => {
    render(<DaysClimbCelebration climb={{ from: 12, to: 9, days: 30 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Up the days-played board!");
    expect(status).toHaveTextContent("30 days played, and you've climbed 3 places");
    expect(status).toHaveTextContent("#12 → #9");
    expect(document.querySelectorAll(".confetti--rising .confetti__piece")).toHaveLength(48);
  });

  it("crowns a climb to the top, one place at a time", () => {
    render(<DaysClimbCelebration climb={{ from: 2, to: 1, days: 1 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Most days played!");
    expect(status).toHaveTextContent("1 day played, and you've climbed 1 place —");
  });

  it("goes on a tap of its ×, or by itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<DaysClimbCelebration climb={{ from: 5, to: 4, days: 8 }} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
