import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RarityBadge } from "./RarityBadge";

describe("RarityBadge", () => {
  it("renders Quotidian as the distinct black badge tier", () => {
    render(<RarityBadge rarity="Quotidian" zipf={7.7} />);

    const badge = screen.getByText(/quotidian/i);
    expect(badge).toHaveClass("rarity--quotidian");
  });
});
