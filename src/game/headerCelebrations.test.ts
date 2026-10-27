import { beforeEach, describe, expect, it } from "vitest";
import { claimHeaderCelebration, headerCelebrationShown, headerCelebrationsHeld } from "./headerCelebrations";
import { PROGRESS_PREFIX } from "./storage";

function bank(date: string, words: string[]) {
  localStorage.setItem(
    PROGRESS_PREFIX + date,
    JSON.stringify({
      date,
      drop: "str",
      acceptedWords: words.map((word) => ({ word, rarity: "Common", zipf: 4 })),
      rejectedAttempts: [],
      completed: false,
    })
  );
}

describe("header celebrations", () => {
  beforeEach(() => localStorage.clear());

  it("gives each group one card a day", () => {
    expect(claimHeaderCelebration("streak", "2026-10-25")).toBe(true);
    expect(claimHeaderCelebration("streak", "2026-10-25")).toBe(false);
    expect(headerCelebrationShown("streak", "2026-10-25")).toBe(true);
    expect(claimHeaderCelebration("streak", "2026-10-26")).toBe(true);
  });

  it("keeps the groups apart", () => {
    expect(claimHeaderCelebration("streak", "2026-10-25")).toBe(true);
    expect(headerCelebrationShown("news", "2026-10-25")).toBe(false);
    expect(claimHeaderCelebration("news", "2026-10-25")).toBe(true);
  });

  it("are held back from a new player until their third banked word", () => {
    expect(headerCelebrationsHeld()).toBe(true);
    bank("2026-10-24", ["string"]);
    bank("2026-10-25", ["strong"]);
    expect(headerCelebrationsHeld()).toBe(true);
    bank("2026-10-25", ["strong", "strange"]);
    expect(headerCelebrationsHeld()).toBe(false);
  });
});
