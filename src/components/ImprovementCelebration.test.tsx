import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImprovementCelebration } from "./ImprovementCelebration";

const rise = { recent: 24.6, earlier: 20.5, days: 5 };

describe("ImprovementCelebration", () => {
  it("names the rise and the averages, over the rising confetti", () => {
    render(<ImprovementCelebration improvement={rise} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("You're on the rise!");
    expect(status).toHaveTextContent("last 5 puzzles is up 20%");
    expect(status).toHaveTextContent("20.50 → 24.60");
    expect(document.querySelectorAll(".confetti--rising .confetti__piece")).toHaveLength(48);
  });

  it("goes on a tap of its ×, or by itself, but not on a tap elsewhere on it", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<ImprovementCelebration improvement={rise} onDone={onDone} />);
    fireEvent.click(document.querySelector(".improvement__card")!);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
