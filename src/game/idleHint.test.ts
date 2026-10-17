import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_HINT_TIERS,
  assignIdleHintArm,
  currentIdleHintArm,
  idleHintExperiment,
  idleHintText,
  idleHintWord,
} from "./idleHint";
import { evaluateSubmission } from "./submit";
import { recordVisit } from "./visits";

const DATE = "2026-10-17";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** A second session: the first one's visit is on record, this one's is not yet. */
function startReturningSession() {
  recordVisit("", "2026-10-16");
  sessionStorage.clear();
}

describe("the idle hint experiments", () => {
  it("puts a first session in the new-player experiment and a later one in the returning one", () => {
    expect(idleHintExperiment()).toBe("new");
    recordVisit("", DATE);
    // Reloads of that first session are still the first session.
    expect(idleHintExperiment()).toBe("new");

    startReturningSession();
    // Before App records this session's visit...
    expect(idleHintExperiment()).toBe("returning");
    recordVisit("", DATE);
    // ...and after.
    expect(idleHintExperiment()).toBe("returning");
  });

  it("splits 50/50 and keeps the arm it drew", () => {
    expect(assignIdleHintArm(() => 0.49)).toEqual({ experiment: "new", variant: "treatment", fresh: true });
    expect(assignIdleHintArm(() => 0.99)).toEqual({ experiment: "new", variant: "treatment", fresh: false });
    expect(currentIdleHintArm()).toEqual({ experiment: "new", variant: "treatment" });

    localStorage.clear();
    expect(assignIdleHintArm(() => 0.5)).toEqual({ experiment: "new", variant: "control", fresh: true });
  });

  it("draws the returning experiment on its own, keeping the new-player arm", () => {
    assignIdleHintArm(() => 0.1);
    startReturningSession();

    expect(currentIdleHintArm()).toBeNull();
    expect(assignIdleHintArm(() => 0.9)).toEqual({ experiment: "returning", variant: "control", fresh: true });
    expect(JSON.parse(localStorage.getItem("ick:idle-hint")!)).toEqual({ new: "treatment", returning: "control" });
  });

  it("leaves a browser that cannot store its arm out of the test", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(assignIdleHintArm()).toBeNull();
      expect(currentIdleHintArm()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("idleHintWord", () => {
  it("picks an Uncommon or Rare word with the drop that the puzzle would accept", () => {
    const hint = idleHintWord("str", DATE, []);
    expect(hint).toBeDefined();
    expect(hint!.word).toContain("str");
    expect(IDLE_HINT_TIERS).toContain(hint!.rarity);
    expect(evaluateSubmission(hint!.word, "str", [], DATE).ok).toBe(true);
  });

  it("is the same pick on every call", () => {
    expect(idleHintWord("ou", DATE, [])?.word).toBe(idleHintWord("ou", DATE, [])?.word);
  });

  it("never hints a word already banked", () => {
    const first = idleHintWord("str", DATE, [])!;
    const next = idleHintWord("str", DATE, [first]);
    expect(next).toBeDefined();
    expect(next!.word).not.toBe(first.word);
    expect(evaluateSubmission(next!.word, "str", [first], DATE).ok).toBe(true);
  });

  it("types the word behind an emoji", () => {
    expect(idleHintText("strudel")).toBe('💡 try "strudel"');
  });
});
