---
name: demote-mythic-plus-scoring
description: Demote the Mythic-or-better scores a WordInk (ick) drop hands out that are not earned. Audits the words a WordInk (ick) drop can reach that display a Mythic-or-better score (9.5+) on a real measured frequency, and judge whether each deserves the rank or is overestimated — by default tomorrow's drop, Mountain Time. The companion to audit-unscored-legends: that skill owns the words no corpus attests at all, this one skips those and takes the rest of the same band, where the wide-band curve hands 9.9+ to any word under Zipf 1.0 no matter how ordinary it is (abandoner 9.91 Legend from a Zipf-4 base, abaci 9.62 Mythic from abacus). Buckets each finding by the decision it needs — reject a word the word rules exclude, demote a mechanical form to its base, keep a genuine find — ranked worst overestimate first, with a ledger so judged words never come back. Applies verdicts to src/data/score-overrides.json and src/data/word-rejections.json and opens a draft PR tabling every call. Use whenever Mo asks to check a drop for overrated Mythics or Legends, find words scoring higher than they deserve, audit the 9.5+ band, or clean up undeserved top-tier scores.
---

# Demote Mythic+ scoring that isn't earned

A Mythic or Legend should mean the player found something. The wide-band curve maps
**any** Zipf under 1.0 into the top half-point of the scale, so the tier fills up
with words whose rank comes from something other than being a rare word:

> `abandoner` scores **9.91 Legend** at Zipf 0.93, while `abandon` sits at Zipf 4.02.
> `materialnesses` scores **9.94 Legend**, while `material` sits at Zipf 4.95.
> `machicolate` scores 10.00 at Zipf -0.17 because it is genuinely obscure. Two of
> those cheapen the tier for the third.

**Keep fun. Demote mechanics. Reject what the word rules exclude.** When in doubt,
keep: a fun word scored a little high is a much smaller problem than a beloved word
deleted or a delightful find flattened to Common.

## Scope

**One drop, attested words only.** Two filters, and both matter:

- **One drop** — the words containing the puzzle date's drop, by default tomorrow's,
  Mountain Time. A word a player cannot reach on this puzzle is not this run's
  problem however wrong its rank looks. Never widen into a dictionary-wide sweep:
  66,676 words are in this band dictionary-wide, and a sweep would produce a review
  nobody can read and a PR nobody can check.
- **Attested only** — a word whose Zipf is `rarity.json`'s sentinel is skipped and
  counted, not judged. Those score 10.00 because nothing measures them, which is
  **audit-unscored-legends**' territory; it wants different evidence and would only
  duplicate the verdicts. The run prints how many it set aside.

Two more things stay out of scope:

- **A rare word scoring rare.** A measured frequency is a measurement, not a guess.
  Most of the band has nothing mechanical explaining its rank — that is what the
  tier is *supposed* to be made of, and the run reports it as a count only.
- **The scoring curve itself.** See *What to leave alone* below.

## 1. Run the triage

From the ick checkout (read-only; changes nothing):

```bash
python3 .claude/skills/demote-mythic-plus-scoring/demote_mythic_plus.py
```

| flag | what it does |
| --- | --- |
| `--date YYYY-MM-DD` | audit that puzzle's drop instead of tomorrow's |
| `--drop ATE` | an arbitrary drop |
| `--bucket fold` | one bucket at a time; repeatable. The sanest way to work — one kind of decision per session |
| `--limit N` | rows per bucket (default 12) |
| `--min-score` | band floor (default 9.5, i.e. Mythic) |
| `--min-drop` | displayed points a fold must move to be reported (default **0.25**) |
| `--candidates-out FILE` | write the batch's words for the apply step to reconcile against |
| `--all` | ignore the ledger |
| `--json` | full diagnostics |

