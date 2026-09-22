# Folding from lexical databases: tried, measured weaker, parked

An attempt to replace the scoring fold's spelling rules (`src/game/stem.ts`,
mirrored in `scripts/manage-extra-word.py`) with a table compiled from attested
morphology. **Measured against the rules on 2026-09-22 it was weaker, and the
approach is parked.** This file is the record; no code from the attempt was
kept.

The idea was not idle. §E of
[`inflection-scoring-cases.md`](../src/game/inflection-scoring-cases.md) names
it as the one place a data table should beat a rule: no spelling test separates
`government` (from `govern`) from `battlement` (not from `battle`), but
Wiktionary records the difference. The question was whether that generalises
from one suffix family to the whole fold. It does not.

## What was built

An offline compiler over the 1,217,270-word corpus in `public/corpus/` — the
word list since MODE_CHOICE_START — merging four sources:

- **MorphyNet** — Wiktionary-derived `base → derived` edges, inflectional and
  derivational, prefixes included. 206,769 derivational and 185,515
  inflectional edges once projected onto the corpus, across 5,523 affix classes.
- **lemminflect** — AGID-backed inflection, with a generative OOV path.
- **Hunspell `en_US`** via spylls — intended as the corroboration.
- **Wiktionary `form_of` / `alt_of`** and composition templates, harvested from
  the kaikki extract, which both existing importers discard.

Guards: a minimum base length by edge kind (`infl` 3, `deriv` 4), and a flag —
not a filter — on any fold whose base is more than 3 Zipf commoner than the
word. Transitive chaining was left uncapped so its cost could be measured; it
turned out to be small (141,266 folds at depth 1, 5,379 at depth 2, 56 beyond).

Nothing was hand-corrected: no per-word exemptions, no pinned answers, the
rules' six reviewed files deliberately not read, and the affix-class policy
derived from the completeness measurement rather than authored. Importing any
of it would have made the two systems agree by construction exactly where the
comparison mattered.

## The result

Over the 225,483 words both systems can reach:

| bucket | words | share |
|---|---|---|
| neither folds | 73,967 | 32.8% |
| **the rules fold, the table does not** | **72,760** | **32.3%** |
| same base | 60,857 | 27.0% |
| both fold, to different words | 16,201 | 7.2% |
| **the table folds, the rules do not** | **1,698** | **0.8%** |

The rules fold 149,818 of those words; the table folds 78,756. It misses 72,760
folds the rules make and adds 1,698 they miss — **43 losses for every gain**.

## Why it lost

**The completeness gate refused almost everything derivational.** A class was
admitted only when the sources confirmed 90% of what its spelling shape reaches
— a threshold calibrated on `-ness`, which the rules already ship and which
reads 97% over the curated list. Re-measured over the corpus, `-ness` reads
73.0%, `-less` 82.7%, `-ly` 64.4%, `un-` 45.5%, `-ic` 30.4%. **Nothing passed.**
55 of 5,523 classes cleared it, so **91 of 206,769 derivational edges were
admitted** and the table was effectively inflection-only.

The denominator is why: the corpus carries ~959k Wiktionary headwords MorphyNet
was never built over, so coverage that looks adequate against a curated 225k
list is thin against the list the game actually plays off. Neither the threshold
nor the denominator was adjusted to make a family pass.

**Hunspell is not an attestation source.** `en_US` licenses `battle` + L →
`battlement` on exactly the same footing as `govern` + L → `government` — the
one distinction the whole idea rested on — and also gives `cant` → `canter` and
`temp` → `tempest`, two folds `same-root-cases.md` says to keep out
permanently. Its flags are granted per stem, so anything the flag set can spell
counts as licensed: another spelling system with a stem list, which would have
confirmed the edges most in need of doubt.

**MorphyNet does not rescue the known-bad folds either.** It has no edge for
`temp` → `tempest` or `cap` → `capsize`, but it does assert `cant` → `canter`
as a real `-er` derivation. Attestation is a better guess, not a proof.

**One direction was never built.** The rules cap a lemma at the inflections
built *on* it (the 2026-08-24 direction — `infatuate` at `infatuated`); the
compiler only ever walked derived → base. About a fifth of the losses are that
— `bighead` → `bigheads`, `phratry` → `phratries`, `valency` → `valencies`,
`reinter` → `reinterred` — so it is a gap in what was built rather than in the
data. Closing it would narrow the ratio. It would not change the verdict.

## The one thing worth taking

**Bare `-er`/`-est` comparatives above the measurement floor.** Almost all 1,698
wins are this single family: `abler` → `able` (1.29 → 5.43), `righter` →
`right` (2.01 → 5.96), `wiser` → `wise`, `profounder` → `profound`, `minuter` →
`minute`, `realer` → `real`, `staler` → `stale`.

§B of `inflection-scoring-cases.md` lists exactly this as a known gap of 542
words, refused because §4's paired-degree check does not transfer above the
floor: the dictionary carries the archaic second-person forms `thinkest` and
`knowest`, so the check passes for verbs and folds `thinker` → `think`.
lemminflect settles it with a part-of-speech tag instead of a spelling test —
a guard no spelling rule can build.

That is self-contained, worth 542 words, and needs none of the rest of this
machinery. It is the piece to revisit first.

## What would have to change to revisit the whole idea

- A source with real coverage of the corpus's Wiktionary tail. MorphyNet is
  built over a fraction of it, and the gate is honest about that.
- The Wiktionary `form_of` harvest, which was still streaming when this was
  parked (500k of ~1.6M entries in, yielding 154,612 form rows and 75,147
  composition rows). It is the source most likely to move the derivational
  classes over the gate, and it is the one number this record is missing.
- The reverse direction, per above.

Measured 2026-09-22, uncorrected. Nothing in `src/` changed; no puzzle, score or
archived result is affected.
