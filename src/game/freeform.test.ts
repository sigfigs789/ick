import { beforeEach, describe, expect, it } from "vitest";
import {
  FREEFORM_END,
  FREEFORM_START,
  baseFormSubstitution,
  curatedRejection,
  isDictionaryWord,
  isFreeformWeek,
  isValidWord,
  rarityFor,
} from "./dictionary";
import { evaluateSubmission } from "./submit";
import WORDS from "../data/dictionary.json";
import { hasEverPlayed } from "./storage";
import type { AcceptedWord } from "./types";

/** A day inside the trial, and the two days that bracket it. */
const BEFORE = "2026-09-13";
const DURING = "2026-09-15";
const AFTER = FREEFORM_END;

describe("isFreeformWeek", () => {
  it("covers the start date and stops before the end date", () => {
    expect(isFreeformWeek(BEFORE)).toBe(false);
    expect(isFreeformWeek(FREEFORM_START)).toBe(true);
    expect(isFreeformWeek("2026-09-20")).toBe(true);
    expect(isFreeformWeek(FREEFORM_END)).toBe(false);
  });

  it("reads an omitted date as not freeform", () => {
    // The undated call is the leaderboard and the finds feed pricing a word by
    // today's dictionary. Those have to answer the same thing all week, or every
    // historical find would reprice on the 14th and reprice back on the 21st.
    expect(isFreeformWeek()).toBe(false);
  });
});

describe("freeform week scoring", () => {
  /**
   * One word per fold family the week switches off, each with the base it folds
   * onto outside the window. The point of the list is breadth: the change is a
   * single master switch, so a family that kept folding would be a real bug and
   * nothing narrower would catch it.
   */
  const FOLDED: readonly [word: string, base: string][] = [
    ["outwill", "will"], // transparent prefix
    ["kindless", "kind"], // privative -less
    ["happier", "happy"], // paired-degree comparative
    ["materialnesses", "material"], // chained -ness
    ["catholically", "catholic"], // bound -ically
    ["kilojoules", "joules"], // measurement modifier
    ["theses", "thesis"], // reviewed override
  ];

  it("scores every folding family on its own frequency", () => {
    for (const [word] of FOLDED) {
      const before = rarityFor(word, BEFORE)!;
      const during = rarityFor(word, DURING)!;
      // A fold has only ever been a cap, so removing it can never lower a score.
      expect(during.zipf).toBeLessThanOrEqual(before.zipf);
      expect(during.zipf).not.toBe(before.zipf);
    }
  });

  it("reports no base-form substitution, so nothing claims a common form", () => {
    for (const [word, base] of FOLDED) {
      expect(baseFormSubstitution(word, BEFORE)?.base).toBe(base);
      expect(baseFormSubstitution(word, DURING)).toBeUndefined();
    }
  });

  it("leaves the puzzles either side of the week exactly as they were", () => {
    // The whole reason the week is a window rather than a cutover: an archived
    // puzzle keeps the scores it was played with, in both directions.
    for (const [word] of FOLDED) {
      expect(rarityFor(word, AFTER)).toEqual(rarityFor(word, BEFORE));
    }
  });

  it("does not move a word that never folded", () => {
    // Derived rather than hand-picked, because "obviously scores on its own
    // frequency" is a much harder claim about a word than it looks: the fold
    // runs in both directions, so an ordinary lemma can be capped at its own
    // plural ("joule" takes 2.48 from "joules"). The words that do not move are
    // exactly the ones with no substitution to report, and that is the property
    // worth asserting.
    const unfolded = ["thesis", "material", "joule", "quixotic", "think"].filter(
      (word) => baseFormSubstitution(word, BEFORE) === undefined,
    );
    expect(unfolded.length).toBeGreaterThan(0);
    for (const word of unfolded) {
      expect(rarityFor(word, DURING)).toEqual(rarityFor(word, BEFORE));
    }
  });
});