Every number comes from the scoring mirrors in `scripts/manage-extra-word.py`, so
it matches what a player sees — including demotions and rejections recorded by
earlier runs, which is why a judged word drops out of the candidate set instead of
being re-reported. Judged words go in `reviewed.txt` next to the script and never
come back — **drops repeat**, so without the ledger the same kept words reappear
every few days.

Even one drop reaches more of this band than a single sitting can review, so the
run reports a batch per bucket and the ledger carries the rest forward. Expect to
work a drop over several runs.

### The buckets, in review order

Each finding is bucketed by **the decision it needs**. Rejections come first: a junk
word folded onto a base is still a junk word the game accepts.

| bucket | what it means | usual verdict |
| --- | --- | --- |
| **classified** | Wiktionary already records it obsolete, archaic, dated, an abbreviation or a proper noun — all five excluded by the word rules | reject |
| **misspelling** | an attested near-spelling is ≥1.0 Zipf more common, in one of the three shapes that mean *one word, two spellings* | reject, or keep if genuine variants |
| **fold** | same word in another number, tense or degree, with a measured base materially more common | demote to the base |
| **fold-suspect** | the same, but the base is a word everybody uses (Zipf ≥ 5.0). Often empty for a given drop | check the word, not the fold |
| **derivation** | a suffix form of a measured base, where the suffix may or may not be doing real work | judge on the merits |

For scale, the 2026-08-19 `ATE` drop: 2,430 attested words in the band, 40 unscored
ones set aside for the sibling skill, 1,570 that deserve the rank, and 860 findings
— 34 classified, 103 misspelling, 471 fold, 0 fold-suspect, 252 derivation. Every
drop is different; read the run's own header rather than these numbers.

**Ranking is by how far the displayed score would fall** if the word were folded —
the overestimate as a player feels it, not as a Zipf delta. The deep tail compresses
three Zipf points into the top 0.1 of the scale, so a Zipf gap is the wrong unit
here: 0.25 Zipf can be invisible at 9.9x and worth two whole points at Zipf 1.0.

## 2. Judge each word — reject, then demote, then keep

Ask these in order, exactly as in the sibling skill. **Reject beats demote**: folding
a junk word onto a base leaves it playable at a lower score, so the player still
gets a non-word accepted.

### a. Should it be playable at all?

`WordRulesModal.tsx` excludes proper nouns, abbreviations, misspellings, and
obsolete, archaic or dated words. Any of those is a rejection, not a rescore.

The **classified** bucket is Wiktionary's own verdict and is usually right — but read
the word, because the classification is a corpus label and not a judgement about
play (`capreolate` and `indagate` on the ATE drop are both fair rejections).

The **misspelling** bucket is *suspects*, not conclusions, and its false-positive
rate is real: the single-swapped-vowel shape flags `abaser` against `abuser` and
`abscind` against `abscond`, and both of those are genuine words. Trust the shape:

- **doubled consonant** (`abondance` / `abundance`) — high precision, usually a reject
- **s/z swap** (`laterise` / `laterize`) — *never* a misspelling, see below
- **single swapped vowel** — noisy; verify before rejecting

**An `-ise`/`-ize` pair is not a misspelling.** The dictionary ships American,
British, Canadian and Australian spellings on purpose. Same for genuine variant
spellings (`canulate` / `cannulate`) — both are attested medical forms.

### b. Is it a mechanical derivation of a real word?

Then it should score as its base. The **fold** bucket is this case and is nearly
always a straight demotion — `materialnesses` → `material`, `complexest` → `complex`,
`abaci` → `abacus`. These are the same word in another number, tense or degree, and
a suffix is not a discovery.

Fold onto the **nearest** base, not the deepest, and check the base's spelling first
— folding onto a typo bakes it into the score.

The **derivation** bucket is the judgement call, because the same ending can be two
different things. `-er` is the clearest case: the comparative of `damp` is `damper`,
but a `wiretapper` is not a form of `wiretap`. Demote when the suffix does no work;
keep when it makes the word genuinely rarer. **`peopleless` is not `people`** and
`misrates` is not `rates` — capping those at a Zipf-6 base is as wrong as leaving
them at 10.00.

