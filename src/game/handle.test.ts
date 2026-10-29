import { describe, expect, it } from "vitest";
import {
  ADJECTIVES,
  LEGACY_ADJECTIVES,
  LEGACY_NOUNS,
  NOUNS,
  handleFor,
  namedFromLongLists,
} from "./handle";

const ID = "3f1a2b4c-5d6e-4f70-8901-23456789abcd";

/** The i-th of a run of UUIDs with the given version nibble. */
const uuid = (version: number, i: number) =>
  `${i.toString(16).padStart(8, "0")}-5d6e-${version}f70-8901-23456789abcd`;

/** The adjective and noun of a handle. */
const words = (handle: string) => handle.match(/^([A-Z][a-z]+)([A-Z][a-z]+)\d{1,2}$/);

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

  it("keeps the name every existing player already had", () => {
    // Every id minted before the lists grew is a v4 UUID (or, for the testers
    // and Muse AI, not a UUID at all), and its handle must never change: these
    // are the names those ids had on the board before the longer lists.
    expect(handleFor(ID)).toBe("SonicQuail13");
    expect(handleFor(ID.toUpperCase())).toBe("NorthernAnchor23");
    expect(handleFor("tester-3185178")).toBe("NorthernBear87");
    for (const id of [ID, "tester-3185178", "player-1", ""]) {
      expect(namedFromLongLists(id)).toBe(false);
    }
    for (let i = 0; i < 500; i += 1) {
      const parts = words(handleFor(uuid(4, i)));
      expect(LEGACY_ADJECTIVES).toContain(parts?.[1]);
      expect(LEGACY_NOUNS).toContain(parts?.[2]);
    }
  });

  it("names only v8 ids, the ones newPlayerId mints, from the longer lists", () => {
    expect(namedFromLongLists(uuid(8, 0))).toBe(true);
    expect(namedFromLongLists(uuid(8, 0).toUpperCase())).toBe(true);
    // A v8 shape with the wrong variant, or with junk around it, is not one.
    expect(namedFromLongLists(uuid(8, 0).replace("-8901-", "-c901-"))).toBe(false);
    expect(namedFromLongLists(`x${uuid(8, 0)}`)).toBe(false);
  });

  it("spreads across the whole list rather than clustering", () => {
    for (const [version, size, adjectiveList, nounList] of [
      [4, 128, LEGACY_ADJECTIVES, LEGACY_NOUNS],
      [8, 256, ADJECTIVES, NOUNS],
    ] as const) {
      const adjectives = new Set<string>();
      const nouns = new Set<string>();
      for (let i = 0; i < 4000; i += 1) {
        const parts = words(handleFor(uuid(version, i)));
        if (!parts) continue;
        adjectives.add(parts[1]);
        nouns.add(parts[2]);
      }
      // A hash that fed only a corner of either list would make duplicates far
      // likelier than the arithmetic in handleFor claims.
      expect(adjectives.size).toBeGreaterThan(size - 10);
      expect(nouns.size).toBeGreaterThan(size - 10);
      for (const word of adjectives) expect(adjectiveList).toContain(word);
      for (const word of nouns) expect(nounList).toContain(word);
    }
  });

  it("keeps each list a power of two long, with no word in it twice", () => {
    // handleFor slices the hash a byte per word; a list of any other length
    // would let the adjective and the noun share bits and move together.
    for (const [list, size] of [
      [ADJECTIVES, 256],
      [NOUNS, 256],
      [LEGACY_ADJECTIVES, 128],
      [LEGACY_NOUNS, 128],
    ] as const) {
      expect(list).toHaveLength(size);
      expect(new Set(list).size).toBe(size);
      for (const word of list) expect(word).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("matches its Postgres port, the newest migration defining player_handle", () => {
    // The analytics and achievement-rate reports name players by computing the
    // handle in SQL; if its lists drift from these, they name the wrong people.
    const migrations = import.meta.glob<string>("../../supabase/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const latest = Object.keys(migrations)
      .sort()
      .map((name) => migrations[name])
      .filter((sql) => /function public\.player_handle\(/.test(sql))
      .pop() ?? "";
    const list = (name: string) =>
      [...(latest.match(new RegExp(`\\b${name} constant text\\[\\] := array\\[([^\\]]*)\\]`))?.[1] ?? "")
        .matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(list("legacy_adjectives")).toEqual(LEGACY_ADJECTIVES);
    expect(list("legacy_nouns")).toEqual(LEGACY_NOUNS);
    expect(list("adjectives")).toEqual(ADJECTIVES);
    expect(list("nouns")).toEqual(NOUNS);
    expect(latest).toContain("legacy_adjectives[h % 128 + 1]");
    expect(latest).toContain("legacy_nouns[(h >> 8) % 128 + 1]");
    expect(latest).toContain(" adjectives[h % 256 + 1]");
    expect(latest).toContain(" nouns[(h >> 8) % 256 + 1]");
    expect(latest).toContain(
      "'^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
    );
  });
});
