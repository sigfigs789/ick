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

/**
 * Candidate base spellings for the endings `baseForm` deliberately leaves alone:
 * agent nouns and comparatives (-er/-ers/-est) and the plurals whose two-character
 * "-es" cut lands on a non-word ("patiences" -> "patienc", but "patience" is right
 * there). Scoring-only -- `baseForm` also drives same-root duplicate detection in
 * submit.ts, and widening that would change which submissions are rejected.
 *
 * Every candidate is only ever used as a *cap* (see adjustedZipf), so a wrong
 * guess can pull a word toward a more common base but can never make it rarer.
 * The caller confirms a candidate is a real word before trusting it.
 */
export function derivedBaseCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (base: string) => {
    if (base.length >= 3 && base !== w && !out.includes(base)) out.push(base);
  };

  // Plural agent nouns first ("registerers" -> "register"), then the singular.
  if (w.length > 5 && w.endsWith("ers")) {
    const stem = w.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    add(stripDoubledConsonant(stem));
  }
  if (w.length > 4 && (w.endsWith("er") || w.endsWith("est"))) {
    const stem = w.slice(0, w.endsWith("est") ? -3 : -2);
    add(stem);
    add(`${stem}e`);
    add(stripDoubledConsonant(stem));
    if (stem.endsWith("i")) add(`${stem.slice(0, -1)}y`);
  }
  // "-es" where dropping both characters misses the base ("wildlifes" -> "wildlif").
  if (w.length > 4 && w.endsWith("es")) add(w.slice(0, -1));

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
