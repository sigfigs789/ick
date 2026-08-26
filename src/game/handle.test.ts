import { describe, expect, it } from "vitest";
import { handleFor } from "./handle";

const ID = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";

describe("player handles", () => {
  it("is keyed off the player, not randomised", () => {
    // The whole point: a handle is a pure function of the id, so it is the same
    // on every call, every render, every device and every release. Nothing is
    // stored anywhere and nothing has to be looked up.
    const first = handleFor(ID);
    for (let i = 0; i < 100; i += 1) expect(handleFor(ID)).toBe(first);
  });

  it("gives different players different handles", () => {
    const handles = new Set(
      Array.from({ length: 500 }, (_, i) => handleFor(`player-${i}`))
    );
    // Not a uniqueness guarantee -- a hash cannot make one -- but at this size
    // duplicates should be rare enough not to show up on one board.
    expect(handles.size).toBeGreaterThan(495);
  });

  it("looks like a name, not like a word from the game", () => {
    // The reason this exists: on a page that also lists found words, a row
    // reading `asphyxiate` gave no clue whether it was a person or a word.
    for (const id of [ID, "player-1", "player-2", "0", ""]) {
      expect(handleFor(id)).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{1,2}$/);
    }
  });

  it("survives an id it was never designed for", () => {
    // Ids come from crypto.randomUUID in practice, but nothing downstream
    // should explode on an odd one.
    expect(handleFor("")).toMatch(/^[A-Z]/);
    expect(handleFor("🙂")).toMatch(/^[A-Z]/);
    expect(handleFor("a".repeat(5000))).toMatch(/^[A-Z]/);
  });

  it("spreads across the whole list rather than clustering", () => {
    const adjectives = new Set<string>();
    const nouns = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      const parts = handleFor(`p${i}`).match(/^([A-Z][a-z]+)([A-Z][a-z]+)\d{1,2}$/);
      if (!parts) continue;
      adjectives.add(parts[1]);
      nouns.add(parts[2]);
    }
    // Both lists hold 128 entries; a hash that fed only a corner of either would
    // make duplicates far likelier than the arithmetic in handleFor claims.
    expect(adjectives.size).toBeGreaterThan(120);
    expect(nouns.size).toBeGreaterThan(120);
  });
});
