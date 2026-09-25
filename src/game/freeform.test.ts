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
  waivedRejection,
} from "./dictionary";
import { evaluateSubmission } from "./submit";
import { MODE_CHOICE_START, resetModeCache, setMode } from "./mode";
import WORDS from "../data/dictionary.json";
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
    // The day the first week would have ended, and the day after it. The trial
    // was extended by a week on the 20th, and extending it means one unbroken
    // range -- a puzzle in here must not fall back to the folding system.
    expect(isFreeformWeek("2026-09-21")).toBe(true);
    expect(isFreeformWeek("2026-09-22")).toBe(true);
    // The last day of the trial, and the reason FREEFORM_END is the 27th: the
    // constant is exclusive, so "through the 26th" is a 27th. From the 27th on
    // the calendar stops deciding and the player's own switch does -- which,
    // unset in this test, is Standard.
    expect(isFreeformWeek("2026-09-26")).toBe(true);
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

  it("takes the drop itself as an answer", () => {
    // Refusing the drop is a rule about what makes an interesting answer, not
    // about what is a word -- so it goes with the fold rather than with the
    // gates that stay. "acc" is playable now that abbreviations are too.
    expect(evaluateSubmission("acc", "ACC", [], BEFORE)).toEqual({
      ok: false,
      reason: "same-as-drop",
    });
    expect(evaluateSubmission("acc", "ACC", [], DURING).ok).toBe(true);
    // And from the week's end in Standard too: DROP_PLAYABLE_START is the same date.
    expect(evaluateSubmission("acc", "ACC", [], AFTER).ok).toBe(true);
  });

  it("still refuses a word that does not contain the drop", () => {
    // The gate the week does not touch: the drop is the puzzle.
    expect(evaluateSubmission("stone", "LAY", [], DURING)).toEqual({
      ok: false,
      reason: "missing-drop",
    });
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

  it("names an age-related waiver, so an acceptance can explain itself", () => {
    const obsolete = wordRejectedFor("obsolete");
    expect(obsolete).toBeDefined();
    expect(waivedRejection(obsolete!, DURING)).toBe("obsolete");
    // Outside the week nothing is waived, because nothing is being let through.
    expect(waivedRejection(obsolete!, BEFORE)).toBeUndefined();
  });

  it("says nothing about the waivers a player would not care about", () => {
    // Being an acronym or a name is a category a word was filed under, not a
    // fact about it worth a line in the acceptance. The word still plays.
    for (const reason of ["abbreviation", "proper-noun", "name-or-abbreviation"]) {
      const word = wordRejectedFor(reason);
      if (!word) continue;
      expect(isValidWord(word, DURING), `${reason} plays`).toBe(true);
      expect(waivedRejection(word, DURING), `${reason} is silent`).toBeUndefined();
    }
  });

  it("sends an uncurated word refused for its register to the live lookup", () => {
    // src/data/rejection-metadata.json classifies ~107,000 words that never made
    // the dictionary. Naming their register refuses them outright, because the
    // live check runs only for a bare "not-a-word" -- so during the week the
    // category is dropped and the word gets to prove itself like any other
    // unknown one. "aasvogel" is listed obsolete and is not in the dictionary.
    const before = evaluateSubmission("aasvogel", "VOG", [], BEFORE);
    expect(before).toEqual({ ok: false, reason: "obsolete" });

    const during = evaluateSubmission("aasvogel", "VOG", [], DURING);
    expect(during).toEqual({ ok: false, reason: "not-a-word" });

    // And back to a named refusal once the trial is over.
    expect(evaluateSubmission("aasvogel", "VOG", [], AFTER)).toEqual({
      ok: false,
      reason: "obsolete",
    });
  });

  describe("in Freeform mode, which is not the trial week", () => {
    // The mode waives what the week did: the age trio stays playable, because
    // Freeform is unranked and "playing however you want" still means reaching
    // for "thou". Standard is where those words go back to being refused.
    const IN_MODE = MODE_CHOICE_START;

    beforeEach(() => {
      localStorage.clear();
      resetModeCache();
      setMode("freeform");
    });

    it("lets an obsolete, archaic or dated word play, as the trial did", () => {
      for (const reason of ["obsolete", "archaic", "dated"]) {
        const word = wordRejectedFor(reason);
        if (!word) continue;
        expect(curatedRejection(word, IN_MODE), `${reason} in mode`).toBeUndefined();
        expect(isValidWord(word, IN_MODE), `${reason} plays`).toBe(true);
        // And the acceptance says which rule it is standing on.
        expect(waivedRejection(word, IN_MODE), `${reason} noted`).toBe(reason);
      }
    });

    it("still lets a name or an abbreviation play", () => {
      // These refuse words that are alive and ordinary and merely filed under a
      // category -- the same objection the fold makes, that your word is really
      // some other word.
      for (const reason of ["proper-noun", "abbreviation", "name-or-abbreviation"]) {
        const word = wordRejectedFor(reason);
        if (!word) continue;
        expect(curatedRejection(word, IN_MODE), `${reason} in mode`).toBeUndefined();
        expect(isValidWord(word, IN_MODE), `${reason} plays`).toBe(true);
      }
    });

    it("sends an uncurated word's register to the live lookup, as the trial did", () => {
      // "not-a-word" is the one reason that earns a lookup; naming the register
      // here would refuse a word the mode lets through.
      expect(evaluateSubmission("aasvogel", "VOG", [], IN_MODE)).toEqual({
        ok: false,
        reason: "not-a-word",
      });
      setMode("standard");
      expect(evaluateSubmission("aasvogel", "VOG", [], IN_MODE)).toEqual({
        ok: false,
        reason: "obsolete",
      });
    });

    it("leaves the trial week's own puzzles exactly as they played", () => {
      // The switch is set to Freeform above, and it still has no say here: a
      // word accepted on the 18th is accepted if somebody opens that day from
      // the archive.
      const word = wordRejectedFor("archaic") ?? wordRejectedFor("obsolete");
      expect(word).toBeDefined();
      expect(curatedRejection(word!, DURING)).toBeUndefined();
    });

    it("still skips the fold, which is what the mode is for", () => {
      // The register rules coming back is not the scoring coming back:
      // "kindless" is priced as itself here and folded onto "kind" in Standard.
      const own = rarityFor("kindless", IN_MODE)?.zipf;
      const base = rarityFor("kind", IN_MODE)?.zipf;
      expect(own).toBeDefined();
      expect(own).not.toBe(base);

      setMode("standard");
      expect(rarityFor("kindless", IN_MODE)?.zipf).toBe(base);
    });
  });

  it("keeps an uncurated misspelling final, with nothing to look up", () => {
    const during = evaluateSubmission("freind", "REI", [], DURING);
    expect(during).toEqual({ ok: false, reason: "misspelling" });
  });

  it("leaves a word that is not in the dictionary to the live lookup", () => {
    // The week widens which words are playable, not what counts as one.
    expect(isValidWord("zzzzqqq", DURING)).toBe(false);
  });

  it("waived nothing before the trial, and waives nothing undated", () => {
    const word = wordRejectedFor("proper-noun");
    expect(word).toBeDefined();
    expect(isValidWord(word!, BEFORE)).toBe(false);
    // The undated call is the leaderboard and the finds feed pricing somebody
    // else's word, which is not a submission being judged.
    expect(isValidWord(word!)).toBe(false);
  });

  it("keeps names and abbreviations playable after the trial, in both modes", () => {
    // The one thing the trial settled for good: these refuse words that are
    // alive and ordinary and merely filed under a category. From
    // MODE_CHOICE_START they play whichever mode you are in -- the modes differ
    // in what a word is worth, not in which words there are.
    for (const reason of ["proper-noun", "abbreviation", "name-or-abbreviation"]) {
      const word = wordRejectedFor(reason);
      if (!word) continue;
      localStorage.clear();
      resetModeCache();
      setMode("standard");
      expect(isValidWord(word, AFTER), `${reason} in Standard`).toBe(true);
      setMode("freeform");
      expect(isValidWord(word, AFTER), `${reason} in Freeform`).toBe(true);
    }
  });

  it("puts the age trio back in force after the trial, for Standard only", () => {
    for (const reason of ["obsolete", "archaic", "dated"]) {
      const word = wordRejectedFor(reason);
      if (!word) continue;
      localStorage.clear();
      resetModeCache();
      setMode("standard");
      expect(isValidWord(word, AFTER), `${reason} in Standard`).toBe(false);
      setMode("freeform");
      expect(isValidWord(word, AFTER), `${reason} in Freeform`).toBe(true);
    }
  });
});