Rows whose base is very common are deliberately ranked **last** inside `derivation`
and flagged `<- base is very common`, because a big drop against a Zipf-6 base
measures the fold's crudeness rather than the word's rank. Do not let the large
number at the top of the sort pull you into a bad demotion — that trap is why the
ranking is built this way.

The **fold-suspect** bucket is the mirror image: the fold is usually still right
(`evenest` really is the superlative of `even`), so check the *word*. This is where
the classical-plural rule's misfires collect (`mosta`, `yeara`, `backa` — reject as
spurious) and where archaic forms hide (`whilest`, `madest` — reject as archaic).

### c. Otherwise keep it.

Fun to discover even if obscure or debatable — technical and historical words
(`machicolate`, `objurgate`), and neologisms the corpora have not caught up with.
Fun but negotiable stays.

`python3 scripts/check-word.py <word>` gives the rarity plus, for an excluded word,
the category ESDB recorded.

## 2b. What to deliberately leave alone

- **The unscored words.** Skipped by construction. They are the sibling skill's.
- **The "deserves it" count.** Reported as a number, never as rows. A rare word
  scoring rare is the tier's content.
- **Folds under `--min-drop`.** The word and its base display near enough the same
  score that a player would not notice; an override entry would buy nothing.
- **The stemmer.** The tempting fix for a whole bucket at once is a wider
  `baseForm`, and it has been measured: a blanket bare-`s` strip re-scores **10,877**
  words, changes **6,786** ranks and strips **2,189** of a perfect 10 (`despites`
  9.90 → 4.02). That is why both audit skills use a curated override file.
- **The scoring curve.** Dictionary-wide, **68,688 words — 30% of the dictionary —
  display 9.5 or better**, against 15 recorded demotions. Per-word verdicts will
  never drain that, and the honest read is that the wide-band curve puts too much of
  the dictionary in the top half-point. Say so in the PR if a batch makes it vivid,
  but **do not change `WIDE_SCORING`, `MEASURED_FLOOR`, `BAND_CEILING` or the
  Mythic/Legend cutoffs from this skill** — that is a product decision about every
  score in the game, not an audit finding.

## 3. Apply the verdicts

One command records all three verdicts, reusing the sibling skill's script — same
files, same preflight refusals, same dating. **Dry run by default:**

```bash
python3 .claude/skills/audit-unscored-legends/apply_verdicts.py \
  --demote materialnesses=material ultimatenesses=ultimate \
  --reject capreolate=archaic aliterates=misspelling:alliterates \
  --keep machicolate objurgate \
  --candidates /tmp/batch.txt \
  --seen .claude/skills/demote-mythic-plus-scoring/reviewed.txt --table
```

Add `--apply` to write. `--table` prints the verdict table for the PR body.

Two flags matter for this skill specifically:

- **`--seen`** must point at *this* skill's `reviewed.txt`. The default is the
  sibling's ledger, and the two audits cover different candidate sets.
- **`--candidates`** takes the file written by `--candidates-out` in step 1. Without
  it the script reconciles against the sibling's unscored audit, which is the wrong
  candidate set here and will warn about words this run never surfaced.

**The new scoring starts on the day of the drop and runs forward.** `--date` defaults
to tomorrow (Mountain Time) — the same puzzle this audit defaults to — and that date
goes in every override's `since`: the demotion is live for that day's puzzle and
every one after it, and every earlier puzzle keeps the score its players saw. Pass
`--date` here only to match a `--date` you passed to the audit. The script refuses a
date in the past and warns on today, whose puzzle is live.

