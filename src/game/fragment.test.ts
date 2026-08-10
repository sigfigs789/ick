import { describe, expect, it } from "vitest";
import fragmentData from "../data/fragments.json";
import { fragmentForDate } from "./fragment";

describe("fragmentForDate", () => {
  it("is deterministic for the same date", () => {
    expect(fragmentForDate("2024-06-01")).toBe(fragmentForDate("2024-06-01"));
  });

  it("returns the first fragment on the epoch date", () => {
    expect(fragmentForDate(fragmentData.epoch)).toBe(fragmentData.fragments[0]);
  });

  it("cycles back to the same fragment after a full rotation", () => {
    const n = fragmentData.fragments.length;
    const later = new Date(`${fragmentData.epoch}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + n);
    const laterStr = later.toISOString().slice(0, 10);
    expect(fragmentForDate(laterStr)).toBe(fragmentForDate(fragmentData.epoch));
  });

  it("only ever returns fragments from the curated list", () => {
    expect(fragmentData.fragments).toContain(fragmentForDate("2025-03-17"));
  });
});
