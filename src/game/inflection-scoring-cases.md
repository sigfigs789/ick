# Inflection & derivation scoring folds

WordInk scores a word by how rare it is: rarer word, higher score. A problem
falls out of that directly — an inflected or derived form is almost always
*rarer* in the corpus than the plain word it comes from ("angrier" is measured
rarer than "angry", "asphyxiates" rarer than "asphyxiate"), so left alone it
would out-score its own base. To stop that, the engine tries to recognise a form
as a mechanical variant of a base word and **caps its score at the base's**
("no rarer than the word it came from").

From 2026-08-24 the same cap also runs the **other way**: a word is capped at the
regular inflections built *on* it, because for a whole class of English verbs the
lemma is the rare form and the participle is the one anyone writes (§0). Both
directions are caps, never inheritances, so they compose without fighting — the
engine takes the most common word it can reach in either direction.

Each case below is a family of spelling rules. A rule proposes candidate base
spellings; the engine keeps only the candidates that are real dictionary words,
and (under the chained system) folds onto the **most common word reachable**,
never lowering a score. "False positives" here means words that *look* like the
family but aren't — where the spelling rule would fold onto the wrong base if
nothing guarded it. Each family names the guard that neutralises them.

Source of truth:
- [`src/game/stem.ts`](stem.ts) — the spelling-rule candidate generators.
- [`src/game/dictionary.ts`](dictionary.ts) — the fold chain, the gates, and tense forms.
- [`scripts/manage-extra-word.py`](../../scripts/manage-extra-word.py) — a Python mirror of the same rules, kept in lockstep for the audit skills.

Two global guards apply throughout:
- **MEASURED_FLOOR (Zipf 1.0).** Below it a word's "score" is a stand-in, not a
  real measurement, so a guessed base is *better* information than what the word
  would otherwise get. At or above it there's a real measurement a spelling
  guess must not overrule. Some families run everywhere; the riskier ones are
  gated to below the floor.
- **Real-word + most-common check.** A candidate must be in the dictionary, and
  the fold always picks the most common valid candidate, so a rare homograph
  can't hijack it.

---

## 0. The other direction — a word capped at its own inflections

`inflectedFormFolds` in [`dictionary.ts`](dictionary.ts), spellings from
`inflectedFormCandidates` in [`stem.ts`](stem.ts). Runs everywhere (not gated).
Every other family on this page reads a word as a form of something else; this
one reads the forms built on a word and caps the word at the most common of them.

The reason it exists: English has a large class of verbs whose bare lemma nobody
writes. "Belove" is measured at Zipf 1.10 and "beloved" at 4.17; "infatuate" at
1.30 and "infatuated" at 2.90. The measurement is not wrong — the finite verb
really is that rare — but scoring the *word* off it sold the rarest inflection of
a familiar word as a deep-tail find. 1,958 words displayed Mythic or better and
are capped by their own `-ed`/`-ing` form once this runs, which is what players
reported about "infatuate" (Mythic 9.46) against "infatuated" (Rare 7.11).

| Shape | Examples (score before → after) |
|-------|--------------------------------|
| Participle-dominant verbs | disgruntle 9.91 → 6.80, belove 9.75 → 5.24, unbridle 9.83 → 7.16, overjoy 9.87 → 7.00, enamor 9.78 → 7.28, antiquate 9.72 → 6.87, untap 9.65 → 7.05 |
| Gerund-dominant verbs | outstand 9.65 → 4.75, excruciate 9.75 → 6.87, matchmake 9.64 → 6.47, infight 9.92 → 7.11 |
| Nouns used in the plural | measle 9.78 → 6.47, shenanigan 9.12 → 6.65, battlement 8.77 → 7.63, whereabout 9.22 → 6.16, outskirt 9.00 → 6.13, sweatpant 9.80 → 7.22 |
| Back-formed singulars in the word list | perhap 9.61 → 3.88, thi 6.72 → 1.34, alway 7.56 → 2.90, nowaday 9.27 → 5.33, metropoli 9.78 → 6.12 (junk entries the cap flattens for free, where the round trip below does not reject them first) |

**Two guards, and neither of them is frequency.** The measured-floor gate is no
help here: the false positives *are* the common words, and capping a measured
lemma at a commoner form is the whole point, so a gate would leave every word
that prompted the change exactly where it was.

