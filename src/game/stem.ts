/**
 * A deliberately simple, non-linguistic stemmer used only to catch
 * near-duplicate submissions in the same puzzle (e.g. "play", "plays",
 * "played" should not count as three different words). It doesn't need to
 * be linguistically correct -- it only needs to collapse the common
 * inflections of the same root onto the same key.
 */
export function baseForm(word: string): string {
  const w = word.toLowerCase();

  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 6 && w.endsWith("ying")) return w.slice(0, -4) + "y";
  if (w.length > 5 && w.endsWith("ing")) return stripDoubledConsonant(w.slice(0, -3));
  if (w.length > 5 && w.endsWith("ied")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return stripDoubledConsonant(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);

  return w;
}

/**
 * Candidate base spellings for the two *bound* derivational suffixes whose base
 * is unambiguous: an "-ization"/"-isation" word is the noun of an "-ize"/"-ise"
 * verb ("organization" -> "organize"), and an "-ability"/"-ibility" word is the
 * noun of an "-able"/"-ible" adjective ("readability" -> "readable"). Opaque
 * suffixes like -ment and -ism are deliberately excluded -- they collapse onto
 * unrelated real words ("battlement" -> "battle", "arrivism" -> "arrive"), which
 * a purely spelling-based rule can't tell apart from a genuine derivation. The
 * caller confirms a candidate is a real word before trusting it.
 */
export function boundBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (base: string) => {
    if (base.length >= 5 && base !== w && !out.includes(base)) out.push(base);
  };
  if (w.length > 8) {
    if (w.endsWith("ization")) add(w.slice(0, -7) + "ize");
    if (w.endsWith("isation")) add(w.slice(0, -7) + "ise");
    if (w.endsWith("ability")) add(w.slice(0, -7) + "able");
    if (w.endsWith("ibility")) add(w.slice(0, -7) + "ible");
  }
  return out;
}

/** "running" -> stripped to "runn" by the "ing" cut; trim the doubled consonant back to "run". */
function stripDoubledConsonant(stem: string): string {
  const isConsonant = (c: string) => /[bcdfghjklmnpqrstvwxyz]/.test(c);
  if (
    stem.length > 3 &&
    stem[stem.length - 1] === stem[stem.length - 2] &&
    isConsonant(stem[stem.length - 1])
  ) {
    return stem.slice(0, -1);
  }
  return stem;
}

/**
 * Every plausible dictionary spelling of `word`'s *inflectional* base -- the
 * plural/third-person, past, and participle forms of the same lemma. Scoring
 * only; `baseForm` above still owns same-root duplicate detection.
 *
 * Candidates rather than one answer is the whole point. `baseForm` returns a
 * single spelling and so gives up when that spelling isn't a word: its "-es"
 * branch turns "asphyxiates" into "asphyxiat", never tries "asphyxiate", and the
 * word ends up scoring 9.77 (Mythic) against its own base's 8.75. Its "-ied"
 * branch does the same to "safaried" ("safariy", never "safari"), which is how a
 * past tense of a Zipf-3.6 word reaches a perfect 10.00 Legend. Offering every
 * spelling and letting the caller keep the ones that are real words closes both.
 *
 * Latin plurals are included ("abaci" -> "abacus", "larvae" -> "larva",
 * "momenta" -> "momentum"): they are plurals, and no English suffix rule reaches
 * them. Length guards match `baseForm`'s exactly -- this widens which *spellings*
 * are considered, never which words are short enough to fold, so "shed" still
 * doesn't collapse onto "she".
 */
