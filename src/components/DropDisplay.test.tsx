import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { definitionFor, formatRarityScore, learnableWordForDrop } from "../game/dictionary";

describe("DropDisplay", () => {
  it("labels archived puzzles with their calendar date", () => {
    const { rerender } = render(<DropDisplay drop="str" />);
    expect(screen.getByText("Today's drop")).toBeInTheDocument();

    rerender(<DropDisplay drop="str" date="2026-08-11" isToday={false} />);
    expect(screen.getByText("Aug 11's drop")).toBeInTheDocument();
  });

  it("shows the best-possible score but not the rarity or word while playing", () => {
    render(<DropDisplay drop="str" />);
    expect(screen.getByText("Best possible score: 10.0")).toBeInTheDocument();
    expect(screen.queryByText(/mythic/i)).not.toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
  });

  it("reveals a learnable word and its score once completed", () => {
    render(<DropDisplay drop="str" completed />);
    const reveal = learnableWordForDrop("str")!;
    expect(screen.getByText(reveal.word, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(formatRarityScore(reveal.zipf))).toBeInTheDocument();
  });

  it("keeps the definition one click away, and in the reading order meanwhile", async () => {
    render(<DropDisplay drop="str" completed />);
    const reveal = learnableWordForDrop("str")!;
    const definition = definitionFor(reveal.word)!;
    const toggle = screen.getByRole("button", { name: new RegExp(reveal.word) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Present but hidden from the eye, so a screen reader still reads it.
    expect(screen.getByText(definition)).toHaveClass("sr-only");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(definition)).not.toHaveClass("sr-only");
  });

  it("closes the definition when the puzzle changes underneath it", async () => {
    const { rerender } = render(<DropDisplay drop="str" completed />);
    const toggle = screen.getByRole("button", { name: /./ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    rerender(<DropDisplay drop="ple" date="2026-08-11" isToday={false} completed />);
    expect(screen.getByRole("button", { name: /./ })).toHaveAttribute("aria-expanded", "false");
  });
});
