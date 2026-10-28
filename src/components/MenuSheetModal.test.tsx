import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MenuSheetModal } from "./MenuSheetModal";

const trackFeedbackSubmitted = vi.hoisted(() => vi.fn());
const trackWordSuggestion = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackFeedbackSubmitted, trackWordSuggestion }));

describe("the feedback sheet", () => {
  it("opens with the box focused, and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<MenuSheetModal sheet="feedback" onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Feedback" })).toBeInTheDocument();
    expect(screen.getByLabelText(/share feedback/i)).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("sends trimmed feedback to analytics, then clears the box and thanks the player", async () => {
    trackFeedbackSubmitted.mockClear();
    render(
<MenuSheetModal sheet="feedback" onClose={vi.fn()} />,
    );
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);
    const send = screen.getByRole("button", { name: /^send$/i });
    expect(send).toBeDisabled();

    await userEvent.type(box, "  more vowel drops please  ");
    await userEvent.click(send);

    expect(trackFeedbackSubmitted).toHaveBeenCalledWith(
      "more vowel drops please",
    );
    expect(box).toHaveValue("");
    expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
  });

  it("thanks the player without pointing them at everybody else's notes", async () => {
    window.history.pushState(null, "", "/");
    render(<MenuSheetModal sheet="feedback" onClose={vi.fn()} />);

    await userEvent.type(
      screen.getByLabelText(/share feedback or leave a suggestion/i),
      "more vowel drops please",
    );
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // A note is written to us, not to the other players: the confirmation says
    // it landed and offers nothing to open.
    expect(screen.getByRole("status")).toHaveTextContent(/thanks for the feedback/i);
    expect(screen.queryByRole("button", { name: /see what everyone/i })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("ignores a whitespace-only note rather than sending an empty event", async () => {
    trackFeedbackSubmitted.mockClear();
    render(
<MenuSheetModal sheet="feedback" onClose={vi.fn()} />,
    );
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);

    await userEvent.type(box, "   ");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    fireEvent.submit(box.closest("form")!);

    expect(trackFeedbackSubmitted).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/thanks for the feedback/i),
    ).not.toBeInTheDocument();
  });

});

describe("the suggest-a-word sheet", () => {
  it("sends the word, lowercased, and thanks the player", async () => {
    render(<MenuSheetModal sheet="suggest-word" onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Suggest a word" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "  Enshittification ");
    await userEvent.click(screen.getByRole("button", { name: "Suggest word" }));
    expect(trackWordSuggestion).toHaveBeenCalledWith("enshittification");
    expect(screen.getByText(/thanks for the suggestion/i)).toBeInTheDocument();
  });

  it("draws nothing when no sheet is open", () => {
    render(<MenuSheetModal sheet={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
