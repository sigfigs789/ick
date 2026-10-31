import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonalBestCelebration } from "./PersonalBestCelebration";

describe("PersonalBestCelebration", () => {
  it("names the best day and the best it beat, over the rising confetti", () => {
    render(<PersonalBestCelebration best={{ kind: "day", score: 31.2, previous: 28.75 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Your best day ever!");
    expect(status).toHaveTextContent("31.20 today, past your old best of 28.75.");
    expect(document.querySelector(".confetti--rising")).not.toBeNull();
  });

  it("names the best week, over the grand confetti", () => {
    render(<PersonalBestCelebration best={{ kind: "week", score: 124.5, previous: 118 }} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Your best week ever!");
    expect(status).toHaveTextContent("124.50 this week, past your old best of 118.00.");
    expect(document.querySelector(".confetti--grand")).not.toBeNull();
  });

  it("goes on a tap of its ×, or by itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<PersonalBestCelebration best={{ kind: "day", score: 31, previous: 30 }} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
