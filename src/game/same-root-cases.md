# Same-root duplicate detection — cases, gaps, and open items

A WordInk puzzle refuses a word that shares a root with one already found, so a
player can't bank `indicate`, `indicates`, `indicated` and `indicating` as four
separate finds. Every submission is reduced to a **same-root key** and compared
against the keys of the words already accepted; two words with the same key are
the same find.

This is deliberately _not_ the same machinery as rarity scoring, even though both
ask "what is this word's base". Scoring's mistakes are invisible and small — a
coincidence like `caves` → `cafe` sits 0.11 Zipf from the truth and moves a score
by a sixth of a point. A key's mistakes are absolute: **a wrong key refuses a
legitimate answer.** Where the two systems have to choose differently, that
asymmetry is the reason.

Source of truth:

- [`src/game/submit.ts`](submit.ts) — `rootKey`/`foldOnce`, the tiers, and the walk.
- [`src/game/stem.ts`](stem.ts) — the candidate generators, split into decisive and stem-changing halves.
- [`src/data/same-root-pins.json`](../data/same-root-pins.json) — the reviewed keys.
- [`src/game/same-root.test.ts`](same-root.test.ts) — the families, the guarantees, and the corpus tripwires.
- [`inflection-scoring-cases.md`](inflection-scoring-cases.md) — the scoring sibling. Read it for what the shared spelling rules do.

Active from the **2026-08-24** puzzle, gated on the puzzle date so archive play
keeps the rules a drop was played with (`sameRootInflectionsActive`). From the
**2026-09-10** puzzle the readings English does not spell are dropped before tier
1 is ranked, on its own gate (`sameRootDoublingActive`) — see the false-refusal
section below.

---

## How a key is chosen

1. **A reviewed pin**, if the word has one.
2. **Tier 1 — every decisive reading at once, ranked by frequency.** `baseForm`'s
   own answer, both `-es` strips, the `-ies` rewrite, and the silent `e` an
   `-ed`/`-ing` strip swallowed. These all point at _the base of this word_, so
   the loser is a lookalike of the winner (`save` vs `sav`, `play` vs `playe`,
   `bath` vs `bathe`). Impossible readings are dropped first, not ranked — see
   `impossibleNumberBase` for `-ees`, and `refusedTenseStem`/`refusedEsStem` for
   the doubling stems and the `-es` strips English writes as `-s` (2026-09-10 on).
3. **Tier 2 — the stem-changing plurals**, only if tier 1 found nothing
   (`aardwolves` → `aardwolf`). Walling this tier off is what keeps `caves` from
   ever offering `cafe` and `saves` from ever offering `safe`.
4. **The fragment** `baseForm` produced, if both tiers came up empty. Then it is
   the only thing the paradigm shares: the dictionary has no `bitch`, so
   `bitched` and `bitching` meet there or not at all.

Then the key **walks to a fixed point** (`womens` → `women` → `woman`), and the
bound derivational suffixes fold on top (`organization` → `organize`).

Candidates are checked against **dictionary membership, not playability**. A
reviewed rejection makes a word unsubmittable, not unreal, and it is still the
right bucket for its own paradigm. This matters more since #199 rejected every
curated word carrying a rejection reason: `bitch` is not in the dictionary at all,
so `bitched`/`bitching` need the fragment fallback, while `playe` _is_ in the
dictionary but unplayable, and it still has to compete for `played`'s key -- if it
did not, the restored `e` would win and `play`/`played` would come apart.

---

## Known false refusals

The only class that matters. Anything here refuses a word a player is entitled
to, and should be fixed before anything below it.

**None known.** Two classes have been found and fixed, both the same bug: a
reading English does not spell was ranked against the real one, and frequency
preferred it because a short consonant stem is nearly always the commoner word.

1. `-ees`, found during development: `devotees` → `devote`, `advisees` →
   `advise`, `bargees` → `barge`, refusing the plural to anyone who had found the
   verb. English adds `-s`, never `-es`, to a word already ending in `e`
   (`impossibleNumberBase`).
