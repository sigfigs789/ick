import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WordRulesModal } from "./WordRulesModal";

const analytics = vi.hoisted(() => ({ trackWordSuggestion: vi.fn() }));
vi.mock("../analytics", () => ({ trackWordSuggestion: analytics.trackWordSuggestion }));

describe("WordRulesModal", () => {
  it("explains the curated list and closes from its controls", async () => {
    const onClose = vi.fn();
    render(<WordRulesModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /word rules/i });
    expect(dialog).toHaveTextContent(/curated word list is built from established english-language lexical resources and has over 180,000 words/i);
    expect(dialog).toHaveTextContent(/proper nouns, abbreviations, archaic or obsolete words, hyphenated words/i);
    expect(dialog).toHaveTextContent(/to keep play consistent.*aren't eligible for play/i);
    expect(dialog).toHaveTextContent(/built and maintained by a solo developer/i);
    expect(dialog).toHaveTextContent(/continuously expanding the list to include more delightful and interesting words/i);
    expect(dialog).toHaveTextContent(/have a good word in mind\? suggest it and improve the experience for everyone/i);
    expect(screen.getByRole("button", { name: /close word rules/i })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: /close word rules/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("records a submitted word suggestion", async () => {
    render(<WordRulesModal open onClose={vi.fn()} />);

    const input = screen.getByLabelText(/know a word we should consider/i);
    expect(input).toHaveAttribute("placeholder", "Enter word");
    await userEvent.type(input, "  Splashy ");
    await userEvent.click(screen.getByRole("button", { name: /suggest word/i }));

    expect(analytics.trackWordSuggestion).toHaveBeenCalledWith("splashy");
    expect(input).toHaveValue("");
    expect(screen.getByText(/thanks for the suggestion/i)).toBeInTheDocument();
  });
});