export function inflectionBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (base: string) => {
    if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
  };

  // Plural and third-person singular.
  if (w.length > 4 && w.endsWith("ies")) {
    add(w.slice(0, -3) + "y"); // cities -> city
    add(w.slice(0, -2)); // rabbies -> rabbi
    add(w.slice(0, -1)); // zombies -> zombie
  }
  if (w.length > 4 && w.endsWith("ves")) {
    add(w.slice(0, -3) + "f"); // wolves -> wolf
    add(w.slice(0, -3) + "fe"); // knives -> knife
  }
  if (w.length > 4 && w.endsWith("es")) {
    add(w.slice(0, -2)); // boxes -> box
    add(w.slice(0, -1)); // asphyxiates -> asphyxiate
    add(w.slice(0, -2) + "is"); // analyses -> analysis
  }
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) {
    add(w.slice(0, -1)); // cats -> cat
  }
  // Latin plurals.
  if (w.length > 3 && w.endsWith("i")) add(w.slice(0, -1) + "us"); // abaci -> abacus
  if (w.length > 3 && w.endsWith("ae")) add(w.slice(0, -1)); // larvae -> larva
  if (w.length > 3 && w.endsWith("a")) add(w.slice(0, -1) + "um"); // momenta -> momentum

  // Past tense and participles. The "-ied" and "-ed" branches both contribute,
  // which is what `baseForm`'s if/else chain can't do: "safaried" needs the
  // plain "-ed" candidates even though it ends in "-ied".
  if (w.length > 4 && w.endsWith("ied")) add(w.slice(0, -3) + "y"); // denied -> deny
  if (w.length > 4 && w.endsWith("ed")) {
    add(w.slice(0, -1)); // agreed -> agree
    add(w.slice(0, -2)); // safaried -> safari
    add(stripDoubledConsonant(w.slice(0, -2))); // stopped -> stop
  }
  if (w.length > 4 && w.endsWith("ying")) {
    add(w.slice(0, -4) + "y"); // studying -> study
    add(w.slice(0, -4) + "ie"); // dying -> die
  }
  if (w.length > 5 && w.endsWith("ing")) {
    add(w.slice(0, -3) + "e"); // making -> make
    add(w.slice(0, -3)); // walking -> walk
    add(stripDoubledConsonant(w.slice(0, -3))); // running -> run
  }
  return out;
}

/**
 * Candidate bases for a comparative or superlative: "godlier" -> "godly",
 * "evenest" -> "even". Spelling only -- the caller decides which candidates are
 * real words and applies the paired-degree guard below, which is what keeps this
 * rule off agent nouns.
 *
 * `plainDegrees` selects the riskier half. The "-ier"/"-iest" candidates rewrite
 * a "-y" adjective and are reliable, but bare "-er"/"-est" is the same spelling
 * an agent noun takes, and no spelling rule can tell "evenest" from "digest" or
 * "privateer". The caller turns those on only where a wrong answer can't cost
 * anything (see dictionary.ts).
 */
export function degreeBaseCandidates(word: string, plainDegrees: boolean): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (base: string) => {
    if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
  };

  if (w.length > 5 && w.endsWith("iest")) {
    add(w.slice(0, -4) + "y"); // happiest -> happy
  } else if (w.length > 4 && w.endsWith("ier")) {
    add(w.slice(0, -3) + "y"); // godlier -> godly
  } else if (plainDegrees) {
    if (w.length > 4 && w.endsWith("est")) {
      add(w.slice(0, -2)); // largest -> large
      add(w.slice(0, -3)); // evenest -> even
      add(stripDoubledConsonant(w.slice(0, -3))); // biggest -> big
    } else if (w.length > 3 && w.endsWith("er")) {
      add(w.slice(0, -1)); // larger -> large
      add(w.slice(0, -2)); // evener -> even
      add(stripDoubledConsonant(w.slice(0, -2))); // bigger -> big
    }
  }
  return out;
}

/**
 * The *other* degree of `base`, spelled the way `word` spells this one -- or
 * undefined when `word` isn't a degree form of `base` at all. The caller requires
 * the answer to be a dictionary word: a base attested in both degrees is being
 * used as a gradable adjective, which is what separates a real comparative from
 * an agent noun that merely ends the same way. "supply" has no "suppliest", so
 * "supplier" is not "more supply"; "happy" has both, so "happier" is.
 *
 * The spelling has to match, not merely exist somewhere in the base's paradigm.
 * English requires consonant doubling on a CVC monosyllable -- "fun" goes to
 * "funner"/"funnest", never "funer"/"funest" -- so accepting any spelling let the
 * doubled pair vouch for a single-consonant word: "funest" is a Latinate
 * adjective (funeste, "fatal"), and "funnest" being a headword was taken as
 * evidence that it is the superlative of "fun". Pairing the variants asks for
 * "funer" instead, which no dictionary has. The same slip licensed "digest" from
 * "digger" and "honest" from "honer".
 */
export function degreeCounterpart(word: string, base: string): string | undefined {
  const w = word.toLowerCase();
  const b = base.toLowerCase();
  const doubled = b + b[b.length - 1];
  // Each variant spells both degrees the same way, so the counterpart is fixed
  // once we know which one `word` used.
  const variants: [string, string][] = b.endsWith("y")
    ? [[b.slice(0, -1) + "ier", b.slice(0, -1) + "iest"]]
    : [
        b.endsWith("e") ? [b + "r", b + "st"] : [b + "er", b + "est"],
        [doubled + "er", doubled + "est"],
      ];
  for (const [comparative, superlative] of variants) {
    if (w === comparative) return superlative;
    if (w === superlative) return comparative;
  }
  return undefined;
}
