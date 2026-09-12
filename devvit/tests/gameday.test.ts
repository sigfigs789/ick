/**
 * Which date a post gets, and the asymmetry it turns on.
 *
 * A post a day behind a player is harmless; a post a day ahead is nonsense.
 * So the date published is the one that has already arrived in the westernmost
 * place anybody plays from, and every test here is a moment when UTC and that
 * place disagree.
 */

import { describe, expect, it } from "vitest";
import { gameDay } from "../src/shared/windows";

describe("the day a post is created for", () => {
  it("is not ahead of Hawaii, which is the case that reported the bug", () => {
    // 16:04 on the 11th in Hawaii is already 02:04 on the 12th in UTC. The post
    // was dated the twelfth and the player's device said the eleventh.
    const moment = new Date("2026-09-12T02:04:45Z");
    expect(moment.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(gameDay(moment)).toBe("2026-09-11");
  });

  it("turns over exactly at midnight in the westernmost timezone", () => {
    // 10:00 UTC is midnight HST. A minute before, the old day; on the hour, the new.
    expect(gameDay(new Date("2026-09-12T09:59:00Z"))).toBe("2026-09-11");
    expect(gameDay(new Date("2026-09-12T10:00:00Z"))).toBe("2026-09-12");
  });

  it("agrees with UTC for most of the day", () => {
    // From 10:00 UTC to midnight UTC the two are the same date, which is the
    // majority of every day and why this was not obvious.
    expect(gameDay(new Date("2026-09-12T12:00:00Z"))).toBe("2026-09-12");
    expect(gameDay(new Date("2026-09-12T23:59:00Z"))).toBe("2026-09-12");
  });

  it("is never ahead of any device in the Americas, at any hour", () => {
    // Every ten minutes through a full day, against the westernmost US clock.
    const start = Date.parse("2026-09-12T00:00:00Z");
    for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
      const now = new Date(start + minutes * 60_000);
      const hawaiiDate = new Date(now.getTime() - 10 * 3600_000).toISOString().slice(0, 10);
      // Never later than the date on the westernmost device. Equal is fine;
      // ahead is the thing that reads as broken.
      expect(gameDay(now) <= hawaiiDate, now.toISOString()).toBe(true);
    }
  });
});
