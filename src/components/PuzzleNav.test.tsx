import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PuzzleNav } from "./PuzzleNav";

describe("PuzzleNav", () => {
  it("announces the puzzle date and only enables available navigation", async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <PuzzleNav
        date="2026-08-12"
        puzzleNumber={957}
        canGoToPrevious
        canGoToNext={false}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    );

    expect(screen.getByText(/puzzle #957.*aug 12/i)).toHaveAttribute("aria-live", "polite");
    const previous = screen.getByRole("button", { name: /previous puzzle/i });
    const next = screen.getByRole("button", { name: /next puzzle/i });
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();

    await userEvent.click(previous);
    await userEvent.click(next);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("puts what it is given between the arrows in place of the puzzle number", () => {
    render(
      <PuzzleNav
        date="2026-08-12"
        puzzleNumber={957}
        canGoToPrevious
        canGoToNext
        onPrevious={() => {}}
        onNext={() => {}}
      >
        <p>Aug 12's drop</p>
      </PuzzleNav>
    );

    expect(screen.queryByText(/puzzle #957/i)).not.toBeInTheDocument();
    const middle = screen.getByText("Aug 12's drop");
    expect(screen.getByRole("button", { name: /previous puzzle/i }).nextElementSibling).toBe(middle);
    expect(screen.getByRole("button", { name: /next puzzle/i }).previousElementSibling).toBe(middle);
  });
});
