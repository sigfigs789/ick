/**
 * Which rule made a fold, and the ruleset /folded-live shows beside it.
 *
 * `foldTrace` reports the *shape* of each link -- a rung above the word, or one
 * of the two reverse folds -- and deliberately not the affix, because naming the
 * affix means asking every generator in stem.ts which of them could have made
 * this pair. That is this file. The answer is not always one rule:
 * `nextBaseForms` offers a candidate if *any* generator produced it, so a pair
 * can have several readings.
 *
 * The order below is safest-first, and that is the honest reading rather than a
 * convenience: if a hop is explicable as a plain plural strip, then a plain
 * plural strip is what a player sees, whatever else also happens to match.
 *
 * Shared by the fold audit (scripts/fold-audit) and /folded-live.
 */
import {
  boundBaseCandidates,
  decisiveNumberCandidates,
  degreeBaseCandidates,
  derivedBaseCandidates,
  inflectionalBaseCandidates,
  measurementBaseCandidates,
  prefixBaseCandidates,
  privativeBaseCandidates,
  restoredTenseCandidates,
  stemChangingNumberCandidates,
  superlativeBaseCandidates,
  ungatedPrefixBaseCandidates,
  unmeasuredBaseCandidates,
  type PrefixEra,
} from "./stem";
import { foldAffixGroups, type FoldAffixGroup, type FoldHop } from "./dictionary";
import type { GameMode } from "./mode";

/** Every date the audit runs on is past both retirements; see PRE_PREFIX_END. */
export const AUDIT_ERA: PrefixEra = { pre: false, borrowed: false, de: true };

/**
 * Every prefix that has ever folded. For naming a fold that already happened,
 * where the question is which rule it was, not whether the rule was on.
 */
const ANY_ERA: PrefixEra = { pre: true, borrowed: true, de: true };

function probes(era: PrefixEra): [string, (word: string) => string[]][] {
  return [
    ["number", decisiveNumberCandidates],
    ["tense", restoredTenseCandidates],
    ["number-stem-change", stemChangingNumberCandidates],
    ["inflection-other", (w) => inflectionalBaseCandidates(w, true)],
    ["transparent-suffix", transparentCandidates],
    ["bound-suffix", boundBaseCandidates],
    ["degree", (w) => degreeBaseCandidates(w).map((c) => c.base)],
    ["superlative", (w) => superlativeBaseCandidates(w).map((c) => c.base)],
    ["derived-suffix", derivedBaseCandidates],
    ["measurement", measurementBaseCandidates],
    ["privative-less", privativeBaseCandidates],
    ["unmeasured-suffix", unmeasuredBaseCandidates],
    ["prefix-ungated", ungatedPrefixBaseCandidates],
    ["prefix", (w) => prefixBaseCandidates(w, era)],
  ];
}

/**
 * "-ness" and "-ly", which `scoringBaseForm` handles inside dictionary.ts rather
 * than in stem.ts, so there is no generator to ask. Both readings of the stem,
 * since the engine picks between them on frequency.
 */
function transparentCandidates(word: string): string[] {
  for (const suffix of ["ness", "ly"]) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    return [stem, stem.endsWith("i") ? `${stem.slice(0, -1)}y` : `${stem}e`];
  }
  return [];
}

/** Every rule that could have produced `from` -> `to`, safest first. */
export function rulesFor(from: string, to: string, era: PrefixEra = AUDIT_ERA): string[] {
  const out: string[] = [];
  for (const [name, probe] of probes(era)) {
    let matched = false;
    try {
      matched = probe(from).includes(to);
    } catch {
      matched = false;
    }
    if (matched) out.push(name);
  }
  return out;
}

/**
 * How much a rule is trusted to preserve meaning, least trusted first.
 *
 * A chain is only as safe as its loosest link, so a report that labelled a fold
 * by its *last* hop would file "unliking" -> "liking" -> "like" under "tense" and
 * hide the prefix strip that is the only debatable thing about it. This order is
 * the claim the audit is testing, not a finding: the inflectional rules at the
 * bottom are meaning-preserving by construction, and everything above them is a
 * guess of some kind.
 */
