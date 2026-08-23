# Prefix scoring folds

The companion to [`inflection-scoring-cases.md`](inflection-scoring-cases.md).
That document covers the endings; this one covers the beginnings.

The problem is the same one, from the other side of the word. WordInk scores a
word by how rare it is, and a prefixed form is almost always *rarer* in the
corpus than the word it is built on — "outsmiling" is unattested where "smiling"
is Zipf 4.15 — so left alone it out-scores its own base. "outsmiling" pays a
**Legend (9.97)** for a word that is "smiling" with three letters on the front.

The fix is the fold the suffix rules already use: recognise the form as a
mechanical variant of a base word and **cap its score at the base's**. What is
specific to prefixes is which guards make that safe, and how a prefix hop
composes with the suffix hops in the same chain.

> **Status (2026-08-22): nothing here is implemented.** No prefix is stripped
> anywhere in [`stem.ts`](stem.ts) or [`dictionary.ts`](dictionary.ts). This
> document records the design, the measured audit behind it, and the rollout
> order. Part 1 is the mechanism and the per-prefix ship list; Part 2 is
> everything the mechanism does not cover. It supersedes §F of
> [`inflection-scoring-cases.md`](inflection-scoring-cases.md), whose stated
> reason for refusing prefixes does not survive the numbers (see
> [Why §F was wrong](#why-f-was-wrong)).

Source of truth once built:
- [`src/game/stem.ts`](stem.ts) — the prefix candidate generator.
- [`src/game/dictionary.ts`](dictionary.ts) — the guards and the fold chain.
- [`scripts/manage-extra-word.py`](../../scripts/manage-extra-word.py) — the
  Python mirror, kept in lockstep for the audit skills.

---

# Part 1 — Handled

## 1. Where the rule lives

Prefix stripping is one more candidate generator inside `nextBaseForms`
([`dictionary.ts`](dictionary.ts)), sitting in the existing
`zipfFor(word) < MEASURED_FLOOR` block alongside `unmeasuredBaseCandidates`. It
proposes `word` minus an allowlisted prefix; the caller's existing real-word and
most-common-base checks do the rest.

## 2. The four guards

A prefix hop fires only when all four hold.

| # | Guard | What it stops |
|---|-------|---------------|
| 1 | **Prefix allowlist** | The rule is enabled per prefix, never as a class. Prefix families differ enormously in how much bound Latinate material they sit on (§5). |
| 2 | **Base is a real word, ≥4 letters** | `uncle→cle`, `unit→it`, `under→der`, `output→put`, `outer→er` fail the length test; `reason→ason`, `region→gion`, `district→trict`, `subject→ject`, `universe→iverse` fail the real-word test. |
| 3 | **MEASURED_FLOOR gate** (word's own Zipf < 1.0) | Every ordinary word that merely *starts* with a prefix string. `outrage` (3.84), `mistake` (4.67), `discover` (4.39), `display` (4.63), `depart` (3.67), `underlying` (4.17), `dependant` (2.94) all carry real measurements and never generate a candidate. |
| 4 | **Lemma-and-ancestry check** (§3) | The two ways an inflected form launders its way past a base that is itself protected. |

Guard 3 carries most of the load and is the direct answer to "how do legit words
avoid being unfairly treated": a word people actually use has a real measurement,
and a guess from a word-initial string must not overrule it. This is the same
line that lets "specialest" fold to "special" while "tempest" keeps its own score.

Note what guards 2 and 3 do to the scary examples §F of the suffix document
listed. They were never the problem. Nor are `record→cord`, `report→port`,
`release→lease`, `research→search`, `missile→sile`, `design→sign`: the fold only
ever **caps**, and in each of those the stripped remainder is *rarer* than the
word, so the cap does not bind and the hop is inert.

## 3. Guard 4 — the composition guard

This is the guard prefixes need that suffixes do not, and the audit found it the
hard way. Two distinct leaks, both caused by an **inflected** form having a route
the lemma is denied:

**Leak A — a measured prefixed word gets walked past.** `outback` is measured
(3.21), so guard 3 protects it. But `outbacks` is below the floor, so the naive
rule fires on the plural and strips straight to `backs`:

| word | today | naive rule | correct |
|------|-------|-----------|---------|
| `outbacks` | 6.65 | → `back`, **2.49** | 6.65 — `outback` is a real word |
| `outplacements` | 8.71 | → `placement`, **5.43** | 8.71 — outplacement is an HR term |
| `outrightnesses` | 5.74 | → `right`, **2.60** | 5.74 — "outright" is not "right" |
| `unfriendliest` | 6.81 | → `friend`, **3.47** | 6.81 — `unfriendly` is an ordinary word |

**Leak B — inflection pushes a base over the length threshold.** `dewan` (a South
Asian minister) is safe because `de` + `wan` leaves 3 letters. Its plural is not:
`dewans` → `de` + `wans` clears the ≥4 test, and `wans` → `wan` finishes the job.
Same shape for `deisms → isms → ism` and `debyes → byes → bye`.

Both leaks close with two conditions:

- **Ancestry.** A word may not take a prefix hop if it descends from a *measured*
  prefixed word. Computed recursively over the same one-hop candidate set and
  memoised — recursion is required, not one-hop: `outrightnesses` →
  `outrightness` → `outright`, and only the third link is measured.
  *Rationale: a prefixed word with a real measurement is a legitimate word in its
  own right, and terminates the chain.*
- **Lemma-only.** A prefix hop is offered only at a word with no inflectional or
  tense base in the dictionary. Inflected forms still reach the base — through
  the lemma, one hop later (`retags` → `retag` → `tag`).
  *Rationale: you strip a prefix off a word, not off a plural.*

Measured effect of lemma-only alone, holding everything else fixed — ten of
thirteen known junk folds die, no good fold lost:

```
dewans     wan  -> dewan      deisms     ism  -> deism     debyes  bye -> debye
subgums    gum  -> subgum     reatas     atas -> reata     unreeves reef -> reeve
displumed  plum -> plume      overladed  lad  -> lade      prepubes pub -> pubis
preyers    yer  -> preyer
outsmiling smile (kept)       retags     tag (kept)        deplatform platform (kept)
```

## 4. Composition with the suffix rules

**Nothing extra is needed.** `chainedBase` is already a breadth-first walk that
takes the most common word reachable, so a prefix hop is just another edge and
prefix+suffix compose for free:

```
outsmiling → smiling → smile     caps at 4.55
unfriendliest → unfriendly       caps at 6.81 (guard 4 stops it at the measured prefixed word)
retags → retag → tag             caps at 4.84
```

The one thing that looks like over-travel is not. `outsmiling` capping at `smile`
rather than `smiling` is correct because **`smiling` itself already displays
4.55** — the invariant the chain enforces is "no rarer than the score its base
actually displays," and honouring it end-to-end is the whole point of walking the
chain rather than taking one hop.

Guard 3 is evaluated per node, at the word being stripped, which gives the
composition the right asymmetry: a prefixed word below the floor may hop to a
measured base, and from that measured base the *unmeasured* suffix families are
correctly refused.

## 5. Ship list

Nothing enabled yet. Ordered by measured junk rate; the fold count is words whose
displayed score changes with that prefix alone enabled under all four guards.

### Tier 1 — clean, ship first (2,251 folds)

Manual review of every short-base lemma turned up no more than one bad fold each.

| Prefix | Folds | Known bad folds |
|--------|-------|-----------------|
| `over-` | 669 | — (`oversuds→sud`, `overlept→lept` are junk *dictionary entries*, not bad folds) |
| `out-` | 490 | `outsight` (coined as the antonym of insight) |
| `mis-` | 405 | — |
| `non-` | 345 | `nonnews→new` lands a hop long, via the pre-existing `news→new` strip |
| `dis-` | 143 | `disowner` |
| `counter-` | 122 | — |
| `under-` | 77 | — |

### Tier 2 — ship with a short exemption list (1,411 folds)

| Prefix | Folds | Exemptions needed |
|--------|-------|-------------------|
| `re-` | 884 | `recheat` (a hunting horn call) |
| `un-` | 430 | `ungular` (of hooves, from *ungula*), `unbasted` |
| `inter-` | 97 | `interreges` (plural of *interrex*), `intervolve` |

### Tier 3 — needs a careful pass first (1,130 folds)

These sit on borrowed Latinate and French vocabulary, where the string is a
coincidence often enough to matter. Junk rate roughly 1.5–3%.

| Prefix | Folds | Sample of what needs exempting |
|--------|-------|-------------------------------|
| `pre-` | 396 | `prelect`, `premune`, `premorse`, `prepone`, `previsor`, `precava` |
| `de-` | 389 | `decaff`, `degust`, `demoded` (*démodé*), `dewily` (dewy+ly), `debusses` |
| `anti-` | 199 | `antilogy`, `antimere`, `antinome`, `antitypic` |
| `sub-` | 146 | `subduce`, `subdure`, `suberose`, `subsere`, `subvent` |

**Total across all fourteen: 4,792 words, 2.1% of the dictionary**, of which
roughly 4,200 stop being Legends. That is much larger than any single suffix fold
shipped so far, which is the argument for the tiers: one prefix at a time, with a
drop-distribution check between each.

---

# Part 2 — Not handled

## 6. Prefixes measured but not proposed (1,520 folds)

Audited under the same four guards, not in any tier yet. Nothing is wrong with
most of them; they are simply behind the first fourteen in the queue.

| Prefix | Folds | Note |
|--------|-------|------|
| `in-` | 240 | The negative `in-`. Clean under the guards (`inclasp`, `inweave`, `intomb`) — most true members (`inaccurate`, `incomplete`) are measured and correctly refused |
| `super-` | 232 | Clean |
| `co-` | 156 | **Risky**: `cowitch`, `cowage` (plants), `cosher`, `coyest` (coy+est), `copalm` |
| `en-` | 148 | Mostly clean; `entomo`, `entopic` need exempting |
| `ultra-` | 90 | Clean |
| `be-` | 73 | Mostly clean; `bemata`, `bezazz` |
| `im-` | 70 | Clean (`imbosom`, `impearl`, `imbrute`) |
| `hyper-` | 68 | Clean |
| `micro-` | 62 | Clean |
| `post-` | 60 | Clean |
| `semi-` | 56 | Clean |
| `fore-` | 43 | Clean |
| `mono-` | 43 | Clean |
| `poly-` | 31 | Clean |
| `multi-` `mega-` `pseudo-` `trans-` `up-` `mini-` `down-` `ir-` `cross-` `self-` `mid-` `il-` `off-` `half-` `extra-` `intra-` | 1–19 each | Long tail. `down-` needs `downless` (that is the `-less` suffix, not a prefix) |

## 7. Prefixes that cannot be handled by a spelling rule

The bound classical prefixes. These are not removable morphemes in modern
English — the remainder is a bound root, not a word — so the real-word check
kills nearly every match and the survivors are all coincidences.

`ad-`, `ab-`, `ob-`, `con-`/`com-`, `per-`, `pro-`, `ex-`, `se-`, `sur-`,
`contra-`, `circum-`, `retro-`

`convert`, `admit`, `obtain`, `persist`, `produce` do not decompose into
dictionary words at all. Where one accidentally does — `convent` → `vent`,
`process` → `cess`, `prospect` → `spect` — it is pure coincidence, and guard 3
already protects every such word because they are all measured well above the
floor. There is nothing here to fix and no rule that could fix it.

## 8. Prefixed words that must never fold, whatever the prefix

Three kinds, all handled by [`fold-exemptions.json`](../data/fold-exemptions.json)
rather than by a rule. Because guard 4's ancestry check propagates, an exemption
on the lemma covers the whole paradigm — exempt `outsight`, and `outsights` is
covered too.

**Lexicalized — the prefix is historically real but the meaning has drifted
past its base.** `outright`, `outback`, `outplacement`, `outsight`, `outlaw`,
`outfit`, `outlet`, `understand`, `overtake`. Guard 3 catches nearly all of these
for free, since a word whose meaning has drifted far enough to notice is a word
people use often enough to measure.

**False friends — the prefix was never there.** `outrage` (Old French *outre*),
`dewan`, `demode`, `debye`, `reata`, `recheat`, `ungular`, `interrex`,
`suberose`, `cowitch`. Guards 2–4 catch most; the residue is the Tier 2/3
exemption lists in §5.

**Genuine new coinages the corpus has not caught up with.** `deplatform` scores a
perfect 10.00 today and is unmeasured, but it is a real recent word, not a
mechanical form — the `enshittification` case from the unscored-legends audit.
A mechanical rule demotes it to `platform` (4.50). This is the one category where
the *fold* is the error and the Legend is correct, and it is the reason a prefix
rollout needs the same human audit pass the suffix folds got.

## 9. What this does not attempt

- **Prefix + prefix.** `unreconstructed`, `nondisclosure`. The chain would handle
  it mechanically (each hop independent), but it is untested and outside the
  audit above.
- **Prefixes on non-words.** No fold gives a word a base that is not itself in
  the dictionary; that is guard 2 and it is not negotiable.
- **Hyphenated forms.** Out of scope — the dictionary has no hyphens.
- **Restoring a score.** Every prefix fold is a **cap**. It can only ever make a
  word score more common, never rarer. A word whose stripped remainder is rarer
  than itself is inert, not harmed.

---

## Why §F was wrong

§F of [`inflection-scoring-cases.md`](inflection-scoring-cases.md) refuses
prefixes on the grounds that "the MEASURED_FLOOR gate can't help because many
false-positive bases ('cle', 'sile', 'der') are *rare*, so they slip under the
floor with the words that should genuinely fold."

The examples it reasons from are not false positives at all. `cle` and `der` are
under four letters; `sile` is inert because "missile" (4.14) is far more common
than "sile" (1.91) and the fold only caps. Strip those away and the real false
positives are a different set — `mistake→take`, `display→play`, `discover→cover`,
`delight→light`, `depart→part`, `underlying→lying`, `dependant→pendant` — and
every one is measured at **Zipf ≥ 2.9**.

That is exactly the shape the gate is for, and it matches the standing note that
the gate works when a rule's false positives are the common words. §F reached the
right answer at the time (don't ship it unaudited) from an argument that does not
hold.
