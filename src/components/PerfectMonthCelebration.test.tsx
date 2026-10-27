import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PerfectMonthCelebration } from "./PerfectMonthCelebration";
import { perfectMonthName } from "../game/perfectMonth";

describe("PerfectMonthCelebration", () => {
  it("names the month and the tally, over the grand confetti", () => {
    render(<PerfectMonthCelebration date="2026-09-30" days={30} onDone={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      `Perfect ${perfectMonthName("2026-09-30")}!`
    );
    expect(screen.getByRole("status")).toHaveTextContent("30 for 30");
    expect(document.querySelectorAll(".confetti--grand .confetti__piece")).toHaveLength(48);
  });

  it("goes on a tap of its ×, or by itself, but not on a tap elsewhere on it", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<PerfectMonthCelebration date="2026-09-30" days={30} onDone={onDone} />);
    fireEvent.click(document.querySelector(".perfect-month__card")!);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
