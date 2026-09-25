import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WordRulesModal } from "./WordRulesModal";
import { MODE_CHOICE_START, resetModeCache, setMode } from "../game/mode";

const analytics = vi.hoisted(() => ({ trackWordSuggestion: vi.fn() }));
vi.mock("../analytics", () => ({ trackWordSuggestion: analytics.trackWordSuggestion }));

describe("WordRulesModal", () => {
  it("explains what's eligible and closes from its controls", async () => {
    const onClose = vi.fn();
    render(<WordRulesModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /word rules/i });
    expect(screen.getByRole("heading", { name: "Word rules" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/proper nouns, abbreviations, misspellings, obsolete, archaic, or dated words, hyphenated words/i);
    expect(dialog).toHaveTextContent(/to keep play consistent.*aren't eligible for play/i);
    // Sourcing, licensing and list size moved to the terms; scoring lives in
    // How to play. This panel is eligibility and the suggestion box only.
    expect(dialog).not.toHaveTextContent(/scowl|wiktionary|cc by-sa|more than [0-9]/i);
    expect(dialog).toHaveTextContent(/know a good word that's missing\? suggest it and everybody gets to play it/i);
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
    expect(dialog).toHaveTextContent(/it's freeform week, so proper nouns, abbreviations/i);
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

  it("lets Freeform keep the age trio, and Standard refuse it", () => {
    // The one eligibility rule the modes disagree on. Both keep the trial's
    // verdict on names; only Freeform keeps its appetite for old words.
    setMode("freeform");
    const { unmount } = render(
      <WordRulesModal open date={MODE_CHOICE_START} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      /in freeform, proper nouns, abbreviations, and obsolete, archaic or dated words all count/i,
    );
    // The trial's own wording is gone with the trial.
    expect(dialog).not.toHaveTextContent(/it's freeform week/i);
    unmount();

    setMode("standard");
    render(<WordRulesModal open date={MODE_CHOICE_START} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/proper nouns and abbreviations count/i);
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/in freeform/i);
  });

  it("still refuses the age trio in the copy, as the game does", () => {
    setMode("standard");
    render(<WordRulesModal open date={MODE_CHOICE_START} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /obsolete, archaic or dated words, hyphenated words and words with punctuation aren't eligible/i,
    );
  });
});
