import { afterEach, describe, expect, it } from "vitest";
import { assignComeBackArm, forcedComeBackVariant } from "./comeBackTest";

afterEach(() => localStorage.clear());

describe("assignComeBackArm", () => {
  it("shows the line to 75% and hides it from 25%", () => {
    expect(assignComeBackArm(() => 0.74)).toEqual({ variant: "show", fresh: true });
    localStorage.clear();
    expect(assignComeBackArm(() => 0.75)).toEqual({ variant: "hide", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignComeBackArm(() => 0.9);
    expect(assignComeBackArm(() => 0)).toEqual({ variant: "hide", fresh: false });
  });
});

describe("forcedComeBackVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedComeBackVariant("?come-back=hide")).toBe("hide");
    expect(forcedComeBackVariant("?come-back=show")).toBe("show");
    expect(forcedComeBackVariant("?come-back=maybe")).toBeNull();
  });
});
