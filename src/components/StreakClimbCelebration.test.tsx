import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreakClimbCelebration } from "./StreakClimbCelebration";

describe("StreakClimbCelebration", () => {
  it("names the climb and the ranks, over the rising confetti", () => {
    render(<StreakClimbCelebration climb={{ from: 12, to: 9 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Up the streak board!");
    expect(status).toHaveTextContent("climbed 3 places");
    expect(status).toHaveTextContent("#12 → #9");
    expect(document.querySelectorAll(".confetti--rising .confetti__piece")).toHaveLength(48);
  });

  it("crowns a climb to the top, one place at a time", () => {
    render(<StreakClimbCelebration climb={{ from: 2, to: 1 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Top of the streak board!");
    expect(status).toHaveTextContent("climbed 1 place —");
  });

  it("goes on a tap, or by itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<StreakClimbCelebration climb={{ from: 5, to: 4 }} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
