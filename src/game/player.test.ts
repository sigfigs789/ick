import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountName,
  hasJoined,
  joinBoard,
  leaveBoard,
  loadPlayerId,
  setAccount,
} from "./player";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  localStorage.clear();
});

describe("the player on this browser", () => {
  it("has nobody until someone joins", () => {
    expect(loadPlayerId()).toBeNull();
    expect(hasJoined()).toBe(false);
  });

  it("mints a v4 uuid on joining", () => {
    const id = joinBoard();
    expect(id).toMatch(UUID_RE);
    expect(loadPlayerId()).toBe(id);
    expect(hasJoined()).toBe(true);
  });

  it("keeps the first id when joining again", () => {
    const first = joinBoard();
    // Idempotent, so a second tap cannot split one player into two entries.
    expect(joinBoard()).toBe(first);
    expect(loadPlayerId()).toBe(first);
  });

  it("gives two browsers two identities", () => {
    const first = joinBoard();
    leaveBoard();
    expect(joinBoard()).not.toBe(first);
  });

  it("stores nothing but the id", () => {
    joinBoard();
    // No name, and nothing else personal: what the board calls a player is
    // computed from their own words (see leaderboard.boardName).
    expect(Object.keys(JSON.parse(localStorage.getItem("ick:player") ?? "{}"))).toEqual(["id"]);
  });

  it("treats a corrupted or half-written record as nobody", () => {
    localStorage.setItem("ick:player", "{not json");
    expect(loadPlayerId()).toBeNull();

    localStorage.setItem("ick:player", JSON.stringify({ name: "Mo" }));
    expect(loadPlayerId()).toBeNull();

    localStorage.setItem("ick:player", JSON.stringify({ id: "" }));
    expect(loadPlayerId()).toBeNull();
  });

  it("reports nobody when storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPlayerId()).toBeNull();
    vi.restoreAllMocks();
  });

  it("refuses to join when the id cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    // Better to say the join failed than to hand back an id that will be gone
    // on the next load.
    expect(joinBoard()).toBeNull();
    vi.restoreAllMocks();
  });

  it("forgets the id, so rejoining is joining anew", () => {
    joinBoard();
    leaveBoard();
    expect(loadPlayerId()).toBeNull();
  });
});

describe("playing as an account", () => {
  afterEach(() => {
    // Back to the browser's own identity, or every test after this one is
    // signed in as somebody.
    setAccount(null);
  });

  it("is off by default, which is what this site relies on", () => {
    expect(accountName()).toBeNull();
  });

  it("is the id that goes up with a score, so the server records the right one", () => {
    joinBoard();
    const browserId = loadPlayerId();
    setAccount("some_redditor");
    expect(loadPlayerId()).toBe("some_redditor");
    expect(loadPlayerId()).not.toBe(browserId);
  });

  it("needs no minting and stores nothing", () => {
    setAccount("some_redditor");
    expect(joinBoard()).toBe("some_redditor");
    setAccount(null);
    // Nothing was written under the account, so the browser is still unjoined.
    expect(hasJoined()).toBe(false);
  });

  it("hands identity back to the browser when cleared", () => {
    setAccount("some_redditor");
    setAccount(null);
    const id = joinBoard();
    expect(id).not.toBe("some_redditor");
    expect(loadPlayerId()).toBe(id);
  });
});