1. **Round trip.** `inflectedFormCandidates` over-generates spellings ("-e"
   dropped or kept, consonant doubled or not), and a candidate counts only if the
   forward rules run on *it* **choose** this word back — not merely offer it
   among their candidates. That is the difference on the coincidences, because
   the forward rules propose everything plausible and then narrow: "wives"
   proposes "wife", "wif", "wiv" and "wive", and "wife" wins, so the archaic verb
   "wive" never links. "singe" reaches both "singes" and "singing" by spelling
   and loses both picks to "sing".
2. **Terminal hops.** The chain caps against a form but never walks on from it.
   Left free to continue, one reverse hop plus one forward hop composes into a
   link between two paradigms: "singe" legitimately reaches its own "singes"
   (the `-es` strip reads either "singe" or "sing"), and carrying on from there
   lands on "sing" — a rare verb scored as an everyday one. "thee" reached "the"
   the same way. A cap only ever needed the form's own frequency, so refusing to
   expand costs nothing.

**False positives that survive both guards** are words whose "inflection" is a
different word that merely spells the part, and every one of them is a *forward*
misread that was already in the rules and simply inert while folds ran one way.
Nine were reviewed for the cutover and exempted: `doe` ("does" is the auxiliary —
and `do` is two letters, which the number rules drop, leaving "doe" as the only
candidate), `morn`/morning, `blee`/bleed, `specie`/species, `genu`/genus,
`politic`/politics, `physic`/physics, `tetri`/tetris, `sacre`/sacred.

**What it deliberately does not do:** derivations. "-ion" is a different word,
not an inflection ("infatuation", "valuation"), so it stays in §E — which leaves
`-ion`-dominant lemmas in the top band: dissertate 9.92, imaginate 9.66 and
fragmentate 9.92 still score off a lemma nobody writes, against dissertation
5.93, imagination 5.16 and fragmentation 6.62. That is the same family the
`-ation` row of §E refuses in the other direction, and for the same reason: the
spelling is not decisive.

---

## 1. Past / progressive tense — `-ed`, `-ing`

`tenseBaseForm` in [`dictionary.ts`](dictionary.ts). Runs everywhere (not gated).

| Rule | Converts |
|------|----------|
| `-ied` → `-y` | tried → try, cried → cry, dried → dry |
| `-ed` → `-e` / bare / de-doubled | rated → rate, played → play, batted → bat |
| `-ying` → `-y` / `-ie` | trying → try, dying → die |
| `-ing` → `-e` / bare / de-doubled | making → make, running → run |

**False positives (neutralised by the most-common-base check):**
- "played" could strip to the obscure "playe"; the common "play" wins.
- "rated" could strip to "rat"; "rate" (far more common) wins.
- "-ed" that isn't a tense: "beloved" would fold onto "belove". Under the old
  *inherit* system this made it a Mythic; the chained system only ever **caps**,
  so a rarer base can never drag a word down — the fold is inert here. Inert in
  this direction, that is: the pair is real and it is "belove" that needed
  capping, which is what §0 does.

---

## 2. Number inflection — plurals & third-person `-s`

`inflectionalBaseCandidates` in [`stem.ts`](stem.ts). Runs everywhere. Deliberately
separate from tense so `-es` can strip just the `s` (the single biggest hole,
~6,900 words: "asphyxiates" → "asphyxiate", which the naive both-letters strip
turned into the non-word "asphyxiat").

| Rule | Converts |
|------|----------|
| `-ices` → `-ex` / `-ix` | matrices → matrix, vortices → vortex |
| `-ies` → `-y` / `-i` | cries → cry, taxies → taxi |
| `-ves` → `-f` / `-fe` | wolves → wolf, knives → knife |
| `-men` → `-man` | crewmen → crewman, chairmen → chairman |
| `-es` → `-e` / bare / `-is` | asphyxiates → asphyxiate, crises → crisis, analyses → analysis, oases → oasis |
| `-s` → bare (not `-ss`) | cats → cat |

**False positives:**
- Near-tie coincidences: "caves" offers both "cave" (4.20) and "cafe" (4.09);
  "saves" offers "save" (5.14) and "safe" (5.07). The right base wins, but by a
  hair — the safety is that a near-tie carries near-identical frequency, so
  picking wrong barely moves the score. Damage only happens when a coincidence
  is *far* more common than the true base.
