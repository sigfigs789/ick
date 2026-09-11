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
    expect(hasSeen("instructions")).toBe(false);
    markSeen("instructions");
    expect(hasSeen("instructions")).toBe(true);
  });

  it("stays seen once seen, however many times it is marked", () => {
    markSeen("instructions");
    markSeen("instructions");
    expect(hasSeen("instructions")).toBe(true);
  });

  it("keeps the flag under its own namespaced key", () => {
    markSeen("instructions");
    expect(localStorage.getItem("ick:seen:instructions")).toBe("1");
  });

  it("reports seen when storage can't be read, rather than nagging forever", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    // A browser with no way to remember the dismissal should show no badge at
    // all -- an undismissable one on every load is the worse failure.
    expect(hasSeen("instructions")).toBe(true);
  });

  it("swallows a storage that can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => markSeen("instructions")).not.toThrow();
  });
});
