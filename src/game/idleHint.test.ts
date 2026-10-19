import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_HINT_TIERS,
  assignIdleHintArm,
  currentIdleHintArm,
  idleHintExperiment,
  forcedIdleHintVariant,
  pinIdleHintVariant,
  idleHintText,
  idleHintWords,
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

describe("idleHintWords", () => {
  it("picks three Common or Very Common words with the drop that the puzzle would accept together", () => {
    const hints = idleHintWords("str", DATE, []);
    expect(hints).toHaveLength(3);
    const banked = [];
    for (const hint of hints) {
      expect(hint.word).toContain("str");
      expect(hint.word.length).toBeGreaterThanOrEqual(5);
      expect(IDLE_HINT_TIERS).toContain(hint.rarity);
      // Distinct roots: each is still accepted after the ones before it.
      expect(evaluateSubmission(hint.word, "str", [...banked], DATE).ok).toBe(true);
      banked.push(hint);
    }
  });

  it("is the same picks on every call", () => {
    expect(idleHintWords("ou", DATE, []).map((w) => w.word)).toEqual(
      idleHintWords("ou", DATE, []).map((w) => w.word)
    );
  });

  it("never hints a word already banked", () => {
    const [first] = idleHintWords("str", DATE, []);
    const next = idleHintWords("str", DATE, [first]);
    expect(next).toHaveLength(3);
    expect(next.map((w) => w.word)).not.toContain(first.word);
  });

  it("types the word behind an ellipsis", () => {
    expect(idleHintText("strong")).toBe("...strong");
  });

  it("puts a pinned host on its arm whatever the query string says", () => {
    pinIdleHintVariant("treatment");
    try {
      expect(forcedIdleHintVariant("")).toBe("treatment");
      expect(forcedIdleHintVariant("?idle-hint=control")).toBe("treatment");
    } finally {
      pinIdleHintVariant(null);
    }
    expect(forcedIdleHintVariant("")).toBeNull();
  });

  it("reads a forced arm off the query string", () => {
    expect(forcedIdleHintVariant("?idle-hint=treatment")).toBe("treatment");
    expect(forcedIdleHintVariant("?idle-hint=control")).toBe("control");
    expect(forcedIdleHintVariant("?idle-hint=yes")).toBeNull();
    expect(forcedIdleHintVariant("")).toBeNull();
  });

  it("forces NorthernBear87 into treatment unless the query string says otherwise", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    expect(forcedIdleHintVariant("")).toBe("treatment");
    expect(forcedIdleHintVariant("?idle-hint=control")).toBe("control");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedIdleHintVariant("")).toBeNull();
  });
});