- `-es` → `-is` coincidences: "theses" → "these" (much commoner than "thesis").
  Caught by a reviewed **override** pinning "theses" → "thesis". Milder ones
  ("neurites" → "neuritis", "metropoles" → "metropolis") land on a near-frequency
  sibling and stay harmless.
- Two-letter bases are dropped (candidates must be ≥3 letters): a two-letter
  entry carries inflated corpus frequency and would flatten anything folding onto it.

---

## 3. Latin / classical plurals — `-ae`, `-i`, `-a`

Also in `inflectionalBaseCandidates`, but **gated by `latinPluralsAllowed`**
(`!WORD_INDEX.has(word + "s")`) — only for a word that doesn't take an ordinary
English plural of its own. A word with its own `-s` plural is being used as an
English singular ("alba"/"albas", "taxi"/"taxis"), so it doesn't fold. Note `-a`
→ `-um` folds even above the floor because this English-plural guard alone is
enough ("addenda", "maxima" are all measured and still fold).

| Rule | Converts |
|------|----------|
| `-ae` → `-a` | scapulae → scapula, formulae → formula |
| `-i` → `-us` | radii → radius, abaci → abacus |
| `-a` → `-um` | aquaria → aquarium, addenda → addendum, maxima → maximum |

**False positives (why the `latinPluralsAllowed` guard exists):** nothing in the
letters separates "podia" from "alba", or "taxi" from "abaci". The matching
`-a` → `-on` plural is **deliberately absent** because it folds "comma" →
"common", "silica" → "silicon", "squadra" → "squadron" (~19 wrong in 280).

---

## 4. Comparative / superlative — `-ier`, `-iest`

`degreeBaseCandidates` in [`stem.ts`](stem.ts). Runs **above** the floor — that's
the point, since every measured comparative was scoring rarer than its adjective
("angrier" 7.33 vs "angry" 4.52, "earliest" 5.35 vs "early" 3.38).

| Rule | Converts |
|------|----------|
| `-iest` → `-y` (needs `-ier` to also exist) | happiest → happy, prettiest → pretty |
| `-ier` → `-y` (needs `-iest` to also exist) | angrier → angry, earlier → early |

**Guard = the counterpart degree.** The fold only fires if the *other* degree is
also a real word, proving the base is a gradable adjective.

**False positives (blocked by the counterpart check):** agent nouns that merely
end `-ier` — "copier" (no "copiest"), "carrier", "collier", "crier" — keep their
own measured score.

---

## 5. Transparent derivational suffixes — `-ness`, `-ly`

`scoringBaseForm` in [`dictionary.ts`](dictionary.ts). Capped at the base. Handles
the frequent under-counting of familiar derived forms.

| Rule | Converts |
|------|----------|
| `-ness` → stem (or `-iness` → `-y`) | happiness → happy, kindness → kind |
| `-ly` → stem (or `-ily` → `-y`) | alertly → alert, happily → happy |

**False positives:** kept in check by the real-word requirement — a stem that
isn't a dictionary word is discarded rather than folded.

---

## 6. Bound derivational suffixes — `-ization`, `-ability`

`boundBaseCandidates` in [`stem.ts`](stem.ts), applied in `scoringBaseForm`. Gated
to the wide-band era (`boundBaseForms`). These suffixes have an **unambiguous**
base. Capped at the base ("aggrandization" scores as "aggrandize", never rarer).

| Rule | Converts |
|------|----------|
| `-ization` → `-ize` | organization → organize |
| `-isation` → `-ise` | winterisation → winterise |
| `-ability` → `-able` | readability → readable |
| `-ibility` → `-ible` | flexibility → flexible |

**False positives (why opaque suffixes are excluded):** `-ment` and `-ism` were
deliberately left out — they collapse onto unrelated real words ("battlement" →
"battle", "arrivism" → "arrive"), which a spelling-only rule can't distinguish
from a genuine derivation.

---

## 7. Unmeasured-only suffixes — `-er`/`-est`, `-ize`/`-ise`, `-able`/`-ible`

`unmeasuredBaseCandidates` in [`stem.ts`](stem.ts). **Gated below MEASURED_FLOOR**
— their spelling is *not* decisive, so they're only consulted when a word's own
score is a guess anyway. Candidate bases must be ≥4 letters (three-letter bases
are where the wrong-word folds cluster: "the", "not", "cant").

