import { afterEach, describe, expect, it } from "vitest";
import { assignInputPlacementArm, drawnInputPlacementArm, forcedInputPlacementVariant } from "./inputPlacementTest";

afterEach(() => localStorage.clear());

describe("assignInputPlacementArm", () => {
  it("puts half below the guess log and keeps the other half above", () => {
    expect(assignInputPlacementArm(() => 0.49)).toEqual({ variant: "below", fresh: true });
    localStorage.clear();
    expect(assignInputPlacementArm(() => 0.5)).toEqual({ variant: "above", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignInputPlacementArm(() => 0.9);
    expect(assignInputPlacementArm(() => 0)).toEqual({ variant: "above", fresh: false });
    expect(drawnInputPlacementArm()).toBe("above");
  });

  it("reads no arm before the draw", () => {
    expect(drawnInputPlacementArm()).toBeNull();
  });
});

describe("forcedInputPlacementVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedInputPlacementVariant("?input-placement=below")).toBe("below");
    expect(forcedInputPlacementVariant("?input-placement=above")).toBe("above");
    expect(forcedInputPlacementVariant("?input-placement=middle")).toBeNull();
  });

  it("forces NorthernBear87 below unless the query string says otherwise", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    expect(forcedInputPlacementVariant("")).toBe("below");
    expect(forcedInputPlacementVariant("?input-placement=above")).toBe("above");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedInputPlacementVariant("")).toBeNull();
  });
});
