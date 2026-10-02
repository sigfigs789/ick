/**
 * Which rule made a fold hop.
 *
 * `foldTrace` reports the *shape* of each link -- a rung above the word, or one
 * of the two reverse folds -- and deliberately not the affix, because naming the
 * affix means asking every generator in stem.ts which of them could have made
 * this pair. That is this file. It lives beside the audit rather than in the
 * engine because the answer is not always one rule: `nextBaseForms` offers a
 * candidate if *any* generator produced it, so a pair can have several readings.
 *
 * The order below is safest-first, and that is the honest reading rather than a
 * convenience: if a hop is explicable as a plain plural strip, then a plain
 * plural strip is what a player sees, whatever else also happens to match.
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
} from "../../src/game/stem";
import type { FoldHop } from "../../src/game/dictionary";

/** Every date this audit runs on is past both retirements; see PRE_PREFIX_END. */
const ERA: PrefixEra = { pre: false, borrowed: false, de: true };

const PROBES: [string, (word: string) => string[]][] = [
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
  ["prefix", (w) => prefixBaseCandidates(w, ERA)],
];

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
export function rulesFor(from: string, to: string): string[] {
  const out: string[] = [];
  for (const [name, probe] of PROBES) {
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
export function riskiestRule(path: FoldHop[]): string {
  if (path.length === 0) return "none";
  let worst = path[0];
  let worstRank = RISK.indexOf(describeHop(worst));
  for (const hop of path.slice(1)) {
    const rank = RISK.indexOf(describeHop(hop));
    if (rank >= 0 && (worstRank < 0 || rank < worstRank)) {
      worst = hop;
      worstRank = rank;
    }
  }
  return describeHop(worst);
}

/** The one label a report column gets for a hop. */
export function describeHop(hop: FoldHop): string {
  if (hop.rule === "derived-form") return "reverse-derived";
  if (hop.rule === "inflected-form") return "reverse-inflection";
  const matches = rulesFor(hop.from, hop.to);
  if (matches.length === 0) return "override-or-unmatched";
  return matches[0];
}