| Rule | Converts |
|------|----------|
| `-est` → stem / `+e` / de-doubled (or `-iest` → `-y`) | specialest → special |
| `-er` → stem / `+e` / de-doubled (or `-ier` → `-y`) | knowinger → knowing, thanker → thank, abandoner → abandon |
| `-ize` / `-ise` → stem / `+e` / `+y` | containerise → container, ghettoise → ghetto, tautologize → tautology |
| `-able` / `-ible` / `-ably` / `-ibly` → stem / `+e` / `+y` | interviewable → interview, requirable → require |

**False positives — the whole reason for the floor gate.** Applied to *every*
word these rules mis-fold. All of these are measured **at or above** the floor,
so the gate excludes them and they keep their real score:
- `-er`/`-est`: "tempest" (3.29) → "temp", "canter" (2.72) → "cant", "noter"
  (1.27) → "not", "shoulder" → "should", "comma" → "common".
- `-ize`/`-ise`: "capsize" → "cap", "downsize" → "downs", "expertise" → "expert".
- `-able`/`-ible`: "likeable" → "like", "countable" → "county", "fallible" → "fall".

Extra guards inside this family:
- `-ier`/`-iest` below the floor only offer the `-y` rewrite; the other i-stem
  candidates are dropped because a junk stem could chain somewhere real
  ("campier" reached "campus" through the non-word "campi", out-voting "campy").
- A *tensed* `-ize`/`-ise` form is excluded — it folds through its own verb (a
  candidate already, via the tense/number rules), so the gate is applied at the
  verb once per paradigm. This stops "womanizes" reaching "woman" through a strip
  its own measured verb is barred from, and stops the `-is` noun plurals being
  read as verb tenses ("whatsises" → "what", "appendicitises" → "what").

**Families deliberately kept out even under the gate:**
- `-en` verbs (harshen → harsh): right often enough to tempt, but fold loanwords
  onto lookalikes — "dudeen" → "dude", "shoneen" → "shone", "torten" → "tort".
- Five-letter `-ing`: every such word is measured above the floor anyway, so the
  gate leaves none to fold — which is also what keeps "thing" from scoring as "the".

---

## 8. Bound derivational suffixes, second set — `-ically`, `-ably`/`-ibly`, `-ologist`, `-eaux`

`derivedBaseCandidates` in [`stem.ts`](stem.ts). Runs **everywhere** (not gated),
for the same reason §6 does: the ending is *bound* — a string English only
produces by attaching that suffix — so there is nothing accidental for the rule
to catch. The `c` → `ck` orthography rides along in the same function.

| Rule | Converts |
|------|----------|
| `-ically` → `-ic` | catholically → catholic, arctically → arctic, musically → music |
| `-ably` → `-able`, `-ibly` → `-ible` | availably → available, susceptibly → susceptible |
| `-ologist` → `-ology` | mythologist → mythology, technologist → technology |
| `-cked` / `-cking` → `-c` | panicked → panic, trafficking → traffic |
| `-eaux` → `-eau` | bureaux → bureau, chateaux → chateau |

`-ically` is the family §5's `-ly` rule cannot reach: the `-ical` adjective it
strips back to usually isn't a word ("basical", "toxical"). `-ably`/`-ibly`
reaches the *adjective*, one step up from the bare stem §7 offers below the
floor, which is what a measured adverb needs.

**False positives:** none found. The look-alike cases are neutralised by the cap,
not by a gate — `physically` proposes the real word `physic`, and `critically`
proposes `critic`, but both bases are *rarer* than the adverb, so the fold is
inert and the adverb keeps its measured score. A wrong candidate only bites when
it is more common than the word, and no such coincidence exists in these
endings.

The `c` → `ck` rule offers **both** spellings, because a `-cked` word is as
likely built on a `-ck` verb as on a `-c` one: "chocked" is a tense of "chock",
"cricked" of "crick", "crocked" of "crock". Offering only the `-c` form would
hand those to "choc", "cric" and "croc"; offering both lets the most-common
check pick the real base.

