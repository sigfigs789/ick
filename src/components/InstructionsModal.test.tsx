import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstructionsModal } from "./InstructionsModal";
import { MAX_GUESSES } from "../game/constants";

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

  it("explains the streak, locking in, and the day's word limit", () => {
    render(<InstructionsModal open onClose={vi.fn()} />);
    expect(screen.getByText(/any valid word keeps your streak going/i)).toBeInTheDocument();
    expect(screen.getByText(/miss a day and your streak resets to 0/i)).toBeInTheDocument();
    // The number comes from the constant, so a future change to the limit moves
    // the copy with it instead of leaving a stale figure in front of a new player.
    expect(
      screen.getByText(new RegExp(`up to ${MAX_GUESSES} words a day`, "i")),
    ).toBeInTheDocument();
  });

  it("names Mythic and Legend as the highest ranks with their rarity thresholds", () => {
    render(<InstructionsModal open onClose={vi.fn()} />);
    expect(
      screen.getByText(/the highest ranks are Mythic at 9\.5\+ and Legend at 9\.9\+/i),
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
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);
    const send = screen.getByRole("button", { name: /^send$/i });
    expect(send).toBeDisabled();

    await userEvent.type(box, "  more vowel drops please  ");
    await userEvent.click(send);

    expect(trackFeedbackSubmitted).toHaveBeenCalledWith("more vowel drops please");
    expect(box).toHaveValue("");
    expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
  });

  it("ignores a whitespace-only note rather than sending an empty event", async () => {
    trackFeedbackSubmitted.mockClear();
    render(<InstructionsModal open onClose={vi.fn()} />);
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);

    await userEvent.type(box, "   ");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    fireEvent.submit(box.closest("form")!);

    expect(trackFeedbackSubmitted).not.toHaveBeenCalled();
    expect(screen.queryByText(/thanks for the feedback/i)).not.toBeInTheDocument();
  });
});
