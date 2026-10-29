import { afterEach, describe, expect, it } from "vitest";
import { assignWordOfDayVariant, currentWordOfDayVariant, forcedWordOfDayVariant } from "./wordOfDay";

afterEach(() => localStorage.clear());

describe("word of the day experiment", () => {
  it("draws once and keeps the arm", () => {
    expect(currentWordOfDayVariant()).toBeNull();
    expect(assignWordOfDayVariant(() => 0.7)).toEqual({ variant: "hidden", fresh: true });
    expect(assignWordOfDayVariant(() => 0.1)).toEqual({ variant: "hidden", fresh: false });
    expect(currentWordOfDayVariant()).toBe("hidden");
  });

  it("splits at a half", () => {
    expect(assignWordOfDayVariant(() => 0.49)?.variant).toBe("shown");
  });

  it("forces an arm from the query string, and nothing else", () => {
    expect(forcedWordOfDayVariant("?word-of-day=hidden")).toBe("hidden");
    expect(forcedWordOfDayVariant("?word-of-day=shown")).toBe("shown");
    expect(forcedWordOfDayVariant("?word-of-day=maybe")).toBeNull();
  });

  it("forces FleetAspen87 to shown unless the query string says otherwise", () => {
    // An id whose handle is FleetAspen87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-10338031" }));
    expect(forcedWordOfDayVariant("")).toBe("shown");
    expect(forcedWordOfDayVariant("?word-of-day=hidden")).toBe("hidden");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedWordOfDayVariant("")).toBeNull();
  });
});
