import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WordRulesModal } from "./WordRulesModal";
import { MODE_CHOICE_START, resetModeCache, setMode } from "../game/mode";

const analytics = vi.hoisted(() => ({ trackWordSuggestion: vi.fn() }));
vi.mock("../analytics", () => ({ trackWordSuggestion: analytics.trackWordSuggestion }));

describe("WordRulesModal", () => {
  it("explains the word list and closes from its controls", async () => {
    const onClose = vi.fn();
    render(<WordRulesModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /word rules/i });
    expect(screen.getByRole("heading", { name: "Word rules" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/word list is sourced from scowl and wiktionary .*and contains more than 200,000 words/i);
    expect(dialog).toHaveTextContent(/proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words/i);
    expect(dialog).toHaveTextContent(/to keep play consistent.*aren't eligible for play/i);
    expect(dialog).toHaveTextContent(/used under.*cc by-sa 4\.0/i);
    expect(screen.getByRole("link", { name: "Wiktionary" })).toHaveAttribute("href", "https://en.wiktionary.org/");
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");
    expect(dialog).not.toHaveTextContent(/built and maintained by a solo developer/i);
    expect(dialog).toHaveTextContent(/continuously expanding the list to include more delightful and interesting words/i);
    expect(dialog).toHaveTextContent(/know a good one that's missing\? suggest it and everybody gets to play it/i);
    expect(screen.getByRole("button", { name: /close word rules/i })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: /close word rules/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("records a submitted word suggestion", async () => {
    render(<WordRulesModal open onClose={vi.fn()} />);

    const input = screen.getByLabelText(/suggest a word/i);
    expect(input).toHaveAttribute("placeholder", "Enter a word");
    await userEvent.type(input, "  Splashy ");
    await userEvent.click(screen.getByRole("button", { name: /suggest word/i }));

    expect(analytics.trackWordSuggestion).toHaveBeenCalledWith("splashy");
    expect(input).toHaveValue("");
    expect(screen.getByText(/thanks for the suggestion/i)).toBeInTheDocument();
  });

  it("offers the queue once a word is suggested, and closes on the way there", async () => {
    const onClose = vi.fn();
    window.history.pushState(null, "", "/");
    render(<WordRulesModal open onClose={onClose} />);

    await userEvent.type(screen.getByLabelText(/suggest a word/i), "splashy");
    await userEvent.click(screen.getByRole("button", { name: /suggest word/i }));
    await userEvent.click(screen.getByRole("button", { name: /see suggestions/i }));

    expect(onClose).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/suggested-words");
  });
});

describe("WordRulesModal during freeform week", () => {
  it("stops saying archaic words are unplayable while they are being played", () => {
    render(<WordRulesModal open date="2026-09-15" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // Sourcing and licensing are true whatever week it is.
    expect(dialog).toHaveTextContent(/sourced from SCOWL and Wiktionary/i);
    expect(dialog).toHaveTextContent(/it's freeform week, so almost all of it is in play/i);
    expect(dialog).not.toHaveTextContent(/aren't eligible for play/i);
  });

  it("says the usual rules outside the week", () => {
    render(<WordRulesModal open date="2026-09-13" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/aren't eligible for play/i);
  });
});

describe("WordRulesModal from the choice date", () => {
  beforeEach(() => {
    localStorage.clear();
    resetModeCache();
  });

  it("says the same thing in either mode, because the rules are the same", () => {
    // The modes differ in what a word is worth, not in which words there are.
    // A panel that made the eligibility sound mode-dependent would be inviting
    // players to switch for a word that plays either way.
    for (const mode of ["standard", "freeform"] as const) {
      setMode(mode);
      const { unmount } = render(
        <WordRulesModal open date={MODE_CHOICE_START} onClose={vi.fn()} />,
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog, mode).toHaveTextContent(/proper nouns and abbreviations count/i);
      expect(dialog, mode).toHaveTextContent(/in either mode/i);
      // The trial's wider promise is gone with the trial.
      expect(dialog, mode).not.toHaveTextContent(/it's freeform week/i);
      unmount();
    }
  });

  it("still refuses the age trio in the copy, as the game does", () => {
    setMode("standard");
    render(<WordRulesModal open date={MODE_CHOICE_START} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /obsolete, archaic or dated words, hyphenated words and words with punctuation aren't eligible/i,
    );
  });
});
