import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstructionsModal } from "./InstructionsModal";

const trackFeedbackSubmitted = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackFeedbackSubmitted }));

describe("InstructionsModal", () => {
  it("does not render until opened, then focuses its close button", () => {
    const { rerender } = render(<InstructionsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<InstructionsModal open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /how to play wordink/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close instructions/i })).toHaveFocus();
  });

  it("names Legend and Mythic as the highest ranks with their rarity thresholds", () => {
    render(<InstructionsModal open onClose={vi.fn()} />);
    expect(
      screen.getByText(/the highest ranks are Legend and Mythic at 9\.9\+ and 9\.5\+ rarity/i),
    ).toBeInTheDocument();
  });

  it("closes from Escape, its close button, or the backdrop, but not an in-dialog click", async () => {
    const onClose = vi.fn();
    render(<InstructionsModal open onClose={onClose} />);
    const dialog = screen.getByRole("dialog");

    await userEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /close instructions/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("sends trimmed feedback to analytics, then clears the box and thanks the player", async () => {
    trackFeedbackSubmitted.mockClear();
    render(<InstructionsModal open onClose={vi.fn()} />);
    const box = screen.getByLabelText(/have an idea or something to report/i);
    const send = screen.getByRole("button", { name: /send feedback/i });
    expect(send).toBeDisabled();

    await userEvent.type(box, "  more vowel drops please  ");
    await userEvent.click(send);

    expect(trackFeedbackSubmitted).toHaveBeenCalledWith("more vowel drops please");
    expect(box).toHaveValue("");
    expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
  });
});
