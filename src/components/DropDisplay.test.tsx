import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { bestWordForDrop } from "../game/dictionary";

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

  it("reveals the rarest possible word once completed", () => {
    render(<DropDisplay drop="str" completed />);
    const best = bestWordForDrop("str");
    expect(screen.getByText(best!.word)).toBeInTheDocument();
  });
});
