import { describe, expect, it } from "vitest";
import { DAYS_MILESTONES, daysMilestone } from "./daysMilestones";

describe("daysMilestone", () => {
  it("has none under a week", () => {
    expect(daysMilestone(0)).toBeNull();
    expect(daysMilestone(6)).toBeNull();
  });

  it("is the highest milestone reached", () => {
    expect(daysMilestone(7)?.emoji).toBe("🌱");
    expect(daysMilestone(49)?.emoji).toBe("🌙");
    expect(daysMilestone(99)?.emoji).toBe("⭐");
  });

  it("turns to 💯 at a hundred days, and keeps going past it", () => {
    expect(daysMilestone(100)?.emoji).toBe("💯");
    expect(daysMilestone(199)?.emoji).toBe("💯");
    expect(daysMilestone(200)?.emoji).toBe("💎");
    expect(daysMilestone(365)?.emoji).toBe("👑");
    expect(daysMilestone(1000)?.emoji).toBe("👑");
  });

  it("lists the milestones fewest days first", () => {
    const days = DAYS_MILESTONES.map((milestone) => milestone.days);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});
