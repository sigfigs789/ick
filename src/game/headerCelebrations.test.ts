import { beforeEach, describe, expect, it } from "vitest";
import { claimHeaderCelebration, headerCelebrationShown } from "./headerCelebrations";

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
});
