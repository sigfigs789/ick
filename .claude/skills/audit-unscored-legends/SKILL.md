---
name: audit-unscored-legends
description: Audit the words a WordInk (ick) drop can reach that score a perfect 10.00 / Legend only because no frequency corpus attests them — by default tomorrow's drop, Mountain Time. Triages every unscored word and judges rejection first (misspellings, archaic/dated/obsolete words, proper nouns, abbreviations — anything the word rules exclude), then demotion for simple derivations that should score as their base word (placation → placate, lactational → lactation), then keep for genuine finds like enshittification. Applies the verdicts to src/data/score-overrides.json and the dictionary data, and finishes by opening a draft PR whose body tables every word caught, which ones keep their score, and which are demoted or rejected and why. Use whenever Mo asks to run the daily word-quality audit, check tomorrow's drop for words with no Zipf score, demote undeserved Legends, or clean up the perfect-10 answers for a drop.
---

# Audit a drop's unscored Legends

A player who lands a Legend should feel like they found something. The perfect
10.00 at the top of the scale is handed out by `rarity.json`'s unattested
sentinel — the stand-in Zipf for a word wordfreq, Norvig and Google Books all
miss. Sometimes that is exactly right:

> `enshittification` scores 10.00 because the corpora have not caught up with it.
> `iratest` scores 10.00 because it is the superlative of `irate` (Zipf 2.78) and
> `scoringBaseForm` has no `-est` rule. One earns the tier. The other cheapens it
> for every word that did.

**Keep fun. Demote mechanics. Reject what the word rules exclude.** When in doubt,
keep: a fun word scored a little high is a much smaller problem than a beloved
word deleted or a delightful find flattened to Uncommon.

## Scope

**One drop, unscored words only.** The words in play are the dictionary words
containing the puzzle date's drop — by default tomorrow's, Mountain Time — whose
Zipf *after* the game's existing base-form folding is still the sentinel. Nothing
else is a finding this run:

- A word with a real measured frequency is out of scope even if its rank looks
  wrong. An attested inflection outranking its base is a separate, deliberate
  call — not this run's, and not a stemmer rule either; see "If you still think
  the stemmer is the answer" below for why.
- A word a player cannot reach on this puzzle is not this run's problem, however
  bad it looks. Never widen into a dictionary-wide sweep.

## 1. Run the triage

From the ick checkout (read-only; changes nothing):

```bash
python3 .claude/skills/audit-unscored-legends/audit_unscored.py
```

`--date YYYY-MM-DD` for another puzzle, `--drop ATE` for an arbitrary drop,
`--json` for the full diagnostics, `--all` to ignore the ledger. Judged words go
in `reviewed.txt` next to the script and never come back — drops repeat, so
without the ledger the same kept words reappear every few days.

Every number comes from the scoring mirrors in `scripts/manage-extra-word.py`, so
it matches what a player sees — including demotions recorded by earlier runs,
which is why a word you already demoted drops out of the candidate set instead of
being re-reported.

The run buckets each word by **the decision it needs**, not by how it is spelled:

| bucket | what it means | usual verdict |
| --- | --- | --- |
| **Demote** | a suffix form whose base is measured and materially more common. Adding `-s`/`-est`/`-ation` bought it the top of the scale. | demote to the base |
| **Reject** | Wiktionary already classifies it obsolete, archaic or dated | reject |
| **Judge the family** | its base is as unscored as it is, so folding would not move the displayed score. The question is whether the family belongs in the dictionary. | usually keep; reject a typo family whole |
| **Judge** | only a *prefixed* base exists. A prefixed form is a different word and is often genuinely rarer. | judge on the merits |
| **Judge** (no base) | nothing mechanical explains the score | keep unless you can name the fault |

`--min-gap` (default 0.25) is what separates *demote* from *judge the family*: a
fold that moves the displayed score by less than that is invisible to a player, so
it is not worth an override entry.

## 2. Judge each word — reject, then demote, then keep

Ask these in order. **Reject beats demote**: folding a junk word onto a base leaves
it playable at a lower score, so the player still gets a non-word accepted.

### a. Should it be playable at all?

The word rules (`WordRulesModal.tsx`) exclude proper nouns, abbreviations,
misspellings, and obsolete, archaic or dated words. Any of those is a rejection,
not a rescore. Tells:

- **Misspelling** — a doubled or dropped letter against an attested sibling. The
  run flags these with ⚠, e.g. `⚠ accomodate (Zipf 2.45) vs accommodate (Zipf 4.02)`.
  The player-facing message doesn't name the correct form, but you still have to
  be able to point at one — otherwise it's `spurious`, not a misspelling.
- **Archaic / dated / obsolete** — reads as 17th-century, or the run's `classified`
  column already says so.
