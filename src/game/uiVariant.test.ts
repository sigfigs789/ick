import { beforeEach, describe, expect, it } from "vitest";
import {
  assignUiVariant,
  isNewPlayUi,
  setUiVariantForTest,
  takeFreshUiAssignment,
  uiVariant,
} from "./uiVariant";

describe("assignUiVariant", () => {
  beforeEach(() => {
    localStorage.clear();
    setUiVariantForTest("control");
  });

  it("puts 70% of browsers with no assignment on v2, and reports it once", () => {
    expect(assignUiVariant("", () => 0.69)).toBe("v2");
    expect(isNewPlayUi()).toBe(true);
    expect(takeFreshUiAssignment()).toEqual({ variant: "v2", visitType: "first" });
    expect(takeFreshUiAssignment()).toBeNull();

    localStorage.clear();
    expect(assignUiVariant("", () => 0.7)).toBe("control");
  });

  it("keeps a browser's variant across opens without reporting it again", () => {
    assignUiVariant("", () => 0.1);
    takeFreshUiAssignment();
    setUiVariantForTest("control");
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toBeNull();
  });

  it("splits returning players too, and says they were returning", () => {
    localStorage.setItem("ick:visits", JSON.stringify({ timesReturned: 3 }));
    assignUiVariant("", () => 0.1);
    expect(takeFreshUiAssignment()).toEqual({ variant: "v2", visitType: "returning" });
  });

  it("lets ?ui= force a variant, remembered but never reported", () => {
    expect(assignUiVariant("?ui=v2", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toBeNull();
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(assignUiVariant("?ui=control")).toBe("control");
    expect(uiVariant()).toBe("control");
  });

  it("puts NorthernBear87 on v2 without reporting or remembering it", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    localStorage.setItem("ick:ui-variant", "control");
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(isNewPlayUi()).toBe(true);
    expect(takeFreshUiAssignment()).toBeNull();
    expect(localStorage.getItem("ick:ui-variant")).toBe("control");
    expect(assignUiVariant("?ui=control")).toBe("control");
  });

  it("ignores an unknown stored value and assigns afresh", () => {
    localStorage.setItem("ick:ui-variant", "purple");
    expect(assignUiVariant("", () => 0.1)).toBe("v2");
  });
});