describe("freeform week submissions", () => {
  /** An accepted word, as the guess log holds it. */
  function accepted(word: string): AcceptedWord {
    return { word, rarity: "Common", zipf: 4 };
  }

  it("refuses a word's own relatives outside the week", () => {
    const result = evaluateSubmission("plays", "LAY", [accepted("play")], BEFORE);
    expect(result).toEqual({ ok: false, reason: "same-root-as-used" });
  });

  it("takes the whole paradigm during the week", () => {
    // "Play as you want" includes playing a word's other forms: the same-root
    // rule is the fold asked a second way, and the week switches off both.
    const log: AcceptedWord[] = [accepted("play")];
    for (const word of ["plays", "played", "playing", "player"]) {
      const result = evaluateSubmission(word, "LAY", log, DURING);
      expect(result.ok, `${word} should be accepted`).toBe(true);
      expect(result.word, `${word} should come back scored`).toBeDefined();
      log.push(result.word!);
    }
    expect(log).toHaveLength(5);
  });

  it("scores each form as itself rather than as the one before it", () => {
    const log = [accepted("play")];
    const plays = evaluateSubmission("plays", "LAY", log, DURING);
    const played = evaluateSubmission("played", "LAY", log, DURING);
    expect(plays.word).toBeDefined();
    expect(played.word).toBeDefined();
    // Distinct words with distinct measurements -- the point of the week. If
    // either had folded onto "play" they would carry the same Zipf.
    expect(plays.word!.zipf).not.toBe(played.word!.zipf);
  });

  it("still refuses the exact same spelling twice", () => {
    // The one duplicate rule the week does not touch: the same string again is
    // not a second word under any scoring system.
    const result = evaluateSubmission("play", "LAY", [accepted("play")], DURING);
    expect(result).toEqual({ ok: false, reason: "already-used" });
  });

  it("goes back to refusing relatives the day the week ends", () => {
    const result = evaluateSubmission("plays", "LAY", [accepted("play")], AFTER);
    expect(result).toEqual({ ok: false, reason: "same-root-as-used" });
  });
});

describe("freeform week rejections", () => {
  /**
   * A real word per waived reason, found in the reviewed data rather than named
   * here: the point is that the whole category lifts, and a hand-picked example
   * would go stale the next time review moved a word between reasons.
   */
  function wordRejectedFor(reason: string): string | undefined {
    return WORDS.find(
      (word) => curatedRejection(word, BEFORE) === reason && isDictionaryWord(word),
    );
  }

  it("still refuses a misspelling, which is a spelling of another word", () => {
    const word = wordRejectedFor("misspelling");
    expect(word).toBeDefined();
    expect(curatedRejection(word!, DURING)).toBe("misspelling");
    expect(isValidWord(word!, DURING)).toBe(false);
  });

  it("lets a word play that was refused for its register", () => {
    for (const reason of [
      "proper-noun",
      "abbreviation",
      "name-or-abbreviation",
      "obsolete",
      "archaic",
      "dated",
    ]) {
      const word = wordRejectedFor(reason);
      if (!word) continue; // no word carries this reason in the current data
      expect(curatedRejection(word, BEFORE), `${reason} before`).toBe(reason);
      expect(curatedRejection(word, DURING), `${reason} during`).toBeUndefined();
      expect(isValidWord(word, DURING), `${reason} playable`).toBe(true);
    }
  });

  it("accepts one at the submit boundary, and refuses it again after", () => {
    const word = wordRejectedFor("archaic") ?? wordRejectedFor("obsolete");
    expect(word).toBeDefined();
    const drop = word!.slice(1, 3).toUpperCase();
    expect(evaluateSubmission(word!, drop, [], DURING).ok).toBe(true);
    expect(evaluateSubmission(word!, drop, [], AFTER).ok).toBe(false);
  });

  it("leaves a word that is not in the dictionary to the live lookup", () => {
    // The week widens which words are playable, not what counts as one.
    expect(isValidWord("zzzzqqq", DURING)).toBe(false);
  });

  it("does not waive anything outside the window", () => {
    const word = wordRejectedFor("proper-noun");
    expect(word).toBeDefined();
    expect(isValidWord(word!, BEFORE)).toBe(false);
    expect(isValidWord(word!, AFTER)).toBe(false);
    expect(isValidWord(word!)).toBe(false);
  });
});

describe("hasEverPlayed", () => {
  beforeEach(() => localStorage.clear());

  it("is false for a browser that has never stored a puzzle", () => {
    expect(hasEverPlayed()).toBe(false);
  });

  it("is false for a puzzle opened but never scored on", () => {
    localStorage.setItem(
      "ick:progress:2026-09-12",
      JSON.stringify({ date: "2026-09-12", drop: "INK", acceptedWords: [] }),
    );
    expect(hasEverPlayed()).toBe(false);
  });

  it("is true after a single accepted word, undated and unfinished", () => {
    // Deliberately weaker than playedOnItsDay: this only decides whether
    // somebody has seen the game work, so archive play and an abandoned puzzle
    // with no timestamp both count.
    localStorage.setItem(
      "ick:progress:2026-09-12",
      JSON.stringify({
        date: "2026-09-12",
        drop: "INK",
        acceptedWords: [{ word: "think", rarity: "Common", zipf: 4.5 }],
      }),
    );
    expect(hasEverPlayed()).toBe(true);
  });

  it("ignores junk in storage rather than throwing on it", () => {
    localStorage.setItem("ick:progress:2026-09-12", "not json");
    expect(hasEverPlayed()).toBe(false);
  });
});
