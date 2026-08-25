import { beforeEach, describe, expect, it } from "vitest";
import { forgetPlayer, loadPlayer, normalizeName, savePlayerName } from "./player";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  localStorage.clear();
});

describe("display names", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeName("  word   smith ")).toBe("word smith");
  });

  it("caps the length the board has room for", () => {
    expect(normalizeName("a".repeat(40))).toBe("a".repeat(18));
    // A cap landing mid-space must not leave a trailing one.
    expect(normalizeName(`${"a".repeat(17)} tail`)).toBe("a".repeat(17));
  });

  it("strips characters that would be invisible on the board", () => {
    // Zero-width space, a bidi override, and a BOM: each either invisible or
    // able to reorder the names around it.
    expect(normalizeName("Mo​Jo")).toBe("Mo Jo");
    expect(normalizeName("‮Mo")).toBe("Mo");
    expect(normalizeName("﻿Mo﻿")).toBe("Mo");
    expect(normalizeName("​​")).toBeNull();
  });

  it("keeps names that aren't written in Latin letters", () => {
    expect(normalizeName("ありがと")).toBe("ありがと");
    expect(normalizeName("Zoë 🐈")).toBe("Zoë 🐈");
  });

  it("rejects a name with nothing usable in it", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName("x")).toBeNull();
  });
});

describe("the player on this browser", () => {
  it("has nobody until someone joins", () => {
    expect(loadPlayer()).toBeNull();
  });

  it("mints a v4 uuid on joining and keeps it across a rename", () => {
    const joined = savePlayerName("Mo");
    expect(joined?.id).toMatch(UUID_RE);
    expect(joined?.name).toBe("Mo");

    const renamed = savePlayerName("Maureen");
    // The id is the identity, so a rename must not start a second entry.
    expect(renamed?.id).toBe(joined?.id);
    expect(loadPlayer()).toEqual({ id: joined?.id, name: "Maureen" });
  });

  it("gives two browsers two identities", () => {
    const first = savePlayerName("Mo")?.id;
    forgetPlayer();
    expect(savePlayerName("Mo")?.id).not.toBe(first);
  });

  it("saves nothing for a name it won't accept", () => {
    expect(savePlayerName(" ")).toBeNull();
    expect(loadPlayer()).toBeNull();
  });

  it("treats a corrupted or half-written record as nobody", () => {
    localStorage.setItem("ick:player", "{not json");
    expect(loadPlayer()).toBeNull();

    localStorage.setItem("ick:player", JSON.stringify({ id: "abc" }));
    expect(loadPlayer()).toBeNull();

    localStorage.setItem("ick:player", JSON.stringify({ id: "abc", name: " " }));
    expect(loadPlayer()).toBeNull();
  });

  it("normalises a name read back out of storage", () => {
    localStorage.setItem("ick:player", JSON.stringify({ id: "abc", name: "  Mo​ " }));
    expect(loadPlayer()).toEqual({ id: "abc", name: "Mo" });
  });

  it("forgets the id along with the name, so rejoining is joining anew", () => {
    savePlayerName("Mo");
    forgetPlayer();
    expect(loadPlayer()).toBeNull();
  });
});
