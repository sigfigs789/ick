import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RarityBadge } from "./RarityBadge";
import { rarityFor } from "../game/dictionary";

// A pre-2026-08-15 puzzle date, where the top rank (Mythic) is anything scoring
// 9.5 or higher. See src/game/mythic-rarity.test.ts for the score boundary.
const LEGACY_DATE = "2026-08-14";

describe("RarityBadge", () => {
  it("renders Quotidian as the distinct black badge tier", () => {
    render(<RarityBadge rarity="Quotidian" zipf={7.7} />);

    const badge = screen.getByText(/quotidian/i);
    expect(badge).toHaveClass("rarity--quotidian");
  });

  it("shows the Mythic tier and its color class for a word scoring above 9.5", () => {
    const info = rarityFor("abatis", LEGACY_DATE)!; // Zipf 1.3 -> score 9.6
    render(<RarityBadge rarity={info.rarity} zipf={info.zipf} date={LEGACY_DATE} />);

    const badge = screen.getByText(/mythic/i);
    // rarity--mythic is what carries the Mythic colors (--rarity-mythic-*).
    expect(badge).toHaveClass("rarity--mythic");
    expect(badge).not.toHaveClass("rarity--extremely-rare");
    expect(badge).toHaveTextContent("9.6");
  });

  it("shows the Mythic tier for a perfect-10 word", () => {
    const info = rarityFor("abash", LEGACY_DATE)!; // Zipf 1.0 -> score 10.0
    render(<RarityBadge rarity={info.rarity} zipf={info.zipf} date={LEGACY_DATE} />);

    const badge = screen.getByText(/mythic/i);
    expect(badge).toHaveClass("rarity--mythic");
    expect(badge).toHaveTextContent("10.0");
  });

  it("shows Extremely Rare (not Mythic) for a word scoring just below 9.5", () => {
    const info = rarityFor("abacavir", LEGACY_DATE)!; // Zipf 1.4 -> score 9.4
    render(<RarityBadge rarity={info.rarity} zipf={info.zipf} date={LEGACY_DATE} />);

    const badge = screen.getByText(/extremely rare/i);
    // The tier just below the boundary gets its own (purple) color class...
    expect(badge).toHaveClass("rarity--extremely-rare");
    // ...and specifically not the Mythic (red) one.
    expect(badge).not.toHaveClass("rarity--mythic");
    expect(badge).toHaveTextContent("9.4");
  });
});
