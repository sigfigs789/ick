import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSeen, markSeen } from "./whatsNew";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("one-time new markers", () => {
  it("owes the badge until the feature has been met", () => {
    expect(hasSeen("leaderboard")).toBe(false);
    markSeen("leaderboard");
    expect(hasSeen("leaderboard")).toBe(true);
  });

  it("stays seen once seen, however many times it is marked", () => {
    markSeen("leaderboard");
    markSeen("leaderboard");
    expect(hasSeen("leaderboard")).toBe(true);
  });

  it("keeps the flag under its own namespaced key", () => {
    markSeen("leaderboard");
    expect(localStorage.getItem("ick:seen:leaderboard")).toBe("1");
  });

  it("reports seen when storage can't be read, rather than nagging forever", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    // A browser with no way to remember the dismissal should show no badge at
    // all -- an undismissable one on every load is the worse failure.
    expect(hasSeen("leaderboard")).toBe(true);
  });

  it("swallows a storage that can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => markSeen("leaderboard")).not.toThrow();
  });
});