const RISK: string[] = [
  "override-or-unmatched",
  "prefix",
  "prefix-ungated",
  "privative-less",
  "unmeasured-suffix",
  "derived-suffix",
  "measurement",
  "superlative",
  "bound-suffix",
  "transparent-suffix",
  "reverse-derived",
  "degree",
  "number-stem-change",
  "reverse-inflection",
  "tense",
  "number",
  "inflection-other",
  "none",
];

/** The loosest link of a chain -- the rule the fold should be judged on. */
export function riskiestRule(path: FoldHop[], era: PrefixEra = AUDIT_ERA): string {
  if (path.length === 0) return "none";
  let worst = path[0];
  let worstRank = RISK.indexOf(describeHop(worst, era));
  for (const hop of path.slice(1)) {
    const rank = RISK.indexOf(describeHop(hop, era));
    if (rank >= 0 && (worstRank < 0 || rank < worstRank)) {
      worst = hop;
      worstRank = rank;
    }
  }
  return describeHop(worst, era);
}

/** The one label a report column gets for a hop. */
export function describeHop(hop: FoldHop, era: PrefixEra = AUDIT_ERA): string {
  if (hop.rule === "derived-form") return "reverse-derived";
  if (hop.rule === "inflected-form") return "reverse-inflection";
  const matches = rulesFor(hop.from, hop.to, era);
  if (matches.length === 0) return "override-or-unmatched";
  return matches[0];
}

/** One rule of the fold, as /folded-live lists it. */
export interface FoldRule extends Omit<FoldAffixGroup, "example"> {
  /** Stable, for the anchor a row's "Rule:" link jumps to. */
  id: string;
  example?: FoldAffixGroup["example"];
  /** What the rule does, for the two that name no affix to show instead. */
  note?: string;
}

/**
 * The audit's labels, by the `foldAffixGroups` title that explains each to a
 * player. Keyed on the title because that list is the one players are shown,
 * and the page should name the same rule they read about.
 */
const GROUP_FOR_LABEL: Record<string, string> = {
  number: "Plurals, tenses and participles",
  tense: "Plurals, tenses and participles",
  "inflection-other": "Plurals, tenses and participles",
  "number-stem-change": "Plurals from Latin, Greek and French",
  "transparent-suffix": "Adverbs and quality nouns",
  "derived-suffix": "Endings only ever built by adding them",
  "bound-suffix": "Nouns built from a verb or an adjective",
  degree: "Comparatives and superlatives",
  superlative: "Comparatives and superlatives",
  "privative-less": "Without the thing",
  "unmeasured-suffix": "Verbs and adjectives made from a noun",
  prefix: "Prefixes",
  "prefix-ungated": "Prefixes",
  measurement: "How many of the unit",
};

/** Two rules the player's sheet has no row for, because they name no affix. */
const RELATED_FORM: FoldRule = {
  id: "related-form",
  title: "Capped at a related form",
  affixes: [],
  note: "A word never scores rarer than a more common member of its own family: an inflection or adjective built on it.",
};
const OTHER: FoldRule = {
  id: "other",
  title: "Set by hand, or a spelling change",
  affixes: [],
  note: "A base named in the reviewed /fold queue, or a fold none of the rules above names on its own.",
};

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The fold's rules on `date`'s Standard puzzle: the affix families players are
 * shown on the Common forms sheet, plus the two that name no affix.
 */
export function foldRuleset(date?: string, mode: GameMode = "standard"): FoldRule[] {
  const groups = foldAffixGroups(date, mode);
  if (groups.length === 0) return [];
  return [...groups.map((group) => ({ ...group, id: slug(group.title) })), RELATED_FORM, OTHER];
}

/**
 * The id of the rule in `foldRuleset` a fold should be judged on: its loosest
 * link. Any prefix that has ever folded counts, since the fold already happened.
 */
export function foldRuleId(path: FoldHop[]): string {
  const label = riskiestRule(path, ANY_ERA);
  if (label === "reverse-derived" || label === "reverse-inflection") return RELATED_FORM.id;
  const title = GROUP_FOR_LABEL[label];
  return title ? slug(title) : OTHER.id;
}