The one case where the coincidence is commoner than the truth is
"specked"/"specking": "spec" (3.59) beats the real base "speck" (3.02), so those
two words score 0.84 low. Left alone deliberately. An override can't fix it —
`specked` already folds to `speck` through the plain `-ed` rule, so an entry
pinning it there moves no score and the override file's own invariant (every
entry must lower a score) rejects it. At 0.57 Zipf apart this is the harmless
near-tie shape §2 describes for "caves"/"cafe", not the "theses" → "these" shape
an override exists to catch.

**Deliberately excluded:** `-cker`. An agent noun is at least as likely built on
a `-ck` verb, and the same most-common check does *not* rescue it — "bloc"
(4.61) beats "block", so "blockers" folds to "bloc" whatever spellings are
offered. The price is that "panicker" keeps an unearned Elusive.

Each length bound is the shortest word its family actually has — "epically" and
"laically" at eight letters, "stably" and "viably" at six, "oologist" at eight,
"beaux" at five. A bound set one letter higher (the round numbers this started
with) silently drops those words from their own rule.

---

## Odd spellings at the inflection boundary

Yes — English rarely just glues a suffix on; it mutates the spelling where the
two meet, and the rules above account for the common mutations. This is *why*
every family offers several candidate spellings and then leans on the
most-common-base check: the engine doesn't know which spelling adjustment
applied, so it proposes all of them and lets the real, most-common word win.
These aren't separate cases so much as a mechanism running inside §1–§7.

| Spelling change | Example (word → base) | Where it lives |
|-----------------|----------------------|----------------|
| **Doubled consonant** dropped | running → run, batted → bat, hopped → hop, travelled → travel | `stripDoubledConsonant`, used by every tense/`-er`/`-est` rule (§1, §7) |
| **Silent `-e` restored** | making → make, rated → rate, bakes → bake | tense candidates add `stem + "e"`; `-es` strips only the `s` (§1, §2) |
| **`y` ↔ `i`** | cries → cry, tried → try, happily → happy, happiness → happy, angrier → angry | `-ies`/`-ied`/`-ily`/`-iness`/`-ier` rules across §1, §2, §4, §5 |
| **`f` ↔ `v`** | wolves → wolf, knives → knife | `-ves` → `-f`/`-fe` (§2) |
| **`y` → `ie` (progressive)** | dying → die, lying → lie | `-ying` → `-y`/`-ie` (§1) |
| **British ↔ American variant endings** | organisation → organise (as well as `-ize`), colourise → … | `-ise`/`-isation`/`-ibly` variants carried alongside `-ize`/`-ization` (§6, §7) |
| **Classical stem changes** | matrices → matrix, analyses → analysis, radii → radius, scapulae → scapula | §2, §3 |

Because the doubled-consonant strip runs on both spellings, the British `-ll-`
doubling ("travelled", "cancelled", "labelled") folds to the single-`l` base for
free — a nice side effect, not a special case.

### The odd spelling that used to be missing: `c` → `ck`

