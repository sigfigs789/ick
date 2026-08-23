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
  if (w.length > 5 && w.endsWith("ing"))
    return stripDoubledConsonant(w.slice(0, -3));
  if (w.length > 5 && w.endsWith("ied")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed"))
    return stripDoubledConsonant(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);

  return w;
}

/**
 * Every base spelling `word` could plausibly be a *number* inflection of -- the
 * plural of a noun or the third-person singular of a verb. Scoring only, and
 * deliberately separate from `baseForm` above: that one has to return exactly
 * one key for duplicate detection, so it commits to the first rule that matches
 * and cannot look at the dictionary. Committing is what leaves the gaps this
 * covers.
 *
 *   - "-es" strips only the `s` when the base keeps its `e` ("asphyxiates" ->
 *     "asphyxiate"). `baseForm` only ever strips both letters, which yields the
 *     non-word "asphyxiat" and leaves the word scoring on its own frequency --
 *     the single biggest hole, ~6,900 words wide.
 *   - "-ies" -> "y" at any length ("cries" -> "cry"); `baseForm` requires six
 *     letters and so misses the five-letter forms.
 *   - "-ies" -> "i" for bases that end in one ("taxies" -> "taxi").
 *   - the irregular plurals English spells with a stem change: "-ves" -> "-f"
 *     or "-fe" ("wolves" -> "wolf", "knives" -> "knife") and "-ices" -> "-ex"
 *     or "-ix" ("matrices" -> "matrix", "vortices" -> "vortex").
 *   - "-es" -> "-is" for the Greek and Latin plurals spelled with a vowel
 *     change ("analyses" -> "analysis", "crises" -> "crisis", "oases" ->
 *     "oasis"). The one coincidence far more common than the true base is
 *     "theses" -> "these", and the reviewed override pinning "theses" to
 *     "thesis" replaces the spelling guesses outright, so it wins. The other
 *     known misfires ("neurites" -> "neuritis", "metropoles" -> "metropolis")
 *     land on a near-frequency sibling, the small-magnitude shape an override
 *     can catch if it ever matters.
 *   - the classical plurals borrowed whole: "-ae" -> "-a" ("scapulae" ->
 *     "scapula", "formulae" -> "formula"), "-i" -> "-us" ("radii" -> "radius",
 *     "abaci" -> "abacus"), and the native "-men" -> "-man" ("crewmen" ->
 *     "crewman", "chairmen" -> "chairman"). The matching "-a" -> "-on" plural is
 *     deliberately absent: it folds "comma" -> "common", "silica" -> "silicon"
 *     and "squadra" -> "squadron", about 19 wrong in 280.
 *
 * The caller confirms each candidate is a real word and picks the most common
 * one. That is what keeps the coincidences harmless, though not for the reason
 * it first looks like: "caves" offers both "cave" (4.20) and "cafe" (4.09), and
 * "saves" offers both "save" (5.14) and "safe" (5.07). The right base does win
 * both, but by 0.11 and 0.07 Zipf -- margins thin enough that a data refresh
 * could flip either. The safety comes from the near-tie itself. Two candidates
 * that close carry nearly the same frequency, so picking the wrong one moves the
 * score by about a sixth of a point; a coincidence only does real damage when it
 * is *far* more common than the true base, and that is the shape a reviewed
 * override exists to catch ("theses" -> "these", 2.83 Zipf clear of "thesis").
 *
 * Candidates shorter than three letters are dropped -- two-letter dictionary
 * entries carry corpus frequencies collected from every word that contains them,
 * so they read as absurdly common and would flatten anything folding onto them.
 *
 * Tense (-ed/-ing) is not here: `tenseBaseForm` in dictionary.ts already owns it.
 */
export function inflectionalBaseCandidates(
  word: string,
  latinPlurals: boolean,
): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (...bases: string[]) => {
    for (const base of bases) {
      if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
    }
  };

  // Most specific first only for readability -- the caller ranks by frequency,
  // not by the order these are added.
  if (w.length > 5 && w.endsWith("ices"))
    add(w.slice(0, -4) + "ex", w.slice(0, -4) + "ix");
  if (w.length > 4 && w.endsWith("ies"))
    add(w.slice(0, -3) + "y", w.slice(0, -3) + "i");
  if (w.length > 4 && w.endsWith("ves"))
    add(w.slice(0, -3) + "f", w.slice(0, -3) + "fe");
  if (w.length > 4 && w.endsWith("men")) add(w.slice(0, -3) + "man");
  if (w.length > 4 && w.endsWith("es")) {
    add(w.slice(0, -1), w.slice(0, -2), w.slice(0, -2) + "is");
  }
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  // The Latin plurals, only where the caller says the spelling can be read
  // that way: "-a"/"-i"/"-ae" is how Latin pluralises and also how English
  // spells a great many ordinary singulars, and nothing in the letters
  // separates "podia" from "alba" or "taxi" from "abaci". The caller's guard
  // is the word taking an English plural of its own (see latinPluralsAllowed
  // in dictionary.ts), which is also what lets "-a" -> "-um" fold above the
  // measurement floor: "aquaria", "addenda" and "maxima" are all measured, and
  // all scored rarer than their own singulars behind a frequency gate.
  if (latinPlurals) {
    if (w.length > 3 && w.endsWith("ae")) add(w.slice(0, -1));
    if (w.length > 3 && w.endsWith("i")) add(w.slice(0, -1) + "us");
    if (w.length > 4 && w.endsWith("a")) add(w.slice(0, -1) + "um");
  }

  return out;
}