2. The general case, **fixed 2026-09-10** (`refusedTenseStem`, `refusedEsStem`,
   gated by `sameRootDoublingActive`). Two endings, one claim:
   - A stem whose own forms **double** their final consonant never took `-ed` or
     `-ing` bare: `wan` conjugates as `wanning`, so `waning` → `wan` refused
     `waning` to a player who had found `wan`. Also `biting` → `bit`, `caring` →
     `car`, `themed` → `them`.
   - A stem that would have taken **`-s`** never took `-es`: `ban` writes `bans`,
     so `banes` → `ban` is not a reading. Also `stares` → `star`, `manes` →
     `man`, `flues` → `flu`, `aides` → `aid`.
   Both are refused only where the silent-`e` reading is itself a dictionary
   word, so a spelling with no rival reading keeps the base it has (`busing` →
   `bus`, `chating` → `chat`). 717 words were keyed on a spelling English does
   not produce; none is now. Doing both endings at once is load-bearing: fixing
   only the tense reading moves `baned` to `bane` while `banes` stays on `ban`,
   which takes a paradigm apart.

   One wrong pairing came with it and is pinned instead: `during` is the
   preposition, not a tense of `dure`.

**How to look for more.** The shape is a tier-1 candidate that is a _different
lemma_ rather than a lookalike. The two families above were the mechanical ones;
what is left is where the spelling genuinely allows both readings and only
knowledge of the word separates them — `bathes`/`bathing` really could be `bath`
or `bathe`, and frequency picks `bath`. To audit, list the words whose key is the
two-letter `-es` strip or a bare tense stem while the `-e` spelling is also a
dictionary word, and read down by frequency gap; after 2026-09-10 every one of
those left is a stem the ending _could_ have been added to.

---

## Known leaks

A leak lets a word through that arguably should be refused. Where the design had
to choose, it chose to leak, so these are expected rather than broken. Roughly in
order of how likely a player is to hit one.

| #   | Leak                                                                                                                                                                                                   | Count                    | Example                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | An `e`-final word stays playable beside its own paradigm, because the paradigm keys on the consonant stem that frequency prefers                                                                       | 850, less the 756 pairs 2026-09-10 collapsed | What is left is where the bare stem is a spelling the ending really could have been added to: `bathe` + `bathing`/`bathes`, both still on `bath`; `abase` + `abases`, on the sibilant stem `abas` |
| 1b  | The other side of that repair: a paradigm can still split where only _one_ of its endings has an impossible reading, so the form that can move does and the rest stay behind                            | inside the 2,254 splits  | `antes` (→ `ante`) + `anted` (→ `ant`, a spelling `ant` really could take); `stampedes` + `stampeding`                  |
| 2   | Irregular plurals whose `-ve`/`-ce` variant spelling is itself curated, so tier 1 settles on the variant and tier 2 is never reached. The plurals a player meets are pinned; the technical tail is not | ~370, 17 pinned          | pinned: `wolves`, `knives`, `indices`, `crises`. Unpinned: `dialyses`/`dialysis`, `fibroses`/`fibrosis`, `plasmolyses` |
| 3   | A curated truncation keeps its own key while its paradigm moves to the full spelling                                                                                                                   | part of the 2,501 splits | `ach` + `ached`; `advocat` + `advocated`                                                                               |
| 4   | Same-root pairs with no dictionary word between them, keying on themselves                                                                                                                             | small                    | `broadleaved` + `broadleaves`; `hooved` + `hooves`                                                                     |
| 5   | Scoring families duplicate detection does not read at all (see below)                                                                                                                                  | —                        | `bureau` + `bureaux`; `physiology` + `physiologist`                                                                    |

Leak 1 was the one to revisit first, and 2026-09-10 is that revisit — done the
narrow way, because the broad way had already been tried and was worse:
preferring the `e`-spelling outright split `bathes` from `bathing` and 3,000 more
pairs, since the two forms then answered the ending differently. Refusing only
the readings English does not spell leaves both of those on `bath` and moves the
756 pairs where the bare stem was never a reading at all. Leak 1b is what that
costs, and it is a leak rather than a refusal.

---

## Families deliberately not used

