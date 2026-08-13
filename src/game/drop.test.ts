import { describe, expect, it } from "vitest";
import dropData from "../data/drops.json";
import { dropForDate } from "./drop";

// The published schedule is deliberately explicit: changing the rotation
// should be an intentional content decision, not an incidental reordering.
const PUBLISHED_DROPS = [
  "AT", "FL", "STR", "LT", "IG", "EA", "EP", "RM", "GHT", "IVE",
  "EE", "EL", "AS", "FR", "AC", "OT", "EV", "OUT", "ING", "IT",
  "SM", "RE", "GR", "UG", "IL", "PLE", "AL", "ER", "NK", "SC",
  "TR", "RK", "OO", "RN", "AW", "AP", "US", "EF", "OM", "EX",
  "SP", "RT", "END", "IV", "LD", "UM", "IM", "AI", "AV", "NE",
  "OW", "INT", "IS", "ENT", "OL", "ORT", "ANG", "AM", "ORD", "CK",
  "OR", "UP", "CR", "TER", "ITY", "AY", "NT", "OU", "SH", "ET",
  "RD", "ST", "DR", "LE", "AB", "AG", "TI", "CT", "AND", "EM",
  "ID", "ED", "UT", "BLE", "MPL", "EST", "OUN", "IC", "ONT", "AD",
  "ART", "ATE", "LY", "IN", "ULT", "OUR", "MP", "IND", "PL", "ARD",
  "PT", "IF", "EW", "TH", "WA", "ANT", "IP", "OP", "PR", "ND",
  "UND", "EN", "ON", "BL", "WI", "AR", "CL", "OUS", "OMP", "RG",
  "AN", "UNT", "ES", "ONG", "CH", "UN", "SL", "NG", "EC",
];

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

  it("keeps every published drop in its assigned date order", () => {
    expect(dropData.drops).toEqual(PUBLISHED_DROPS);

    const date = new Date(`${dropData.epoch}T00:00:00Z`);
    for (const drop of PUBLISHED_DROPS) {
      expect(dropForDate(date.toISOString().slice(0, 10))).toBe(drop);
      date.setUTCDate(date.getUTCDate() + 1);
    }
  });
});