/**
 * The comparative/superlative reading of an "-ier"/"-iest" word: the "-y"
 * adjective it would be a degree of, paired with the *other* degree of the same
 * base. Spelling only -- the caller requires both `base` and `counterpart` to be
 * dictionary words before trusting the reading.
 *
 * The counterpart is the guard, and it is what lets this family fold *above*
 * MEASURED_FLOOR when the bare "-er"/"-est" rules below must not. "-ier"/"-iest"
 * rewrites a "-y", so the reading is checkable: a base attested in both degrees
 * is being used as a gradable adjective ("happy" has "happiest", so "happier"
 * folds), while an agent noun that merely ends the same way fails the check
 * ("copy" has no "copiest", so "copier" keeps its own measured score; same for
 * "carrier", "collier", "crier"). Without the rule, every measured comparative
 * scored rarer than its own adjective -- "angrier" 7.33 against "angry" 4.52,
 * "earliest" 5.35 against "early" 3.38 -- because the gated rules never reach a
 * measured word.
 */
export function degreeBaseCandidates(
  word: string,
): { base: string; counterpart: string }[] {
  const w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("iest")) {
    const stem = w.slice(0, -4);
    return [{ base: stem + "y", counterpart: stem + "ier" }];
  }
  if (w.length > 4 && w.endsWith("ier")) {
    const stem = w.slice(0, -3);
    return [{ base: stem + "y", counterpart: stem + "iest" }];
  }
  return [];
}

/**
 * Candidate bases for the suffixes whose spelling is *not* decisive -- safe to
 * consult only for a word that no corpus really attests. The caller enforces
 * that (see MEASURED_FLOOR in dictionary.ts); this function just supplies the
 * spellings.
 *
 *   - "-er"/"-est" comparatives and agentives: "specialest" -> "special",
 *     "knowinger" -> "knowing", "thanker" -> "thank".
 *   - the Latin neuter plural "-a" -> "-um": "asyla" -> "asylum",
 *     "pepla" -> "peplum", "clitella" -> "clitellum".
 *   - "-ize"/"-ise" verbs and their tenses -> the stem they were built from:
 *     "containerise" -> "container", "ghettoise" -> "ghetto", "tautologize" ->
 *     "tautology". This also un-sticks the "-ization" fold, which used to
 *     dead-end on an unattested verb: "winterisation" folded to "winterise"
 *     (Zipf -0.45) and stopped, when "winter" (4.18) was one strip further.
 *   - "-able"/"-ible"/"-ably"/"-ibly" -> the stem: "interviewable" ->
 *     "interview", "requirable" -> "require".
 *
 * Nothing in the spelling separates a real comparative from a word that merely
 * ends that way: applied to every word these rules fold "noter" -> "not",
 * "tempest" -> "temp", "canter" -> "cant", "shoulder" -> "should" and "comma" ->
 * "common". What makes them usable anyway is *where* they are allowed to apply.
 * Below wordfreq's measurement floor a word's score is a stand-in rather than a
 * measurement, so a plausible base is strictly better information than the
 * sentinel it would otherwise get; at or above the floor there is a real
 * measurement, and a spelling guess must not be allowed to overrule it. Every
 * word in the list above sits at or above the floor and is excluded on those
 * grounds -- "tempest" is measured at Zipf 3.29, "canter" at 2.72, "noter" at
 * 1.27. The last two families make the same point louder: ungated, "-ize" folds
 * "capsize" -> "cap", "downsize" -> "downs" and "expertise" -> "expert", and
 * "-able" folds "likeable" -> "like", "countable" -> "county" and "fallible" ->
 * "fall". Gated, not one of those words moves, and 2,466 words still stop
 * holding a Mythic-or-better score for a suffix.
 *
 * Two families stay out even under that gate. "-en" verbs ("harshen" -> "harsh")
 * are right often enough to tempt but fold loanwords onto lookalikes -- "dudeen"
 * (a clay pipe) -> "dude", "shoneen" -> "shone", "torten" -> "tort". Five-letter
 * "-ing" is moot: every such word is measured above the floor, so the gate leaves
 * none of them to fold, which is also what keeps "thing" from scoring as "the".
 */
