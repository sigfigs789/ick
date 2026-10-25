import { beforeEach, describe, expect, it } from "vitest";
import { assignHeaderCelebrationsArm, forcedHeaderCelebrationsVariant } from "./headerCelebrationsTest";

describe("the header celebrations test", () => {
  beforeEach(() => localStorage.clear());

  it("shows the cards to 75% and keeps each draw for good", () => {
    expect(assignHeaderCelebrationsArm(() => 0.74)).toEqual({ variant: "shown", fresh: true });
    expect(assignHeaderCelebrationsArm(() => 0.99)).toEqual({ variant: "shown", fresh: false });
    localStorage.clear();
    expect(assignHeaderCelebrationsArm(() => 0.75)).toEqual({ variant: "hidden", fresh: true });
  });

  it("can be forced from the address, unreported", () => {
    expect(forcedHeaderCelebrationsVariant("?header-celebrations=hidden")).toBe("hidden");
    expect(forcedHeaderCelebrationsVariant("?header-celebrations=shown")).toBe("shown");
    expect(forcedHeaderCelebrationsVariant("")).toBeNull();
  });
});
