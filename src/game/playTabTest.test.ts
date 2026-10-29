import { afterEach, describe, expect, it } from "vitest";
import { assignPlayTabArm, drawnPlayTabArm, forcedPlayTabVariant } from "./playTabTest";

afterEach(() => localStorage.clear());

describe("assignPlayTabArm", () => {
  it("shows the Play icon to 20% and keeps it off for the other 80%", () => {
    expect(assignPlayTabArm(() => 0.19)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignPlayTabArm(() => 0.2)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignPlayTabArm(() => 0.9);
    expect(assignPlayTabArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
    expect(drawnPlayTabArm()).toBe("hidden");
  });

  it("reads no arm before the draw", () => {
    expect(drawnPlayTabArm()).toBeNull();
  });
});

describe("forcedPlayTabVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedPlayTabVariant("?play-tab=shown")).toBe("shown");
    expect(forcedPlayTabVariant("?play-tab=hidden")).toBe("hidden");
    expect(forcedPlayTabVariant("?play-tab=maybe")).toBeNull();
  });

  it("forces FleetAspen87 to hidden unless the query string says otherwise", () => {
    // An id whose handle is FleetAspen87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-10338031" }));
    expect(forcedPlayTabVariant("")).toBe("hidden");
    expect(forcedPlayTabVariant("?play-tab=shown")).toBe("shown");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedPlayTabVariant("")).toBeNull();
  });
});
