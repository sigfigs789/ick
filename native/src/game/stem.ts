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
