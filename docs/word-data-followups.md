# Word data follow-ups

Open findings about the curated word list and the rejection pipeline: things that
are known-wrong, known-incomplete, or worth a decision, but that were out of scope
for the change that surfaced them. Each entry says what is wrong, how it was
found, and what fixing it would take. Delete an entry when it is fixed — this file
is a queue, not a changelog.

Opened 2026-08-23, alongside the derived rejections (`src/data/derived-rejections.json`).

## 1. The add-a-word path doesn't know about the reject path

`scripts/manage-extra-word.py add` gates only on "does a corpus attest this word"
(the frequency waterfall). It never consults the Wiktionary classification, so it
can insert a word that is labelled obsolete, archaic, dated, an abbreviation or a
proper noun straight into `dictionary.json` — and the next
`generate-data.py --refresh-rejections` immediately makes that word unplayable.
The two halves of the pipeline disagree, and the add action reports success either
way.

Fix: classify the word during `add` and refuse (or warn, with a `--forced` escape)
when it carries a reason. The classification is already loadable —
`load_wiktionary_reasons()` in `generate-data.py` — so this is a check, not new
data. Same applies to the "add words found online" action, which feeds the same
function.

## 2. Wiktionary files "Ellipsis of X" under the abbreviation tag

`scripts/import-wiktionary-words.py` treats `abbreviation`, `initialism` and
`acronym` as one class. Wiktionary uses the first of those for clippings and
ellipses too, so ordinary English nouns come through as abbreviations: `condo`,
`thymus` ("Ellipsis of thymus gland"), `ascot`, `venetian`, `corgi`, `serrano`,
`lapis`, `lazuli`, `seltzer`, `romaine`, `queso`, `minke`, `durum`, `oblongata`,
`hansom`, `previa`. Meanwhile `vet`, `demo`, `memo` and `app` escape, because
Wiktionary happens not to tag them — so the class is noise, not a rule.

A frequency gate cannot separate the two: `condo` (Zipf 3.63) and `ppl` (3.66) sit
on top of each other.

This predates the derived rejections. `ALWAYS_EXCLUDED_REASONS` has always
contained `abbreviation`, so a full rebuild would *delete* these words outright —
worse than rejecting them, because a deleted word loses its rarity entry and the
puzzles that accepted it stop adding up. They are only still in the dictionary
because the classification landed after the last full rebuild (2026-08-17).

Stopgap in place: `scripts/playable-exemptions.txt`, which wins in both places —
it takes a word back out of the derived rejections and spares it the rebuild's
exclusion filter. Twenty checked nouns are listed there.

Fix: record the sense's `alt_of` / `form_of` in the importer and keep the
ellipsis/clipping senses out of the abbreviation class (they are closer to a
variant spelling than to an initialism). Needs a fresh Wiktextract dump run.

## 3. Inflected forms of a rejected word are still playable

The rejections are per headword, because Wiktionary labels headwords. So
`tobacconist` is dated but `tobacconists` is not; `woode` is obsolete but `woodes`
is not. Roughly 1,000–2,400 dictionary words are an inflection of something the
list rejects.

A naive extension is worse than the gap: suffixing every rejected word breaks
through abbreviation stems and rejects `thing` (`th` + `ing`), `served`
(`serv` + `ed`) and `string` (`str` + `ing`).

Fix, if taken: restrict it to the out-of-use trio, use the same spelling rules the
scoring fold uses rather than naive concatenation, require the inflection's own
base to resolve to the rejected word, and keep the Zipf 2.5 gate.

## 4. `select-drops.py` counts unplayable words toward a drop's richness

`scripts/reorder-drops.py` filters both the reviewed and the derived rejections
before counting how many words a drop can reach; `scripts/select-drops.py` filters
neither. The two scripts therefore disagree about how rich a candidate drop is, by
up to 5,439 words. Pre-existing asymmetry, now larger.

## 5. Rejection reasons are cast, not validated

`DERIVED_REJECTIONS` in `src/game/dictionary.ts` casts each reason key straight to
`RejectionReason`. A stray key in the generated JSON would produce a rejection with
no entry in `REJECTION_MESSAGES`, and the player would see an empty message rather
than an error. A test pins the reasons the current data uses, so this only matters
for a future regen that introduces a new one.

## 6. Two word-list-shaped payloads now ship to the client

`rejection-metadata.json` (63k words) and `derived-rejections.json` (5.4k words,
+52KB raw / +21KB gzipped) are both bundled. Neither is large on its own and
nothing is watching the total. Worth a look if the bundle budget ever tightens —
both are sorted word lists and compress far better as newline-joined strings than
as JSON arrays.

## 7. Three fold gaps, found by a benchmark that otherwise failed

On 2026-09-22 an LLM "common form" pass was benchmarked against the fold as a
candidate normalizer, on two seeded 1,000-word samples. **It lost, and the idea is
dead** — the LLM seeks the lemma rather than the most common form, and it cannot
tell a mechanical suffix from a semantic drift, so it over-folded words with
meanings of their own (`agentry`, `betweentimes`, `kissoff`, `funsies`,
`protolanguages`). Scored on display score, the fold was right on 757 of 1,000.
Note for anyone tempted again: compare display scores, not base strings — string
comparison counts `absorbing`→`absorbed` against the LLM's `absorb` as a
disagreement when it is the same cap and the same score.

Three gaps it did surface survived a semantic check and stand on their own:

- **A plural stops the chain.** The inflectional hop fires and the derivational
  hop after it never happens, so a plural of a derived noun keeps the derived
  noun's rarity: `archivists` reaches `archivist` and halts rather than continuing
  to `archive`. Largest single bucket of missed folds in both samples (66 of 231,
  62 of 218). Also `accusers`, `allegorists`, `analyzers`, `dissimilarities`.
- **`-able` is not read.** `makeable` scores 9.67 Mythic against `make` at 2.8.
  Also `updatable` 9.56, `freezable`, `perforable`, `perfectible`.
- **The junk `-es` strip wins where the residue is a common word.** `hearses`
  scores 4.1 Very Common via `hear`: `-es` off gives `hears`, a legal `-es` stem
  shape that `refusedEsStem` therefore does not block, and `hears` folds on to
  `hear`. The real reading is `hearse` + `-s` (7.5 Rare). Same shape in
  `finessed`→`fine`, `petes`→`pet`, `ledes`→`led`, `branes`→`bran`,
  `orles`→`orl`, `corpses`→`corps`, `lapses`→`lap`. Unlike the other two this one
  *under*-scores, and it shows the player a common-form note naming the wrong
  word.

Sizing that last one across the dictionary was attempted and failed: no filter
separated the mis-strips from correct folds like `churches`→`church` and
`businesses`→`business`, because the archaic `-e` spellings (`churche`,
`businesse`) are in the dictionary and attested. A better discriminator is needed
before any population count means anything.

## 8. Decisions parked, not bugs

- **Archaic words below the gate.** `betwixt` (Zipf 2.39), `quoth` (2.08),
  `prithee` (1.92) and `forsooth` (1.73) are unplayable under the archaic rule.
  Each is one line in `playable-exemptions.txt` if they should come back.
- **Duplicate detection drifts on 8 words.** `rootKey` in `src/game/submit.ts`
  folds bound suffixes through `isValidWord`, so a rejected base stops collapsing
  its derived forms (`anatomization` → `anatomize`, and 7 like it). All 8 still
  collide on their inflectional stem, so nothing is reachable in play today; it
  would matter if the rejected set grew a base with two playable derivations.