- **Spurious** — the only member of its family, no identifiable correct spelling,
  looks like an import artefact (`tormentatious`).
- **A whole typo family** — `reassimiliate/-d/-s/-ing`, all with the same stray
  `i`. Reject the family or none of it; half a family is incoherent.

**An `-ise`/`-ize` pair is not a misspelling.** The dictionary ships American,
British, Canadian and Australian spellings on purpose, so `immaterialise` and
`immaterialize` both stay. Same for genuine variant spellings (`canulate` /
`cannulate`) — both are attested medical forms.

### b. Is it a mechanical derivation of a real word?

Then it should score as its base. This is the case the user's own examples name:
`placation` → `placate`, `lactational` → `lactation`. A suffix is not a discovery.
Applies to plurals, tenses, comparatives/superlatives, agent nouns, and the
transparent derivational endings.

Fold onto the **nearest** base, not the deepest: `cocultivates` → `cocultivate`,
never straight to `cultivate`. And check the base's spelling first — folding onto
`accomodate` bakes a typo into the score.

A **prefixed** form is not automatically a demotion. `misrates` really is rarer
than `rates`, and capping it there (4.2, Common) is as wrong as leaving it at
10.00. Demote a prefixed form only when the prefix is doing no work.

### c. Otherwise keep it.

Fun to discover even if obscure or debatable — technical and historical words
(`nizamate`, `ossiculate`, `machicolate`), and neologisms the corpora have not
caught up with (`enshittification`). **This is the bucket that should be carrying
the tier.** Fun but negotiable stays.

`python3 scripts/check-word.py <word>` gives the rarity plus, for an excluded
word, the category ESDB recorded.

## 2b. What to deliberately leave alone

The point of the buckets is that the daily run stays cheap. Do not re-litigate:

- **Folds under `--min-gap`** — the word and its base display the same score.
- **Attested words** — a real frequency is a measurement, not a guess. Out of scope.
- **The no-base bucket** — that is the tier's content.
- **The stemmer.** The tempting fix for a whole bucket at once is a wider
  `baseForm`. It has been measured and it is not worth it: a blanket bare-`s`
  strip re-scores **11,015** words, changes **6,892** ranks and strips **2,185** of
  a perfect 10 (`despites` 9.90 → 4.02, `aboves` 9.58 → 3.72). Removing or pinning
  seven words beats re-scoring ten thousand. That is why this skill uses a curated
  override file.

### If you still think the stemmer is the answer — measure first

Narrowing the rule does not rescue it. Restricting the same change to
`-ise/-ize/-yse/-yze` still moves 1,471 words, changes 625 ranks and strips 375
of a perfect 10 (`mayonnaises` 9.90 → 6.60, `expertises` 9.69 → 5.40).

A scoring-policy change wearing a bug fix's clothes passes the existing suite,
because the date gate freezes past puzzles — **the tests will not catch it for
you.** #153 added an invariant sweep asserting no word scores rarer than its own
measurement, which catches one specific class of regression; it says nothing
about how many words a change re-scores. A green suite is not coverage here.

To measure, drop a throwaway test in `src/game/` (real code, no
reimplementation), run it, delete it:

```ts
import words from "../data/dictionary.json";
import { rarityFor, rarityScore } from "./dictionary";
// compare rarityFor(w, DAY_BEFORE_CUTOVER) against rarityFor(w, CUTOVER)
// count: zipf changed, rank changed, lost a perfect 10; print the biggest movers
```

If you do ship a scoring change it needs a **new dated cutover** in
`src/game/dictionary.ts` (follow `CHAINED_BASE_START`, the most recent one) so
past puzzles never re-score, a mirror in `adjusted_zipf` in
`scripts/manage-extra-word.py` — the audit skills read it, and they drift
silently from the game if it is not updated in lockstep — and tests on both
sides of the date. Note `baseForm` is shared with duplicate detection in `submit.ts` —
change the scoring lookup, not the stemmer, or `glasses` stops folding to
`glass`.

## 3. Apply the verdicts

One command records all three verdicts. **Dry run by default:**

```bash
python3 .claude/skills/audit-unscored-legends/apply_verdicts.py \
  --demote iratest=irate gravitater=gravitate \
  --reject farebeaten=spurious emeerate=misspelling:emirate \
  --keep nizamate ossiculate --table
```

Add `--apply` to write. `--table` prints the verdict table for the PR body.

**The new scoring starts on the day of the drop and runs forward.** `--date`
defaults to the same puzzle the audit looked at (tomorrow, Mountain Time), and
that date goes in every override's `since`: the demotion is live for that day's
puzzle and every one after it, and every earlier puzzle keeps the score its
players saw. Pass `--date` here only to match a `--date` you passed to the audit —
the script refuses a date in the past (it would re-score played puzzles) and warns
on today (whose puzzle is live, so a player mid-game would watch a score change).

