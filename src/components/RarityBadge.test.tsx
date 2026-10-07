import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RarityBadge } from "./RarityBadge";
import { rarityFor } from "../game/dictionary";
import type { Rarity } from "../game/types";

// A pre-2026-08-15 puzzle date, where the top rank (Mythic) is anything scoring
// 9.5 or higher. See src/game/mythic-rarity.test.ts for the score boundary.
const LEGACY_DATE = "2026-08-14";

// Each ranking maps to its own color-bearing class and uppercase text tag, so
// the badge shows the correct color (via the class) and a color-independent
// label for every tier.
const BADGES: ReadonlyArray<[rarity: Rarity, className: string, tag: RegExp]> = [
  ["Very Common", "rarity--very-common", /very common/i],
  ["Common", "rarity--common", /common/i],
  ["Uncommon", "rarity--uncommon", /uncommon/i],
  ["Rare", "rarity--rare", /rare/i],
  ["Extremely Rare", "rarity--extremely-rare", /extremely rare/i],
  ["Elusive", "rarity--elusive", /elusive/i],
  ["Mythic", "rarity--mythic", /mythic/i],
  ["Legend", "rarity--legend", /legend/i],
];

describe("RarityBadge", () => {
  it("renders Legend as the distinct black badge tier", () => {
    render(<RarityBadge rarity="Legend" zipf={0.4} date={undefined} />);

    const badge = screen.getByText(/legend/i);
    expect(badge).toHaveClass("rarity--legend");
  });

  it.each(BADGES)("renders %s with its own color class and label", (rarity, className, tag) => {
    const { container } = render(<RarityBadge rarity={rarity} date={undefined} />);
    const badge = container.querySelector(".rarity-badge")!;
    expect(badge).toHaveClass(className);
    expect(badge.textContent).toMatch(tag);
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
