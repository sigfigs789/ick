import { afterEach, describe, expect, it } from "vitest";
import { rarityScore } from "./dictionary";
import {
  assignShareNudgeArm,
  drawnShareNudgeArm,
  earnsShareNudge,
  forcedShareNudgeVariant,
} from "./shareNudgeTest";

afterEach(() => localStorage.clear());

const DATE = "2026-10-27";

/** A Zipf that scores `target` on DATE, found by bisection (scores fall as Zipf rises). */
function zipfScoring(target: number): number {
  let low = -2;
  let high = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (rarityScore(mid, DATE) > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

describe("earnsShareNudge", () => {
  it("asks for an average of Extremely Rare or better, as the average displays", () => {
    expect(earnsShareNudge([{ zipf: zipfScoring(8) }], DATE)).toBe(true);
    expect(earnsShareNudge([{ zipf: zipfScoring(7.96) }], DATE)).toBe(true);
    expect(earnsShareNudge([{ zipf: zipfScoring(7.9) }], DATE)).toBe(false);
  });

  it("averages every word, so one great find does not carry a weak puzzle", () => {
    const great = { zipf: zipfScoring(9.9) };
    const weak = { zipf: zipfScoring(4) };
    expect(earnsShareNudge([great, weak], DATE)).toBe(false);
    expect(earnsShareNudge([great, { zipf: zipfScoring(7) }], DATE)).toBe(true);
  });

  it("does not nudge a puzzle with no words", () => {
    expect(earnsShareNudge([], DATE)).toBe(false);
  });
});

describe("assignShareNudgeArm", () => {
  it("splits players 50/50", () => {
    expect(assignShareNudgeArm(() => 0.49)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignShareNudgeArm(() => 0.5)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignShareNudgeArm(() => 0.9);
    expect(assignShareNudgeArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
    expect(drawnShareNudgeArm()).toBe("hidden");
  });

  it("reads no arm before the draw", () => {
    expect(drawnShareNudgeArm()).toBeNull();
  });
});

describe("forcedShareNudgeVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedShareNudgeVariant("?share-nudge=shown")).toBe("shown");
    expect(forcedShareNudgeVariant("?share-nudge=hidden")).toBe("hidden");
    expect(forcedShareNudgeVariant("?share-nudge=maybe")).toBeNull();
  });

  it("forces NorthernBear87 to shown unless the query string says otherwise", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    expect(forcedShareNudgeVariant("")).toBe("shown");
    expect(forcedShareNudgeVariant("?share-nudge=hidden")).toBe("hidden");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedShareNudgeVariant("")).toBeNull();
  });
});
