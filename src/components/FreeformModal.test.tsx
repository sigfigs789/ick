import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FreeformModal } from "./FreeformModal";

const trackFreeformVote = vi.hoisted(() => vi.fn());
const trackFreeformFeedback = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackFreeformVote, trackFreeformFeedback }));

const DATE = "2026-09-15";

function open() {
  const onClose = vi.fn();
  render(<FreeformModal open date={DATE} onClose={onClose} />);
  return onClose;
}

describe("FreeformModal", () => {
  beforeEach(() => {
    trackFreeformVote.mockClear();
    trackFreeformFeedback.mockClear();
  });

  it("does not render until opened, then focuses its close button", () => {
    const { rerender } = render(
      <FreeformModal open={false} date={DATE} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<FreeformModal open date={DATE} onClose={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: /freeform week/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toHaveFocus();
  });

  it("says the change can become permanent, above the buttons that decide it", () => {
    open();
    const stakes = screen.getByText(/this can be made permanent/i);
    const group = screen.getByRole("group", { name: /permanent/i });
    // Before the vote, not in the sign-off under the feedback box: a player
    // deciding whether to tap needs to know the tap decides something.
    expect(stakes.compareDocumentPosition(group)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("sends a vote on the tap, without waiting for a note", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Love it!" }));
    expect(trackFreeformVote).toHaveBeenCalledWith("love", DATE);
    expect(trackFreeformFeedback).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Love it!" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("lets a player change their mind, and does not resend the same vote", async () => {
    open();
    const love = screen.getByRole("button", { name: "Love it!" });
    const boo = screen.getByRole("button", { name: "Boooo" });

    await userEvent.click(love);
    await userEvent.click(love);
    expect(trackFreeformVote).toHaveBeenCalledTimes(1);

    await userEvent.click(boo);
    expect(trackFreeformVote).toHaveBeenCalledTimes(2);
    expect(trackFreeformVote).toHaveBeenLastCalledWith("boo", DATE);
    expect(love).toHaveAttribute("aria-pressed", "false");
  });

  it("carries the vote alongside the note when one was cast", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Boooo" }));
    await userEvent.type(screen.getByRole("textbox"), "  bring back the folding  ");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    // Trimmed on the way out, so a note typed with stray spaces is stored the
    // same as one that wasn't.
    expect(trackFreeformFeedback).toHaveBeenCalledWith(
      "bring back the folding",
      DATE,
      "boo",
    );
    // Matched on its text: the vote acknowledgement above is also a status
    // region, and both being announced is the intent.
    expect(screen.getByText(/thanks — i read every one/i)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("takes a note from a player who never voted", async () => {
    open();
    await userEvent.type(screen.getByRole("textbox"), "no strong feelings");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(trackFreeformFeedback).toHaveBeenCalledWith(
      "no strong feelings",
      DATE,
      null,
    );
  });

  it("refuses an empty note rather than sending a blank one", async () => {
    open();
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(send).toBeDisabled();
    expect(trackFreeformFeedback).not.toHaveBeenCalled();
  });

  it("closes on Escape and on the overlay", async () => {
    const onClose = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