| verdict | mechanism | player sees |
| --- | --- | --- |
| `--demote WORD=BASE` | an entry in `src/data/score-overrides.json` | the word still plays, at the base's score |
| `--reject WORD=misspelling:CORRECT` | an entry in `src/data/word-rejections.json` | *"This looks like a misspelling of another word."* |
| `--reject WORD=archaic\|dated\|obsolete` | same file | *"This looks like an archaic word."* etc. |
| `--reject WORD=proper-noun\|abbreviation` | same file | *"This looks like a proper noun."* etc. |
| `--reject WORD=spurious` | same file, reason `not-a-word` | generic *"not in WordInk's curated list."* |
| `--keep WORD` | `reviewed.txt` only | nothing changes |

Rejection **records a verdict; it does not remove the word.** A rejected word stays
in `dictionary.json` and keeps its `rarity.json` entry, so no index-aligned surgery
across `dictionary[]` / `zipfHundredths[]` / `codes`, no pinned counts to update, and
archived puzzles still validate what they validated on the day. It is unplayable
from its `since` date on, and both audits skip it forever after.

`blocklist.txt` is for content that must never enter the dictionary at all (slurs,
profanity). It is not this skill's tool.

### The preflight refusals are the point

The script exits 1 rather than write when a demotion's base is not more common than
the word, when a base is itself demoted (`adjustedZipf` folds one level only), when
a demotion folds onto a word this same run rejected, when `--date` is in the past,
or when a rejected word is attested at Zipf 2.5 or higher — a word the game already
labels Rare or better, which is too big a call to make in passing. **That last one
fires more here than in the sibling skill**, because every word this audit reports is
attested by definition; a Zipf-2.5 word in this band is a signal to keep, not to
`--force`.

## 4. Verify

No pinned counts to update: neither verdict touches the generated data, and both
suites in `dictionary.test.ts` iterate whatever the data files hold, so new entries
become new cases on their own.

**One assertion needs watching if you override a word the stemmer already folds.**
`"reports the substitution for analytics"` asserts that the day before `since`
there is *no* substitution at all, which assumes the overridden word has no
natural fold of its own. Override one that does and the case fails on the
day-before leg — the scores are right, the assertion is too strong, and the fix is
to assert the *curated* base is not yet in force rather than that nothing is.

Since the 2026-08-19 chained-base cutover (`CHAINED_BASE_START` in
`src/game/dictionary.ts`) this is rarer than it was. The engine now resolves a
base through its own base, so the `-nesses` plurals that used to need an override
each — `materialnesses` reported `materialness` (Zipf 0.65) and displayed 9.94
Legend — resolve to `material` (4.95) unaided and never reach this skill's band.
Prefer letting a mechanical fold happen in the engine over recording it here: if
a finding's base is one the stemmer can already reach, it is a scoring-rule gap,
not an override.

```bash
npx vitest run && npx tsc -b && npx eslint .
```

## 5. Open the PR

Finish with a **draft PR** — don't stop at a report. Per `AGENTS.md`: work in a
worktree off `main`, `codex/`-prefixed branch, all edits there, checks green before
committing, push, `gh pr create --draft`.

The body leads with the verdict table, verbatim from `--table`:

| word | current | verdict | new score | why |
| --- | --- | --- | --- | --- |
| `materialnesses` | 9.94 Legend | demoted to `material` | **4.1** Common | Plural of an -ness noun of `material`; a suffix is not a discovery. |
| `capreolate` | 10.00 Legend | rejected (archaic) | unplayable | Wiktionary records it archaic; the word rules exclude those. |
| `machicolate` | 10.00 Legend | **kept** | 10.00 Legend | Earns the tier. |

Then: the bucket counts from step 1 (so the share reviewed is explicit), **how many
of each bucket remain for the drop** — this band is worked incrementally, so the PR
has to say where the cleanup stands ("reviewed 12 of 471 fold candidates for `ATE`")
— the words deliberately kept and why (usually the most reviewable decision in the
PR), and the band total before and after. Every judged word lands in `reviewed.txt`
in the same commit so the next run is quiet.
