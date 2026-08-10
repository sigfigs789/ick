import { describe, expect, it } from "vitest";
import dropData from "../data/drops.json";
import { dropForDate } from "./drop";

describe("dropForDate", () => {
  it("is deterministic for the same date", () => {
    expect(dropForDate("2024-06-01")).toBe(dropForDate("2024-06-01"));
  });

  it("returns the first drop on the epoch date", () => {
    expect(dropForDate(dropData.epoch)).toBe(dropData.drops[0]);
  });

  it("cycles back to the same drop after a full rotation", () => {
    const n = dropData.drops.length;
    const later = new Date(`${dropData.epoch}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + n);
    const laterStr = later.toISOString().slice(0, 10);
    expect(dropForDate(laterStr)).toBe(dropForDate(dropData.epoch));
  });

  it("only ever returns drops from the curated list", () => {
    expect(dropData.drops).toContain(dropForDate("2025-03-17"));
  });
});