export function unmeasuredBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (...bases: string[]) => {
    for (const base of bases) {
      // Four letters, not the three the number inflections allow: a three-letter
      // base is where the wrong-word folds cluster ("the", "not", "cant").
      if (base.length >= 4 && base !== w && !out.includes(base)) out.push(base);
    }
  };

  for (const suffix of ["est", "er"]) {
    if (!w.endsWith(suffix) || w.length <= suffix.length + 3) continue;
    const stem = w.slice(0, -suffix.length);
    // For "-ier"/"-iest", the "-y" rewrite is the only candidate: below the
    // floor "hurrier" really is one who hurries, and "abandoner"-style agent
    // nouns are exactly what this rule is for. The *other* i-stem candidates
    // are what let a junk stem chain somewhere real -- "campier" reached
    // "campus" through the non-word-shaped "campi" and out-voted its actual
    // base "campy" -- so they stay out. Above the floor the spelling belongs
    // to degreeBaseCandidates, whose paired-degree check earns it the fold.
    if (stem.endsWith("i")) {
      add(`${stem.slice(0, -1)}y`);
      continue;
    }
    add(stem, `${stem}e`, stripDoubledConsonant(stem));
  }
  // Bare "-ize"/"-ise" only. A *tensed* form reaches this family through its
  // attested verb or not at all: the tense and number rules already offer the
  // verb as a candidate, so the caller's gate is applied at the verb, once per
  // paradigm. Stripping the tensed endings here read the -is noun plurals as
  // verb tenses ("appendicitises", "whatsises" -> "what") and let "womanizes"
  // through a strip its own measured verb was barred from.
  // The "y" candidate is what reaches the noun a verb was built from
  // ("tautologize" -> "tautology", "ebonize" -> "ebony").
  for (const suffix of ["ize", "ise"]) {
    if (!w.endsWith(suffix) || w.length <= suffix.length + 3) continue;
    const stem = w.slice(0, -suffix.length);
    add(stem, `${stem}e`, `${stem}y`);
  }
  for (const suffix of ["ably", "ibly", "able", "ible"]) {
    if (!w.endsWith(suffix) || w.length <= suffix.length + 3) continue;
    const stem = w.slice(0, -suffix.length);
    add(stem, `${stem}e`, `${stem}y`);
  }

  return out;
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
 * Candidate bases for the derivational families whose ending is *bound* -- a
 * string English only ever produces by attaching that suffix, so nothing
 * accidental ends that way. That is the same property that earns
 * `boundBaseCandidates` its ungated fold, and it is what separates these from
 * the `-al`/`-ic`/`-ity` families still left alone: an ending that doubles as
 * ordinary word-final material folds "metal" -> "met" and "unity" -> "unit",
 * and no gate can tell those from the genuine derivations.
 *
 *   - "-ically" -> "-ic": "catholically" -> "catholic", "arctically" ->
 *     "arctic". These are the adverbs the "-ly" rule in `scoringBaseForm`
 *     cannot reach, because the "-ical" adjective it would strip back to is
 *     usually not a word ("basical", "toxical"). The largest single family
 *     left unfolded -- 1,005 words, 557 of them holding a Mythic-or-better
 *     score for an ending.
 *   - "-ably"/"-ibly" -> "-able"/"-ible": "availably" -> "available",
 *     "susceptibly" -> "susceptible". `unmeasuredBaseCandidates` strips these
 *     endings to the bare *stem*, and only below the floor; the adjective one
 *     step up is the base a measured adverb needs, and it is checkable in a way
 *     the bare stem is not.
 *   - "-ologist" -> "-ology": "mythologist" -> "mythology". Every "-ologist" is
 *     the agent noun of an "-ology".
 *   - "-cked"/"-cking" -> "-c": "panicked" -> "panic", "trafficking" ->
 *     "traffic". The k English inserts to keep a final c hard; `baseForm`
 *     strips the ending and lands on the non-word "panick", because "ck" is not
 *     a doubled consonant and `stripDoubledConsonant` leaves it. The matching
 *     "-cker" is deliberately absent: an agent noun is at least as likely to be
 *     built on a "-ck" verb, and the rule folds "blockers" -> "bloc",
 *     "crockers" -> "croc" and "specker" -> "spec".
 *   - "-eaux" -> "-eau": "bureaux" -> "bureau", "tableaux" -> "tableau". The
 *     French plural, and the smallest family here -- 20 words, no other word in
 *     the dictionary ends "-eaux".
 *
 * Every one of these runs above MEASURED_FLOOR, like the bound suffixes and the
 * paired-degree comparatives: the gate is not what makes them safe, the ending
 * is. The caller confirms each candidate is a real word, and the fold caps
 * rather than inherits, so a candidate rarer than the word itself is inert --
 * which is why "physically" keeps its own score rather than taking the much
 * rarer "physic", and "critically" keeps its own rather than "critic".
 */
export function derivedBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (base: string) => {
    if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
  };

  if (w.length > 8 && w.endsWith("ically")) add(w.slice(0, -4));
  if (w.length > 6 && w.endsWith("ably")) add(`${w.slice(0, -4)}able`);
  if (w.length > 6 && w.endsWith("ibly")) add(`${w.slice(0, -4)}ible`);
  if (w.length > 8 && w.endsWith("ologist")) add(`${w.slice(0, -3)}y`);
  for (const suffix of ["cked", "cking"]) {
    if (w.endsWith(suffix) && w.length > suffix.length + 2) {
      add(`${w.slice(0, -suffix.length)}c`);
    }
  }
  if (w.length > 5 && w.endsWith("eaux")) add(w.slice(0, -1));

  return out;
}
