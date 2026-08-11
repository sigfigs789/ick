import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { bestWordForDrop } from "../game/dictionary";

describe("DropDisplay", () => {
  it("shows the best-possible rarity but not the word while playing", () => {
    render(<DropDisplay drop="str" />);
    expect(screen.getByText(/best possible/i)).toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
  });

  it("reveals the rarest possible word once completed", () => {
    render(<DropDisplay drop="str" completed />);
    const best = bestWordForDrop("str");
    expect(screen.getByText(best!.word)).toBeInTheDocument();
  });
});
