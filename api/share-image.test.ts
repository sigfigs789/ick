import { describe, expect, it } from "vitest";
import { renderCard } from "./share-image";

describe("share image", () => {
  it("leaves profane free text off the picture", () => {
    const tree = JSON.stringify(
      renderCard({
        date: "2026-11-08",
        drop: "ink",
        words: [{ rarity: "Rare", score: "7.2", word: "shithead" }],
        total: "7.2",
        totalLabel: "Total",
        playerName: "fuckface",
      }),
    );
    expect(tree).toContain("7.2");
    expect(tree).not.toContain("shithead");
    expect(tree).not.toContain("fuckface");
  });

  it("draws the heading and stats as the share text writes them", () => {
    const tree = JSON.stringify(
      renderCard({
        date: "2026-11-08",
        drop: "ink",
        mode: "Standard",
        words: [{ rarity: "Legend", score: "10.00", word: "wrinkle" }],
        total: "10.0",
        totalLabel: "Today",
        streak: 1,
        playerName: "u/mo",
      }),
    );
    expect(tree).toContain("Nov 8 — Drop: INK · Standard");
    expect(tree).toContain("Streak: 1 day · Today: 10.0");
    expect(tree).toContain("Playing as u/mo");
    expect(tree).toContain("wrinkle");
  });
});
