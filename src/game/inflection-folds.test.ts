import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import foldExemptions from "../data/fold-exemptions.json";
import scoreOverrides from "../data/score-overrides.json";
import { baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";
import {
  degreeBaseCandidates,
  degreeCounterpart,
  inflectionBaseCandidates,
} from "./stem";

// The 2026-08-21 cutover: a conjugation can no longer outscore the word it is a
// conjugation of. BEFORE is the last puzzle on the previous system, so every case
// here shows both sides of the gate and proves no archived puzzle moved.
const BEFORE = "2026-08-20";
const ON = "2026-08-21";
const AFTER = "2027-03-01";

const WORDS = dictionaryWords as string[];

/** The displayed rarity score for a word under `date`'s system. */
function scoreOf(word: string, date?: string): number {
  const info = rarityFor(word, date);
  if (!info) throw new Error(`${word} is not in the dictionary`);
  return rarityScore(info.zipf, date);
}

describe("the conjugation-outscores-its-base bug", () => {
  it("stops a third-person form beating its own verb", () => {
    // The reported case. `baseForm`'s "-es" branch turned "asphyxiates" into
    // "asphyxiat", which is not a word, so the fold gave up and the conjugation
    // scored Mythic while the verb itself sat 1.02 lower.
    expect(scoreOf("asphyxiates", BEFORE)).toBe(9.77);
    expect(rarityFor("asphyxiates", BEFORE)!.rarity).toBe("Mythic");
    expect(scoreOf("asphyxiate", BEFORE)).toBe(8.75);

    expect(scoreOf("asphyxiates", ON)).toBe(8.75);
    expect(scoreOf("asphyxiates", ON)).toBe(scoreOf("asphyxiate", ON));
    expect(baseFormSubstitution("asphyxiates", ON)!.base).toBe("asphyxiate");
  });

  it("stops a past tense beating its own noun", () => {
    // "-ied" and "-ed" were an if/else, so a word ending in "-ied" only ever got
    // the "-ied" candidate: "safaried" -> "safariy" (not a word), fold abandoned,
    // and the past tense of a Zipf-3.63 word crowned as a perfect 10 Legend.
    expect(scoreOf("safaried", BEFORE)).toBe(10);
    expect(rarityFor("safaried", BEFORE)!.rarity).toBe("Legend");

    expect(scoreOf("safaried", ON)).toBe(scoreOf("safari", ON));
    expect(rarityFor("safaried", ON)!.rarity).toBe("Uncommon");
    expect(baseFormSubstitution("safaried", ON)!.base).toBe("safari");
  });

  it("stops a plural beating its own singular", () => {
    for (const [plural, singular] of [
      ["despites", "despite"],
      ["patiences", "patience"],
      ["nonsenses", "nonsense"],
      ["bikinied", "bikini"],
    ]) {
      expect(rarityFor(plural, BEFORE)!.rarity).toMatch(/Legend|Mythic/);
      expect(scoreOf(plural, ON)).toBe(scoreOf(singular, ON));
    }
  });

  it("scores a Latin plural as its own singular", () => {
    // Plurals no English suffix rule reaches. "abaci" was Mythic off a Zipf-2.65
    // "abacus"; the demote-mythic audit had flagged exactly this shape.
    expect(rarityFor("abaci", BEFORE)!.rarity).toBe("Mythic");
    expect(scoreOf("abaci", ON)).toBe(scoreOf("abacus", ON));
    expect(scoreOf("momenta", ON)).toBe(scoreOf("momentum", ON));
    expect(scoreOf("antitheses", ON)).toBe(scoreOf("antithesis", ON));
    // A cap, not an inheritance: "larvae" is the more common of the pair, so it
    // keeps its own measured score rather than being dragged up to "larva"'s.
    expect(scoreOf("larvae", ON)).toBe(scoreOf("larvae", BEFORE));
    expect(scoreOf("larvae", ON)).toBeLessThan(scoreOf("larva", ON));
  });

  it("scores a comparative and superlative as their adjective", () => {
    expect(rarityFor("godlier", BEFORE)!.rarity).toBe("Legend");
    expect(scoreOf("godlier", ON)).toBe(scoreOf("godly", ON));
    expect(scoreOf("sliest", ON)).toBe(scoreOf("sly", ON));
    // Nonstandard is still a degree form: "specialest" is not a discovery.
    expect(scoreOf("specialest", BEFORE)).toBe(10);
    expect(scoreOf("specialest", ON)).toBe(scoreOf("special", ON));
  });
});

describe("the whole-dictionary safety properties", () => {
  it("never scores any word rarer than the previous system did", () => {
    // The reason this cutover is safe to ship at all. Every fold is a cap against
    // the most common word the search can reach, and a wider candidate set can
    // only reach more words -- so widening it can lower a score and never raise
    // one. Nothing here can turn an ordinary word into a top-tier answer.
    const raised: string[] = [];
    for (const word of WORDS) {
      const before = scoreOf(word, BEFORE);
      const on = scoreOf(word, ON);
      if (on > before + 1e-9) raised.push(`${word} (${before} -> ${on})`);
    }
    expect(raised).toEqual([]);
  });

  it("never lets a word outscore a base it folds onto", () => {
    // The fairness property itself, stated over the whole dictionary rather than
    // the handful of examples above: if the engine says a word folds onto a base,
    // the word cannot score rarer than that base.
    const violations: string[] = [];
    for (const word of WORDS) {
      const substitution = baseFormSubstitution(word, ON);
      if (!substitution) continue;
      const wordScore = scoreOf(word, ON);
      const baseScore = scoreOf(substitution.base, ON);
      if (wordScore > baseScore + 1e-9) {
        violations.push(`${word} ${wordScore} > ${substitution.base} ${baseScore}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("thins the top ranks without emptying them", () => {
    // The blast radius, pinned. Trimming the mechanical suffix forms takes about
    // a sixth of the Legend tier; if a rule change ever guts it instead, this is
    // what says so.
    const legendsBefore = WORDS.filter((w) => scoreOf(w, BEFORE) >= 9.9).length;
    const legendsOn = WORDS.filter((w) => scoreOf(w, ON) >= 9.9).length;
    expect(legendsBefore).toBe(36040);
    expect(legendsOn).toBe(30215);
    expect(legendsOn / legendsBefore).toBeGreaterThan(0.8);
  });
});

describe("date gating", () => {
  it("leaves every puzzle before 2026-08-21 exactly as it played", () => {
    for (const word of ["asphyxiates", "safaried", "despites", "abaci", "specialest"]) {
      expect(scoreOf(word, BEFORE)).toBe(scoreOf(word, "2026-08-19"));
    }
    // The previous cutovers still select their own systems.
    expect(scoreOf("autecism", "2026-08-14")).toBe(9.4); // legacy
    expect(scoreOf("autecism", "2026-08-15")).toBe(10); // first two-band
  });

  it("applies from 2026-08-21 on, and to undated callers", () => {
    for (const date of [ON, AFTER, undefined]) {
      expect(scoreOf("asphyxiates", date)).toBe(scoreOf("asphyxiate", date));
    }
  });
});

describe("the guards that keep real words out of it", () => {
  it("leaves a word with a measured frequency alone under the bare -er/-est rule", () => {
    // "privateer" is not "more private" and "digest" is not the superlative of
    // "dig", but no spelling rule can tell them from "evenest". The rule is
    // confined to words below the corpus measurement floor, so every one of these
    // keeps its own score.
    for (const word of [
      "privateer",
      "digest",
      "shoulder",
      "speaker",
      "modest",
      "earnest",
      "tempest",
      "poster",
      "liver",
      "divest",
      "higher",
      "latest",
      "biggest",
      "maker",
      "greater",
      "closer",
    ]) {
      expect(scoreOf(word, ON)).toBe(scoreOf(word, BEFORE));
      expect(baseFormSubstitution(word, ON)).toBeUndefined();
    }
  });

  it("keeps the degree rules off agent nouns", () => {
    // "supply" has no "suppliest", so "supplier" is not a comparative.
    for (const word of ["supplier", "identifier", "terrier", "carrier", "qualifier"]) {
      expect(scoreOf(word, ON)).toBe(scoreOf(word, BEFORE));
    }
    // ...while a genuinely gradable base still folds.
    expect(scoreOf("happier", ON)).toBe(scoreOf("happy", ON));
    expect(scoreOf("easiest", ON)).toBe(scoreOf("easy", ON));
  });

  it("will not let a doubled degree pair vouch for a single-consonant word", () => {
    // "funest" is Latinate (funeste, "fatal"), not the superlative of "fun". It
    // folded because "funnest" is a headword -- but English requires the doubling,
    // so the spelling that has to be attested is "funer", and nothing has it.
    expect(scoreOf("funest", ON)).toBe(scoreOf("funest", BEFORE));
    expect(baseFormSubstitution("funest", ON)).toBeUndefined();
    // The cost of the strict pairing: "funnest" has no "funner" either, so it
    // keeps its own score too. That errs toward not demoting, which is the safe
    // direction.
    expect(scoreOf("funnest", ON)).toBe(scoreOf("funnest", BEFORE));
  });

  it("applies the degree rules to a folded word, not just the submitted one", () => {
    // Confining them to the submitted word breaks the fairness property: with no
    // degree hop from an intermediate, a plural caps against its singular's raw
    // frequency while the singular displays its own fold, and the plural ends up
    // the rarer of the two.
    expect(scoreOf("bustiers", ON)).toBe(scoreOf("bustier", ON));
    expect(scoreOf("fanciers", ON)).toBe(scoreOf("fancier", ON));
  });

  it("widens which spellings are tried, never which words are short enough", () => {
    // The length guards match `baseForm`'s exactly. Loosening them instead
    // collapses "shed" onto "she" and "ared" onto "are".
    for (const word of ["shed", "ared", "oned", "aging", "tying"]) {
      expect(scoreOf(word, ON)).toBe(scoreOf(word, BEFORE));
    }
  });
});

describe("the reviewed data files", () => {
  it("independently reaches the base of every inflectional score override", () => {
    // 34 of the 44 overrides were added a word at a time for this exact gap --
    // "-es" plurals, "-est" superlatives, "-er" comparatives. Asking
    // `baseFormSubstitution` would prove nothing, since an override is itself a
    // fold candidate; the candidate *generators* never read the override file, so
    // finding the reviewed base in their output is real agreement. The rest of the
    // entries are derivational (`-ation`, `-al`) or misspellings, which no rule
    // here claims to cover -- they keep their override.
    const reached = Object.entries(scoreOverrides as Record<string, { base: string }>).filter(
      ([word, override]) =>
        inflectionBaseCandidates(word).includes(override.base) ||
        degreeBaseCandidates(word, true).includes(override.base)
    );
    expect(reached.length).toBe(29);
  });

  it("keeps every score override in force regardless", () => {
    // The rule is additive, not a replacement: an override still caps its word,
    // including the derivational entries the rule deliberately doesn't cover.
    const violations: string[] = [];
    for (const [word, override] of Object.entries(
      scoreOverrides as Record<string, { base: string }>
    )) {
      if (scoreOf(word, ON) > scoreOf(override.base, ON) + 1e-9) {
        violations.push(`${word}: rarer than ${override.base}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("honours a fold exemption for a word the degree rule got wrong", () => {
    // "damner" is an agent noun. It satisfies the paired-degree guard only because
    // "damnest" exists on its own account (the intensive of "damned"), which no
    // spelling rule can distinguish from a superlative. The exemption puts it back
    // exactly where it was, and covers "damners" through it.
    expect(scoreOf("damner", ON)).toBe(scoreOf("damner", BEFORE));
    expect(baseFormSubstitution("damner", ON)).toBeUndefined();
    expect(baseFormSubstitution("damners", ON)!.base).toBe("damner");
  });

  it("honours a fold exemption, and only from its own date", () => {
    // "staties" (plural of the slang "statie") reached "status" through "stati",
    // a word that is only ever a foreign plural. Exempting the intermediate
    // breaks the chain without touching any real plural.
    expect(baseFormSubstitution("staties", ON)!.base).toBe("stati");
    expect(scoreOf("staties", ON)).toBeGreaterThan(scoreOf("status", ON));
    // Every exempt word is a real dictionary word with a dated entry.
    for (const [word, exemption] of Object.entries(
      foldExemptions as Record<string, { since: string }>
    )) {
      expect(WORDS).toContain(word);
      expect(exemption.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the candidate generators", () => {
  it("offers every plausible inflectional spelling, not just the first", () => {
    expect(inflectionBaseCandidates("asphyxiates")).toContain("asphyxiate");
    expect(inflectionBaseCandidates("boxes")).toContain("box");
    expect(inflectionBaseCandidates("safaried")).toContain("safari");
    expect(inflectionBaseCandidates("denied")).toContain("deny");
    expect(inflectionBaseCandidates("analyses")).toContain("analysis");
    expect(inflectionBaseCandidates("knives")).toContain("knife");
    expect(inflectionBaseCandidates("abaci")).toContain("abacus");
    expect(inflectionBaseCandidates("running")).toContain("run");
  });

  it("keeps the same length guards as baseForm", () => {
    expect(inflectionBaseCandidates("shed")).not.toContain("she");
    expect(inflectionBaseCandidates("aging")).not.toContain("age");
  });

  it("offers bare -er/-est candidates only when asked", () => {
    expect(degreeBaseCandidates("evenest", false)).toEqual([]);
    expect(degreeBaseCandidates("evenest", true)).toContain("even");
    // The y-comparatives need no permission.
    expect(degreeBaseCandidates("godlier", false)).toContain("godly");
    expect(degreeBaseCandidates("happiest", false)).toContain("happy");
  });

  it("pairs a degree with its counterpart in the same spelling variant", () => {
    expect(degreeCounterpart("happier", "happy")).toBe("happiest");
    expect(degreeCounterpart("happiest", "happy")).toBe("happier");
    expect(degreeCounterpart("larger", "large")).toBe("largest");
    expect(degreeCounterpart("biggest", "big")).toBe("bigger");
    // The doubled pair must not vouch for a single-consonant spelling: "funest"
    // asks for "funer", which no dictionary has, not for "funner".
    expect(degreeCounterpart("funest", "fun")).toBe("funer");
    expect(degreeCounterpart("funnest", "fun")).toBe("funner");
    // A word that is no degree form of the base at all.
    expect(degreeCounterpart("privateer", "private")).toBeUndefined();
  });
});