English inserts a `k` after a final `c` so it stays hard before `-ed`/`-ing`, and
`stripDoubledConsonant` leaves `ck` alone (it isn't a doubled consonant), so
"panicked" used to strip to the non-word "panick" and never fold. §8's
`-cked`/`-cking` → `-c` rule closes it: panicked → panic, trafficking →
traffic, mimicked → mimic. The `-cker` half (picnicker, mimicker) stays out —
see §8.

## Cases not yet addressed

The families above are the ones the engine handles. It handles a family only when
a spelling rule **plus an available guard** can hold the false positives to a
tolerable rate. Everything below fails one of those two tests, so it's left to
per-word overrides (or left alone). A family is unaddressed for one of three
reasons:

1. **No spelling rule exists** — the relation is irregular, so only a lookup
   table / override can catch it.
2. **The MEASURED_FLOOR gate can't save it** — the gate only rescues a family
   when its false-positive folds land on *common* words (which are above the
   floor and so excluded). When the pattern also matches *rare* real words, the
   gate lets those through. (See the `ick-fold-gate-at-measured-floor` note: the
   gate works when a rule's false positives are the common words — not otherwise.)
3. **The suffix is opaque or lexicalized** — the "base" is a bound morpheme, or
   the derived word has drifted in meaning, so a spelling strip lands on an
   unrelated word.

A false positive is only a *live* one when the wrong base is **more common** than
the word, because the fold caps and never inherits (see `chainedBase`). Many of
the misfires listed below are therefore inert — the rule proposes them and the
cap discards them — and the tables say which. A family is refused on the ones
that actually fire.

### A. Irregular inflections — no spelling rule possible (reason 1)

None of these can be reached by stripping letters; the rewrite is suppletive or
an internal vowel change. They'd need a curated map (today they rely on the score
being common enough not to matter, or on a one-off override).

| Family | Would fix | Why no rule |
|--------|-----------|-------------|
| Vowel-change plurals | geese → goose, feet → foot, mice → mouse, teeth → tooth, women → woman | no shared letters to strip |
| Native `-en` plurals | oxen → ox, children → child, brethren → brother | `-en` is excluded (see §7) — collides with sudden/kitchen/garden |
| Ablaut past tense | sang → sing, ran → run, smote → smite, wrought → work, shorn → shear | internal vowel change |
| Irregular participles | broken → break, cloven → cleave, hewn → hew, sawn → saw | `-en`/`-n` ambiguous & suppletive |
| Irregular degree | better/best → good, worse/worst → bad, more/most → many, less/least → little | fully suppletive |

**False positives if forced by spelling:** any letter-based attempt is worse than
the disease — a naive `-en` participle strip already fails on "dudeen" → "dude",
"shoneen" → "shone", "torten" → "tort" (the reason §7 excludes `-en`). These
belong in **overrides**, not rules.

### B. Regular inflections with real gaps in the current rules (reason 2, partly rescuable)

| Family | Would fix | False positives |
|--------|-----------|-----------------|
| Bare `-er`/`-est` **above** the floor | bigger → big, hotter → hot, cleverer → clever, narrower → narrow (measured comparatives that currently keep their own rarer score) | 542 words move, but §4's paired-degree trick does **not** transfer. It assumes an agent noun has no counterpart ("baker" has no "bakest"); this dictionary carries the archaic second-person verb forms — `thinkest`, `knowest`, `hearest`, `speakest` — so the check passes for verbs and folds "thinker" → "think" (6.38 → 2.43) and "knower" → "know". Plus "posttest" → "post", "recenter" → "recent", "tensest" → "tens". Tractable, but it needs a guard of its own, not §4's. |
| Greek neuter `-a` → `-on` | criteria → criterion, phenomena → phenomenon, automata → automaton | comma → common, silica → silicon, squadra → squadron (~19 wrong in 280 — the reason §3 omits it) |
| Stem-change `-ora`/`-era` → `-us` | corpora → corpus, genera → genus | moot: the rule changes **zero** words. "corpus" and "genus" are both more common than nothing the rule reaches, and every other match folds onto a rarer base, so the cap makes it inert. |

### C. Productive transparent derivational suffixes — moderate false positives (reason 3)

These are the closest cousins of the handled `-ness`/`-ly`. Their endings are
*not* bound — an ordinary word can end that way without being a derivation — so
unlike §8 they need a guard. What saves most of them anyway is the cap: a
coincidental base only bites when it is **more common** than the word, which is
rarer than the spelling suggests. The counts below are words whose score would
actually move, with the misfires that actually fire.

| Suffix | Would fix | False positives (folds onto unrelated real word) |
|--------|-----------|--------------------------------------------------|
| `-ful` / `-iful`→`-y` (297 words) | beautiful → beauty, careful → care, powerful → power, merciful → mercy | grateful → grate and awful → (aw) are both **inert** (base rarer, or too short). The measure nouns fold correctly (cupful → cup). Needs the bare stem only: adding a `stem + "e"` variant is what produces carful → care. A near-miss addition. |
| `-less` (746 words, 317 of them 9.5+) | helpless → help, hopeless → hope, worthless → worth | reckless → reck and regardless → regard are **inert**. Only listless → list is plainly wrong; restless → rest and priceless → price are morphologically real and semantically drifted. One exemption away from viable. |
| `-hood` (59 words) | childhood → child, brotherhood → brother, falsehood → false | monkshood → monks and underhood → under; likelihood/livelihood are inert (no stem). Two exemptions away from viable. |
| `-ship` (273 words) | friendship → friend, ownership → owner, leadership → leader | the literal-ship compounds fire: starship → star, warship → war, airship → air, flagship → flag, spaceship → space. worship is inert. A whole FP *class*, not a handful. |
| `-dom` (66 words) | kingdom → king, boredom → bore, stardom → star | condom → con fires; random → rand and seldom → (seld) are inert. Small family, so the one misfire is most of the risk. |
| `-ward(s)` (51 words) | homeward → home, westward → west (the `-s` is already handled → `-ward`) | greensward → greens, forward → for, wayward → way, froward → fro, hayward → hay, steward → stew all fire. coward and toward are inert (stem too short). ~7 wrong in 51. |

### D. Diminutives & `-ish` — false positives dominate (reason 3)

Documented mainly to record *why* they're refused: the ending is a common word-final
string, so most matches are not derivations.

| Suffix | Occasional fix | False positives (the majority) |
|--------|----------------|-------------------------------|
| `-let` (126 words) | booklet → book, piglet → pig, leaflet → leaf | hamlet → ham, wallet → wall, bullet → bull, mallet → mal, cutlet → cut all fire; tablet and goblet are inert |
| `-ette` | kitchenette → kitchen, statuette → statue | palette → pal, roulette, baguette → bagu, gazette → gaz, rosette → ros, vignette |
| `-ish` (353 words) | reddish → red, childish → child, foolish → fool | vanish → van, banish → ban, parish → par, radish → rad, danish → dan fire; finish, polish and punish are inert. Fewer than the ending suggests, but a real class |
| `-y` adjectival (2,855 words) | cloudy → cloud, rainy → rain, salty → salt | party → part fires; city, very, army, body, study and money are all inert (stem not a word, or rarer). The volume is the problem rather than any one misfire — 2,855 words moving on the least decisive ending in English, with centry → centre and interrogatory → interrogator in the mix |

### E. Nominalizations & big adjective-forming suffixes — the general case of §6 (reason 2+3)

`-ization`/`-ability` (§6) are the *only* members of these families the engine
touches, precisely because their base is unambiguous. The general versions are
refused: below the floor they'd still mis-fold, because the pattern matches
countless rare non-derived words too.

| Suffix | Would fix | False positives |
|--------|-----------|-----------------|
| `-ation`/`-tion`/`-ion` (174 words for `-ation`→`-ate`) | creation → create, education → educate, admiration → admire | station → state and ration → rate fire; nation is inert. Also planation → plane, phonation → phone, machination → machine |
| `-ance`/`-ence` | performance → perform, difference → differ, existence → exist | distance → dist, science → sci, finance → fin, sentence, silence, essence |
| `-ity`/`-ty` (829 words) | activity → active, rarity → rare, purity → pure, cruelty → cruel | unity → unit and pity → pit fire; city, deity, vanity and gravity are inert (no stem) |
| `-ous` (370 words) | dangerous → danger, poisonous → poison, mountainous → mountain | every one of obvious, various, serious, curious, jealous and porous is **inert** — the nearest family to viable in this table, held back only by the lack of a decisive ending |
| `-al` (1,622 words) | national → nation, coastal → coast, cultural → culture | metal → met and signal → sign fire, plus missal → miss, pagal → page, pongal → pong; final, total, legal and rival are inert. ~3 in 18 sampled were wrong |
| `-ic` (784 words) | heroic → hero, metallic → metal, atomic → atom | panic → pan, topic → top and logic → log fire; music, public, basic, magic, comic and critic are inert |
| `-ify` | simplify → simple, purify → pure, glorify → glory | notify → not, modify → mod, verify → ver, ratify → rat, unify → uni |
| `-ment` / `-ism` | (excluded, see §6) | battlement → battle, arrivism → arrive |

### F. Prefixes — entirely unaddressed (reason 3)

No prefix is stripped anywhere. Stripping would fix a prefixed form that scores
rarer than its base (reconsider → consider, disconnect → connect, overcook →
cook, misspell → spell), but the false positives are severe because most words
that *start* with these strings aren't prefixed:

| Prefix | Would fix | False positives |
|--------|-----------|-----------------|
| `un-` (3,541 words) | unlock → lock, unhelpful → helpful | unit → it fires; uncle, union, unique and universe are inert |
| `re-` (4,102 words) | rebuild → build, reconsider → consider | resort → sort, remain → main, remark → mark, resource → source fire; record, report, release, reason, region and research are inert |
| `dis-` (1,146 words) | disconnect → connect, disagree → agree | discover → cover, display → play, dismiss → miss, discount → count, dish → h all fire |
| `mis-` (894 words) | misspell → spell, misread → read | mistake → take fires; missile, mister, misery and mission are inert |
| `over-` / `out-` (1,726 / 975 words) | overcook → cook, outrun → run | overt → t, overall → all, overcome → come, oversee → see, output → put, outcome → come, outline → line, outside → side all fire |

Prefixes are the clearest example of reason 3. The cap disqualifies fewer of
them than it does the suffixes — a prefixed spelling that coincides with a real
word tends to coincide with a *common* one ("come", "take", "cover", "main") —
so `over-`, `out-` and `dis-` misfire on the most ordinary words in the
language. The MEASURED_FLOOR gate can't help either, because the surviving
false-positive bases are rare and slip under the floor with the words that
should genuinely fold.

---

## Quick list: everything we don't handle

A flat index of the gaps above, for reference. Nothing in this list folds today;
each is scored on its own frequency (or fixed one word at a time via an override).

**Inflection**
- Reverse folds beyond the regular inflections — an irregular form cannot cap its
  own lemma either (no "sing" ← "sang", no "belove"-shaped fix for a suppletive
  paradigm), since §0 reuses the same spelling rules listed here
- Irregular plurals — geese, feet, mice, teeth, women, oxen, children
- Ablaut / irregular past tense — sang, ran, smote, wrought, shorn
- Irregular past participles — broken, cloven, hewn, sawn
- Irregular comparatives/superlatives — better/best, worse/worst, more/most, less/least
- Bare `-er`/`-est` comparatives **above** the floor — bigger, hotter, cleverer, narrower *(542 words; §4's paired-degree check does **not** transfer — the archaic `thinkest`/`knowest` forms defeat it)*
- Greek `-a` → `-on` plurals — criteria, phenomena, automata
- Stem-change `-ora`/`-era` → `-us` plurals — corpora, genera *(inert: changes zero words)*

**Orthography**
- `-cker` after the c → ck rewrite — picnicker, mimicker, panicker *(the `-cked`/`-cking` half is handled in §8)*

**Transparent derivational suffixes**
- `-less` *(746 words; one exemption away — listless)*, `-hood` *(59; two exemptions — monkshood, underhood)*, `-ful` *(297; bare stem only)*, `-ship` (the literal-ship compounds), `-dom` (condom), `-ward(s)`

**Diminutives & lexicalized suffixes (false positives dominate)**
- `-let`, `-ette`, `-ish`, adjectival `-y`

**Nominalizations & big adjective-formers (false positives dominate)**
- `-ation`/`-tion`/`-ion`, `-ance`/`-ence`, `-ity`/`-ty`, `-ous`, `-al`, `-ic`, `-ify`, `-ment`, `-ism`

**Prefixes (none handled)**
- `un-`, `re-`, `dis-`, `mis-`, `non-`, `over-`, `under-`, `out-`, `pre-`

**Next candidates to add**, in order: `-less` (746 words, 317 of them wearing a
Mythic-or-better score, one exemption), `-hood` (two exemptions), `-ful` (bare
stem only), then bare `-er`/`-est` above the floor once it has a guard of its
own. Everything else either needs a curated map (the irregulars) or has false
positives that actually fire on common words — which no gate contains, because
the MEASURED_FLOOR gate only helps when a rule's misfires land *above* the floor.

The six families §8 and the `c` → `ck` rule closed on 2026-08-24 were the
previous entry on this list. What they had in common was a **bound** ending:
nothing accidental ends `-ically`, `-ibly`, `-ologist` or `-eaux`, which is the
same property that earns §6 its ungated fold. That, rather than the
MEASURED_FLOOR gate, is the test to apply to the next candidate.

---

## Overrides & exemptions

Two hand-reviewed escape hatches sit above the mechanical rules
(see [`dictionary.ts`](dictionary.ts)):
- **Score overrides** (`src/data/score-overrides.json`) pin a specific word to a
  specific base, replacing the spelling guesses — used to fix a coincidence
  ("theses" → "thesis") or redirect a fold.
- **Fold exemptions** (`src/data/fold-exemptions.json`) stop a word folding at
  all (and stop a chain passing *through* it) — e.g. "momser" is not a form of
  "mom". The two files must never share a word.
