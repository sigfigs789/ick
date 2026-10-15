import { describe, expect, it } from "vitest";
import type { FoldHop } from "./dictionary";
import { foldRuleId, foldRuleset } from "./foldRules";

const hop = (from: string, to: string, rule: FoldHop["rule"] = "base"): FoldHop => ({
  from,
  to,
  rule,
  zipf: 4,
});

describe("foldRuleId", () => {
  it("names a fold by its loosest link", () => {
    // "unliking" -> "liking" -> "like" is a prefix question, not a tense one.
    expect(foldRuleId([hop("unliking", "liking"), hop("liking", "like")])).toBe("prefixes");
  });

  it("names the plain families", () => {
    expect(foldRuleId([hop("hearses", "hearse")])).toBe("plurals-tenses-and-participles");
    expect(foldRuleId([hop("sparsely", "sparse")])).toBe("adverbs-and-quality-nouns");
    expect(foldRuleId([hop("uncompile", "compile")])).toBe("prefixes");
  });

  it("files a reverse fold and an unmatched hop under the rules with no affix", () => {
    expect(foldRuleId([hop("infatuate", "infatuated", "inflected-form")])).toBe("related-form");
    expect(foldRuleId([hop("timelessly", "time")])).toBe("other");
  });

  it("names only rules the page lists", () => {
    const ids = new Set(foldRuleset("2026-10-15").map((rule) => rule.id));
    for (const path of [
      [hop("unliking", "liking")],
      [hop("hearses", "hearse")],
      [hop("x", "y")],
      [hop("a", "b", "derived-form")],
    ]) {
      expect(ids.has(foldRuleId(path))).toBe(true);
    }
  });
});

describe("foldRuleset", () => {
  it("is empty when nothing folds", () => {
    expect(foldRuleset("2026-10-15", "freeform")).toEqual([]);
  });
});
