import { beforeEach, describe, expect, it } from "vitest";
import { crossModeAvailable, loadProgressInMode, previewInMode } from "./crossMode";
import { formatRarityScore } from "./dictionary";
import { asMode, currentMode, resetModeCache, setMode } from "./mode";
import { recordAcceptedWord } from "./storage";
import { evaluateSubmission } from "./submit";
import type { AcceptedWord } from "./types";

/** A puzzle in the chosen era, where each mode keeps its own game. */
const DATE = "2026-10-01";

function bankedIn(mode: "standard" | "freeform", word: string, drop: string): AcceptedWord {
  return asMode(mode, () => {
    const result = evaluateSubmission(word, drop, [], DATE);
    expect(result.ok, `${word} should be playable in ${mode}`).toBe(true);
    return result.word!;
  });
}

describe("cross-mode copy", () => {
  beforeEach(() => {
    localStorage.clear();
    resetModeCache();
  });

  it("is only offered once each mode has its own game", () => {
    expect(crossModeAvailable("2026-09-20")).toBe(false);
    expect(crossModeAvailable(DATE)).toBe(true);
  });

  it("prices a word under the other mode's rules without moving the switch", () => {
    setMode("standard");
    const word = bankedIn("standard", "kindless", "KIN");
    const target = loadProgressInMode(DATE, "KIN", "freeform");
    const preview = previewInMode(word, "freeform", DATE, "KIN", target);

    expect(preview.state).toBe("ready");
    if (preview.state !== "ready") return;
    // Standard folds "kindless" onto "kind"; Freeform scores it as itself.
    expect(preview.word.zipf).not.toBe(word.zipf);
    expect(preview.score).toBe(asMode("freeform", () => formatRarityScore(preview.word.zipf, DATE)));
    expect(preview.needsLiveCheck).toBe(false);
    expect(currentMode()).toBe("standard");
  });

  it("says when Standard would refuse a relative of a word it already holds", () => {
    setMode("freeform");
    const standard = recordAcceptedWord(
      loadProgressInMode(DATE, "LAY", "standard"),
      bankedIn("standard", "play", "LAY")
    );
    const preview = previewInMode(
      bankedIn("freeform", "plays", "LAY"),
      "standard",
      DATE,
      "LAY",
      standard
    );
    expect(preview).toEqual({ state: "refused", reason: "same-root-as-used" });
  });

  it("reads a word the other game already holds as copied", () => {
    setMode("standard");
    const word = bankedIn("standard", "kindless", "KIN");
    const saved = asMode("freeform", () =>
      recordAcceptedWord(loadProgressInMode(DATE, "KIN", "freeform"), bankedIn("freeform", "kindless", "KIN"))
    );
    expect(saved.mode).toBe("freeform");

    // Read back from storage, so the copy landed under Freeform's key and not
    // over the Standard game the player is in.
    const reloaded = loadProgressInMode(DATE, "KIN", "freeform");
    expect(previewInMode(word, "freeform", DATE, "KIN", reloaded).state).toBe("copied");
    expect(loadProgressInMode(DATE, "KIN", "standard").acceptedWords).toEqual([]);
  });

  it("reprices a word no offline list knows, and wants a lookup only into Standard", () => {
    setMode("freeform");
    const invented: AcceptedWord = { word: "zzkinzz", zipf: 1.2, rarity: "Mythic" };
    const intoStandard = previewInMode(
      invented,
      "standard",
      DATE,
      "KIN",
      loadProgressInMode(DATE, "KIN", "standard")
    );
    expect(intoStandard.state).toBe("ready");
    if (intoStandard.state === "ready") expect(intoStandard.needsLiveCheck).toBe(true);

    setMode("standard");
    const intoFreeform = previewInMode(
      invented,
      "freeform",
      DATE,
      "KIN",
      loadProgressInMode(DATE, "KIN", "freeform")
    );
    expect(intoFreeform.state).toBe("ready");
    if (intoFreeform.state === "ready") expect(intoFreeform.needsLiveCheck).toBe(false);
  });

  it("restores the session's mode even when the borrowed call throws", () => {
    setMode("standard");
    expect(() =>
      asMode("freeform", () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(currentMode()).toBe("standard");
  });
});