Rejections are dated the same way, so an archived puzzle still validates the words
it validated on the day it was played.

**Every word the audit surfaced needs a verdict.** The script re-runs the audit for
`--date` and warns about any candidate you left out — a word with no verdict stays
at 10.00 and resurfaces tomorrow, which is easy to cause by hand-assembling this
many flags. Read that warning before you commit.

| verdict | mechanism | player sees |
| --- | --- | --- |
| `--demote WORD=BASE` | an entry in `src/data/score-overrides.json` | the word still plays, at the base's score |
| `--reject WORD=misspelling:CORRECT` | an entry in `src/data/word-rejections.json` | *"This looks like a misspelling of another word."* |
| `--reject WORD=archaic\|dated\|obsolete` | same file | *"This looks like an archaic word."* etc. |
| `--reject WORD=proper-noun\|abbreviation` | same file | *"This looks like a proper noun."* etc. |
| `--reject WORD=spurious` | same file, reason `not-a-word` | generic *"not in WordInk's curated list."* |
| `--keep WORD` | `reviewed.txt` only | nothing changes |

### Rejection records a verdict; it does not remove the word

A rejected word **stays in `dictionary.json`** and keeps its `rarity.json` entry.
It is unplayable from its `since` date on, and a player who tries it gets the
reason. This matters for three reasons:

1. **It is judged once.** The audit skips anything already in
   `word-rejections.json`, so a settled verdict never comes back for review.
2. **Nothing can undo it.** The file is hand-maintained and never regenerated. The
   older approach — deleting the word — had to land the exclusion in whichever of
   `blocklist.txt` / `rejection-metadata.json` / `wiktionary-reasons.json` happened
   to be regen-proof for that particular reason, because a full rebuild re-derives
   the dictionary from its sources.
3. **The generated data never moves.** No index-aligned surgery across
   `dictionary[]` / `zipfHundredths[]` / `codes` / `zipfTenths[]` / legacy `codes`,
   no pinned dictionary-length or rejection-metadata counts to update, and past
   puzzles keep scoring the word they accepted.

`blocklist.txt` still exists for content that must never enter the dictionary at
all (slurs, profanity). It is not this skill's tool.

### The preflight refusals are the point

The script exits 1 rather than write when a demotion's base is not more common than
the word (the override would do nothing), when a base is itself demoted
(`adjustedZipf` folds one level only), when a demotion folds onto a word this same
run rejected, when `--date` is in the past, or when a rejected word is attested at
Zipf 2.5 or higher — a word the game already labels Rare or better, which is too
big a call to make in passing. `--force` only after you have handled the cause.

A missing correct spelling is a plain warning, not a refusal: the player-facing
message never names the target, so the rejection is still right. Note it as a
follow-up instead.

## 4. Verify

**No pinned counts to update.** Neither verdict touches the generated data, so the
dictionary length and rejection-metadata totals stay put — that was the main cost
of the old remove-the-word approach.

The tests in `dictionary.test.ts` need no editing either: both suites iterate
whatever the data files hold and assert the invariants.

- Overrides: word and base playable, `since` on or after the wide-band cutover,
  base strictly more common, one fold level only, demoted from `since` and not the
  day before, substitution reported to analytics.
- Rejections: reason renderable by `submit.ts`, word still in `dictionary.json`
  and still scoreable, unplayable from `since` and playable the day before, the
  reason actually reaches `evaluateSubmission`, and `bestWordForDrop` never offers
  a rejected word as a drop's ceiling.

Then:

```bash
npx vitest run && npx tsc -b && npx eslint .
```

## 5. Open the PR

Finish with a **draft PR** — don't stop at a report. Per `AGENTS.md`: work in a
worktree off `main`, `codex/`-prefixed branch, all edits there, checks green
before committing, push, `gh pr create --draft`.

The body leads with the verdict table, verbatim from `--table`:

| word | current | verdict | new score | why |
| --- | --- | --- | --- | --- |
| `iratest` | 10.00 Legend | demoted to `irate` | **7.3** Rare | Superlative of `irate`; a suffix is not a discovery. |
| `nizamate` | 10.00 Legend | **kept** | 10.00 Legend | Earns the tier. |

Then: the bucket counts from step 1 (so the share reviewed is explicit), the words
deliberately kept and why — usually the most reviewable decision in the PR — and
the count of unscored words remaining for the drop ("54 → 37 unscored for ATE").
Every judged word lands in `reviewed.txt` in the same commit, and every rejection
in `word-rejections.json`, so the next daily run is quiet.
