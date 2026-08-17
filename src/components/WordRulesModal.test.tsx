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
    expect(screen.getByRole("heading", { name: "Word rules" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      /curated word list is sourced from scowl, wiktionary .*and more, and contains over 200,000 words/i
    );
    // The live fallback is named, so a player can tell why an off-list word counted.
    expect(dialog).toHaveTextContent(
      /also uses merriam-webster to check words that aren't on the list yet/i
    );
    expect(screen.getByRole("link", { name: "Merriam-Webster" })).toHaveAttribute(
      "href",
      "https://dictionaryapi.com/"
    );
    expect(dialog).toHaveTextContent(/proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words/i);
    expect(dialog).toHaveTextContent(/to keep play consistent.*aren't eligible for play/i);
    expect(dialog).toHaveTextContent(/used under.*cc by-sa 4\.0/i);
    expect(screen.getByRole("link", { name: "Wiktionary" })).toHaveAttribute("href", "https://en.wiktionary.org/");
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");
    expect(dialog).not.toHaveTextContent(/built and maintained by a solo developer/i);
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
