import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DropDisplay } from "./DropDisplay";
import { bestWordForDrop, rarityScore } from "../game/dictionary";

describe("DropDisplay", () => {
  it("shows the best-possible score but not the rarity or word while playing", () => {
    render(<DropDisplay drop="str" />);
    const best = bestWordForDrop("str");
    expect(screen.getByText(`Best possible score: ${rarityScore(best!.zipf).toFixed(1)}`)).toBeInTheDocument();
    expect(screen.queryByText(/elusive/i)).not.toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
  });

  it("reveals the rarest possible word once completed", () => {
    render(<DropDisplay drop="str" completed />);
    const best = bestWordForDrop("str");
    expect(screen.getByText(best!.word)).toBeInTheDocument();
  });
});
