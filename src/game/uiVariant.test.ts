import { beforeEach, describe, expect, it } from "vitest";
import {
  assignUiVariant,
  isNewPlayUi,
  setUiVariantForTest,
  takeFreshUiAssignment,
  uiVariant,
} from "./uiVariant";

function comeBack() {
  // A later session: a visit on record, and none from this tab.
  sessionStorage.clear();
  localStorage.setItem("ick:visits", JSON.stringify({ timesReturned: 1 }));
  setUiVariantForTest("control");
}

describe("assignUiVariant", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setUiVariantForTest("control");
  });

  it("puts 70% of first-ever sessions on v2, and reports it once as new", () => {
    expect(assignUiVariant("", () => 0.69)).toBe("v2");
    expect(isNewPlayUi()).toBe(true);
    expect(takeFreshUiAssignment()).toEqual({ experiment: "new", variant: "v2" });
    expect(takeFreshUiAssignment()).toBeNull();

    localStorage.clear();
    expect(assignUiVariant("", () => 0.7)).toBe("control");
  });

  it("keeps a browser's arm across opens without reporting it again", () => {
    assignUiVariant("", () => 0.1);
    takeFreshUiAssignment();
    setUiVariantForTest("control");
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toBeNull();
  });

  it("draws returning players on their own 50/50 coin, and reports it as returning", () => {
    expect(assignUiVariant("", () => 0.1)).toBe("v2");
    takeFreshUiAssignment();

    comeBack();
    expect(assignUiVariant("", () => 0.5)).toBe("control");
    expect(takeFreshUiAssignment()).toEqual({ experiment: "returning", variant: "control" });

    // Both arms are kept: every later session stays on the returning one.
    comeBack();
    expect(assignUiVariant("", () => 0.1)).toBe("control");
    expect(takeFreshUiAssignment()).toBeNull();
    expect(JSON.parse(localStorage.getItem("ick:ui-arms")!)).toEqual({ new: "v2", returning: "control" });
  });

  it("takes over the old everyone-alike draw for the experiment that needs one", () => {
    localStorage.setItem("ick:visits", JSON.stringify({ timesReturned: 3 }));
    localStorage.setItem("ick:ui-variant", "v2");
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toEqual({ experiment: "returning", variant: "v2" });
    expect(localStorage.getItem("ick:ui-variant")).toBeNull();
  });

  it("lets ?ui= force a variant, remembered but never reported", () => {
    expect(assignUiVariant("?ui=v2", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toBeNull();
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(takeFreshUiAssignment()).toBeNull();
    comeBack();
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(assignUiVariant("?ui=control")).toBe("control");
    expect(uiVariant()).toBe("control");
    expect(localStorage.getItem("ick:ui-arms")).toBeNull();
  });

  it("puts NorthernBear87 on v2 without reporting or remembering it", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    localStorage.setItem("ick:ui-arms", JSON.stringify({ new: "control" }));
    expect(assignUiVariant("", () => 0.9)).toBe("v2");
    expect(isNewPlayUi()).toBe(true);
    expect(takeFreshUiAssignment()).toBeNull();
    expect(localStorage.getItem("ick:ui-arms")).toBe(JSON.stringify({ new: "control" }));
    expect(assignUiVariant("?ui=control")).toBe("control");
  });

  it("ignores unknown stored values and assigns afresh", () => {
    localStorage.setItem("ick:ui-arms", JSON.stringify({ new: "purple" }));
    localStorage.setItem("ick:ui-variant", "purple");
    expect(assignUiVariant("", () => 0.1)).toBe("v2");
    localStorage.setItem("ick:ui-arms", "{not json");
    expect(assignUiVariant("", () => 0.9)).toBe("control");
  });
});
