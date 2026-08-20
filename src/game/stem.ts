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
 *
 * The caller confirms each candidate is a real word and picks the most common
 * one, which is what keeps the coincidences harmless: "caves" offers both "cave"
 * and "cafe", "saves" offers both "save" and "safe", and the right base wins
 * because it is the more common word. Candidates shorter than three letters are
 * dropped -- two-letter dictionary entries carry corpus frequencies collected
 * from every word that contains them, so they read as absurdly common and would
 * flatten anything that folded onto them.
 *
 * Tense (-ed/-ing) is not here: `tenseBaseForm` in dictionary.ts already owns it.
 */
export function inflectionalBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (...bases: string[]) => {
    for (const base of bases) {
      if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
    }
  };

  // Most specific first only for readability -- the caller ranks by frequency,
  // not by the order these are added.
  if (w.length > 5 && w.endsWith("ices")) add(w.slice(0, -4) + "ex", w.slice(0, -4) + "ix");
  if (w.length > 4 && w.endsWith("ies")) add(w.slice(0, -3) + "y", w.slice(0, -3) + "i");
  if (w.length > 4 && w.endsWith("ves")) add(w.slice(0, -3) + "f", w.slice(0, -3) + "fe");
  if (w.length > 4 && w.endsWith("es")) add(w.slice(0, -1), w.slice(0, -2));
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));

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