| Family                                       | Where it lives                                             | Why identity stays out                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-er`/`-est`, `-ize`/`-ise`, `-able`/`-ible` | `unmeasuredBaseCandidates`                                 | Only sound behind the `MEASURED_FLOOR` frequency gate, which identity cannot inherit — both words in a played pair are ordinary measured words. Ungated these fold `canter` → `cant`, `tempest` → `temp`, `likeable` → `like`, `capsize` → `cap`. **Keep out permanently.** |
| `-ness`, `-ly`                               | `scoringBaseForm`                                          | Same reason.                                                                                                                                                                                                                                                                |
| `-ically`, `-ably`, `-ologist`, `-eaux`      | `derivedBaseCandidates` (added for scoring in #197)        | Never evaluated for identity. `bureau`/`bureaux` and `physiology`/`physiologist` are still two finds each. Worth a decision per family, not a blanket import.                                                                                                               |
| Latin plurals (`-a`/`-i`/`-ae`)              | `inflectionalBaseCandidates`, behind `latinPluralsAllowed` | Left for a later pass. `abacus`/`abaci` is still two finds.                                                                                                                                                                                                                 |
| `-ier`/`-iest`                               | `degreeBaseCandidates`                                     | Left for a later pass; its paired-degree check is real, so this is the most defensible next addition. `happy`/`happier` is still two finds.                                                                                                                                 |

---

## Maintenance

**After a frequency-data refresh** (`refresh-rarity`), tier 1's ranking can flip
where the top two candidates are close. 213 words sit within 0.15 Zipf of their
runner-up (`adzes`: `adze` 1.78 / `adz` 1.72; `appalled`: `appal` 1.63 / `appall`
1.51). A flip there only moves a pair between _merged_ and _playable_ — both
candidates are lookalikes of the same word — so it needs no action, but it does
mean the corpus counts in `same-root.test.ts` are thresholds rather than exact
numbers.

**When adding dictionary words:**

- A new word ending in `-men` gets read as a `-man` plural if no other rule
  matches it. That is right for compounds (`crewmen`, `salesmen` — ~460 of them)
  and wrong for anything that merely ends that way; `germen`, `dolmen`, `limen`,
  `somen` and `nomen` are pinned for exactly this. Check any short new `-men`
  word.
- A new truncated variant (`advocat`, `ach`) becomes a curated word that can
  shadow a real base in tier 1. Harmless as a leak, but see the false-refusal
  audit above if the variant is a different lemma.

**When changing the shared spelling rules:** `inflectionalBaseCandidates` must
stay the exact union of `decisiveNumberCandidates` and
`stemChangingNumberCandidates` (pinned by a dictionary-wide test), or scoring
silently changes. `restoredTenseCandidates` covers the same ground as
`tenseBaseForm` for the tense endings and is _not_ generated from it — if
scoring's tense rules move, check this one by hand.

**The two refusals are not symmetric across the two systems.**
`refusedTenseStem` is read by both — the fold from 2026-09-10 (see
DOUBLING_TENSE_START) and identity from the same date — so a change to it moves
scores as well as keys. `refusedEsStem` is identity-only: scoring reaches the
nine worst `-es` folds through reviewed fold exemptions (`bares` → `bar`,
`stares` → `star` and seven more) and retiring those in favour of the rule is a
separate cutover with its own review. Until then the two systems disagree about
`banes`, which is allowed (see the note on `score-overrides.json` below) but is
worth knowing when reading a fold explanation beside a same-root verdict.

**The pins file is not mirrored** in `scripts/manage-extra-word.py`. That mirror
exists for the _scoring_ folds only; the audit skills never ask about identity.

**`score-overrides.json` is not an identity source, and the two files disagree on
purpose.** The override caps what `theses` is _worth_ (at `these`, to deny it an
unearned Legend); the pin keeps `theses` and `these` apart so a player who found
one may still play the other. Reading the overrides as identities would turn
every reviewed demotion into a refusal.

**Coupled behaviour:** `spellingNearMiss` shares `rootKey`, so widening the key
also shrinks the "check your spelling" nudges slightly — a near miss pointing at
an already-taken root is suppressed.
