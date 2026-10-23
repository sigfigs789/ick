import { afterEach, describe, expect, it } from "vitest";
import { assignComeBackArm, forcedComeBackVariant } from "./comeBackTest";

afterEach(() => localStorage.clear());

describe("assignComeBackArm", () => {
  it("shows the line to half and hides it from the other half", () => {
    expect(assignComeBackArm(() => 0.49)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignComeBackArm(() => 0.5)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignComeBackArm(() => 0.9);
    expect(assignComeBackArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
  });
});

describe("forcedComeBackVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedComeBackVariant("?come-back=hidden")).toBe("hidden");
    expect(forcedComeBackVariant("?come-back=shown")).toBe("shown");
    expect(forcedComeBackVariant("?come-back=maybe")).toBeNull();
  });
});
