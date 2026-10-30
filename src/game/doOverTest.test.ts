import { beforeEach, describe, expect, it } from "vitest";
import { assignDoOverArm, drawnDoOverArm, forcedDoOverVariant } from "./doOverTest";

beforeEach(() => localStorage.clear());

describe("do-over test", () => {
  it("draws once and keeps the arm", () => {
    expect(drawnDoOverArm()).toBeNull();
    expect(assignDoOverArm(() => 0.2)).toEqual({ variant: "shown", fresh: true });
    expect(assignDoOverArm(() => 0.9)).toEqual({ variant: "shown", fresh: false });
    expect(drawnDoOverArm()).toBe("shown");
  });

  it("splits 50/50", () => {
    expect(assignDoOverArm(() => 0.5)?.variant).toBe("hidden");
  });

  it("can be forced from the query string", () => {
    expect(forcedDoOverVariant("?do-over=hidden")).toBe("hidden");
    expect(forcedDoOverVariant("?do-over=shown")).toBe("shown");
    expect(forcedDoOverVariant("")).toBeNull();
  });
});
