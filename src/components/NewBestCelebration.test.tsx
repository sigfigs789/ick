import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewBestCelebration } from "./NewBestCelebration";

describe("NewBestCelebration", () => {
  it("names the new streak and the best it passed, over the rising confetti", () => {
    render(<NewBestCelebration days={10} best={9} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Your longest streak yet!");
    expect(status).toHaveTextContent("10 days — past your best of 9.");
    expect(document.querySelectorAll(".confetti--rising .confetti__piece")).toHaveLength(48);
  });

  it("stays until it is tapped away", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<NewBestCelebration days={3} best={2} onDone={onDone} />);
    vi.advanceTimersByTime(60_000);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("shows a close mark in the corner that dismisses it like the rest of the card", () => {
    const onDone = vi.fn();
    render(<NewBestCelebration days={3} best={2} onDone={onDone} />);
    const close = document.querySelector(".improvement__close")!;
    expect(close).toHaveTextContent("×");
    expect(close).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(close);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
