import { afterEach, describe, expect, it } from "vitest";
import { assignShareNameArm, drawnShareNameArm, forcedShareNameVariant } from "./shareNameTest";

afterEach(() => localStorage.clear());

describe("assignShareNameArm", () => {
  it("keeps the name on for half and starts it off for the other half", () => {
    expect(assignShareNameArm(() => 0.49)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignShareNameArm(() => 0.5)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignShareNameArm(() => 0.9);
    expect(assignShareNameArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
    expect(drawnShareNameArm()).toBe("hidden");
  });

  it("reads no arm before the draw", () => {
    expect(drawnShareNameArm()).toBeNull();
  });
});

describe("forcedShareNameVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedShareNameVariant("?share-name=hidden")).toBe("hidden");
    expect(forcedShareNameVariant("?share-name=shown")).toBe("shown");
    expect(forcedShareNameVariant("?share-name=maybe")).toBeNull();
  });
});
