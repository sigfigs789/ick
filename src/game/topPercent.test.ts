import { describe, expect, it } from "vitest";
import { topPercentBand } from "./topPercent";

describe("topPercentBand", () => {
  it("awards the tightest band a rank reaches", () => {
    expect(topPercentBand(2, 200)).toBe(1);
    expect(topPercentBand(3, 200)).toBe(5);
    expect(topPercentBand(10, 200)).toBe(5);
    expect(topPercentBand(11, 200)).toBe(10);
    expect(topPercentBand(20, 200)).toBe(10);
    expect(topPercentBand(21, 200)).toBeNull();
  });

  it("only hands out a band once the board is big enough to have one", () => {
    // Second of three is not the top 5% of anything worth saying.
    expect(topPercentBand(2, 3)).toBeNull();
    expect(topPercentBand(2, 19)).toBeNull();
    expect(topPercentBand(2, 20)).toBe(10);
    expect(topPercentBand(2, 40)).toBe(5);
    expect(topPercentBand(2, 199)).toBe(5);
  });

  it("leaves the leader to the trophy", () => {
    expect(topPercentBand(1, 500)).toBeNull();
  });

  it("gives nothing to a lost run or a rank off the board", () => {
    expect(topPercentBand(null, 500)).toBeNull();
    expect(topPercentBand(0, 500)).toBeNull();
    expect(topPercentBand(501, 500)).toBeNull();
  });
});
