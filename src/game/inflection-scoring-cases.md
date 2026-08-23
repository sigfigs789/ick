# Inflection & derivation scoring folds

WordInk scores a word by how rare it is: rarer word, higher score. A problem
falls out of that directly — an inflected or derived form is almost always
*rarer* in the corpus than the plain word it comes from ("angrier" is measured
rarer than "angry", "asphyxiates" rarer than "asphyxiate"), so left alone it
would out-score its own base. To stop that, the engine tries to recognise a form
as a mechanical variant of a base word and **caps its score at the base's**
("no rarer than the word it came from").

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
  so a rarer base can never drag a word down — the fold is inert here.

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

### The odd spelling we *don't* handle: `c` → `ck`

The one common orthographic rule missing is the `k`-insertion after a final `c`,
which English adds so the `c` stays hard before `-ed`/`-ing`/`-er`:

| Would fix | What happens today |
|-----------|--------------------|
| panicked → panic, panicking → panic | strips to the non-word "panick" (the `ck` isn't a doubled consonant, so `stripDoubledConsonant` leaves it) and never folds |
| mimicked → mimic, trafficking → traffic, picnicker → picnic | same — lands on "mimick" / "traffick" / "picnick", none of them words |

**Would fix:** these currently score on their own (rarer) frequency instead of
their base. **False positives if added:** essentially none — a `-cked`/`-cking`
→ `-c` rewrite only matches `c`-final verbs, and the real-word check on the base
covers the rest. This is the closest orthographic sibling to the tractable
`-er`/`-est` gap in §B, and the safest of the unaddressed cases.

## 8. Transparent prefixes — `un-`, `non-`, `over-`, `out-`, `mis-`, … (2026-08-23 on)

Below `MEASURED_FLOOR` only, like §7. A word may be stripped of one transparent
prefix to reach the word it was built on, and the chain carries on from there:
`nonplaying` → `playing` → `play`.

Found by `scripts/fold-disagreements.py`, which compares every fold against
MorphyNet. This was the largest gap it reported: with only suffix rules a
prefixed word strips its suffix, lands on an *unattested prefixed stem* and
stops there holding a near-perfect score. `outwill` sat at 10.00 with `will`
(Zipf 4.98) one strip further; 186 words in the Mythic band were mis-scored by
two points or more the same way.

| Word | Was | Now | Base |
|------|-----|-----|------|
| `outwill` | 10.00 | 1.88 | will |
| `overpeople` | 10.00 | 2.18 | people |
| `misthink` | 9.96 | 2.43 | think |
| `counterorders` | 9.89 | 3.30 | order |
| `underbakes` | 9.96 | 5.62 | bake |

4,253 words move, every one of them down; no word is promoted. 255 of them are
measured, all in the Zipf 1.0–1.5 band, reached the way `materialnesses` reaches
`material` — through an unmeasured intermediate that the gate does admit. That is
not new: the §7 suffix family already moves 528 measured words the same way.

**The base must be a word people use** (`PREFIX_BASE_MIN_ZIPF`, Zipf 3.0). This
is the one guard the suffix families do not need. Stripping a prefix routinely
lands on a *bound combining form* that a 225k-word dictionary lists as an entry
but nothing was ever built from: `neolith` → `lith`, `monocrat` → `crat`,
`autophyte` → `phyte`, `protopathy` → `pathy`, `prelect` → `lect`, `subduce` →
`duce`, `monopode` → `pode`. They cluster in the deep tail, which is what
separates them from real bases — a transparent prefix attaches to an ordinary
word. The floor removes some forty wrong folds and costs a handful of real ones
whose bases are themselves rare (`overgild` → `gild`, `overemote` → `emote`,
`misallot` → `allot`), each worth under three points of demotion.

One case clears the floor anyway: `microdont` (micro- + -odont, tooth) folds to
`dont`, which is in the dictionary as the apostrophe-less "don't" and carries
that word's Zipf 4.74. It has a reviewed fold exemption.

**Why the gate is enough here.** Ungated the rule folds `preface` → `face`,
`present` → `sent`, `mistake` → `take`, `outrage` → `rage` and `understand` →
`stand`. Every one is an ordinary measured word, so the gate never reaches them
— the same argument that lets `-er`/`-est` and `-able` run below the floor and
nowhere else. A four-letter minimum on the residue handles the short-base folds
(`unit` → `it`, `union` → `ion`, `overt` → `t`).

**What is excluded and why.** `de-`, `re-`, `co-` and `dis-` are the most
productive prefixes in the language, and they are left out. They are also the
four English fossilised onto Latin stems that were never English words, and
below the floor is exactly where those live: `delate` → `late`, `refel` →
`fell`, `cosh` → `she`, `copious` → `pious`, `delineable` → `line`. Here the gate
cannot help, because the fossilised word is itself rare. It costs real readings
(`codriver` → `driver`, `reexplain` → `explain`, `depeople` → `people`), which is
the `-en` verbs decision again: a family right often enough to tempt, wrong in a
way no spelling rule can see. Admitting it needs a vetted table of which words
really carry the prefix.

---

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
| Bare `-er`/`-est` **above** the floor | bigger → big, hotter → hot, cleverer → clever, narrower → narrow (measured comparatives that currently keep their own rarer score) | agent nouns with no counterpart degree — but the same paired-degree trick §4 uses for `-ier`/`-iest` ("has a `-est`?") could gate it: "baker" has no "bakest" → safe; "faster" has "fastest" → folds to "fast" (correct). This is the most tractable gap. |
| Greek neuter `-a` → `-on` | criteria → criterion, phenomena → phenomenon, automata → automaton | comma → common, silica → silicon, squadra → squadron (~19 wrong in 280 — the reason §3 omits it) |
| Stem-change `-ora`/`-era` → `-us` | corpora → corpus, genera → genus | camera → "camus", opera → "opus" (distinct word), era → — |
| French `-eaux` → `-eau` | bureaux → bureau, tableaux → tableau, chateaux → chateau | very few words end `-eaux`; low risk — a genuine near-miss addition |

### C. Productive transparent derivational suffixes — moderate false positives (reason 3)

These are the closest cousins of the handled `-ness`/`-ly`. A real-word + gate
guard would rescue some; the false-positive base being *common* is what breaks
the rest.

| Suffix | Would fix | False positives (folds onto unrelated real word) |
|--------|-----------|--------------------------------------------------|
| `-ful` / `-iful`→`-y` | beautiful → beauty, careful → care, powerful → power, merciful → mercy | grateful → grate, awful → (aw) |
| `-less` | helpless → help, hopeless → hope, worthless → worth | ruthless → ruth, listless → list, reckless → reck |
| `-hood` | childhood → child, brotherhood → brother, falsehood → false | low risk — a strong candidate to add |
| `-ship` | friendship → friend, ownership → owner, leadership → leader | hardship → hard, worship → (wor, safe) |
| `-dom` | kingdom → king, boredom → bore, stardom → star | random → rand, seldom → (seld) |
| `-ally` / `-ically` → `-ic` | basically → basic, dramatically → dramatic (cases `-ly` misses because "basical" isn't a word) | low risk — most `-ically` words are `-ic` + ally |
| `-ologist` → `-ology` | biologist → biology, geologist → geology | narrow and near-safe — every `-ologist` is an `-ology` agent |
| `-ward(s)` | homeward → home, westward → west (the `-s` is already handled → `-ward`) | coward → cow, toward → (tow), steward → (stew) |

### D. Diminutives & `-ish` — false positives dominate (reason 3)

Documented mainly to record *why* they're refused: the ending is a common word-final
string, so most matches are not derivations.

| Suffix | Occasional fix | False positives (the majority) |
|--------|----------------|-------------------------------|
| `-let` | booklet → book, piglet → pig, leaflet → leaf | hamlet → ham, wallet → wall, bullet → bull, toilet → (toi), tablet, mallet, goblet, cutlet |
| `-ette` | kitchenette → kitchen, statuette → statue | palette → pal, roulette, baguette → bagu, gazette → gaz, rosette → ros, vignette |
| `-ish` | reddish → red, childish → child, foolish → fool | finish → fin, vanish → van, banish → ban, polish → pol, parish → par, radish → rad, punish → pun, British/Spanish/Turkish |
| `-y` adjectival | cloudy → cloud, rainy → rain, salty → salt | city → cit, very → ver, army → arm, body → bod, party → part, study → stud, money → mon (catastrophic — the false positives are the commonest words in English) |

### E. Nominalizations & big adjective-forming suffixes — the general case of §6 (reason 2+3)

`-ization`/`-ability` (§6) are the *only* members of these families the engine
touches, precisely because their base is unambiguous. The general versions are
refused: below the floor they'd still mis-fold, because the pattern matches
countless rare non-derived words too.

| Suffix | Would fix | False positives |
|--------|-----------|-----------------|
| `-ation`/`-tion`/`-ion` | creation → create, education → educate, admiration → admire | nation → nate, station → state, ration → rate, portion, fiction, region, opinion |
| `-ance`/`-ence` | performance → perform, difference → differ, existence → exist | distance → dist, science → sci, finance → fin, sentence, silence, essence |
| `-ity`/`-ty` | activity → active, rarity → rare, purity → pure, cruelty → cruel | city → cit, unity → unit, pity, deity, vanity, gravity |
| `-ous` | dangerous → danger, poisonous → poison, mountainous → mountain | obvious, various, serious, curious, jealous → jeal, porous |
| `-al` | national → nation, coastal → coast, cultural → culture | final → fin, total → tot, metal → met, legal → leg, signal → sign, rival → riv (catastrophic) |
| `-ic` | heroic → hero, metallic → metal, atomic → atom | music → mus, public → publ, panic → pan, basic → bas, topic, logic, magic, comic, critic |
| `-ify` | simplify → simple, purify → pure, glorify → glory | notify → not, modify → mod, verify → ver, ratify → rat, unify → uni |
| `-ment` / `-ism` | (excluded, see §6) | battlement → battle, arrivism → arrive |

### F. Prefixes — mostly handled from 2026-08-23 (§8), `de-`/`re-`/`co-`/`dis-` still open

Superseded in part: see §8. The analysis below was right that the false
positives are severe, and wrong about which lever contains them. It argued the
`MEASURED_FLOOR` gate could not help because false-positive bases like "cle",
"sile" and "der" are themselves rare. But the gate reads the frequency of the
*word being folded*, not of the base — and "uncle", "missile" and "under" are
all ordinary measured words, so the gate excludes them before a base is ever
considered. A four-letter minimum on the residue takes care of the rest.

What the gate genuinely cannot contain is the opposite case, where the *word* is
rare too: the Latin fossils under `de-`, `re-`, `co-` and `dis-` ("delate" →
"late", "refel" → "fell", "cosh" → "she", "copious" → "pious"). Those four are
excluded and remain open.

The original table, kept because the false positives are still exactly the words
the gate has to exclude:

| Prefix | Would fix | False positives |
|--------|-----------|-----------------|
| `un-` | unlock → lock, unhelpful → helpful | uncle → cle, unit → it, union → ion, unique, universe |
| `re-` | rebuild → build, reconsider → consider | record → cord, report → port, release → lease, reason, region, research |
| `dis-` | disconnect → connect, disagree → agree | discover → cover, distance, district, display, dispute |
| `mis-` | misspell → spell, misread → read | missile → sile, mister, misery, mistake → take |
| `over-` / `under-` / `out-` | overcook → cook, outrun → run | overt → ert, output → put, outer → er, under → der |

Every word in the false-positive column is measured well above the floor, which
is what makes the family tractable after all — see §8.

---

## Quick list: everything we don't handle

A flat index of the gaps above, for reference. Nothing in this list folds today;
each is scored on its own frequency (or fixed one word at a time via an override).

**Inflection**
- Irregular plurals — geese, feet, mice, teeth, women, oxen, children
- Ablaut / irregular past tense — sang, ran, smote, wrought, shorn
- Irregular past participles — broken, cloven, hewn, sawn
- Irregular comparatives/superlatives — better/best, worse/worst, more/most, less/least
- Bare `-er`/`-est` comparatives **above** the floor — bigger, hotter, cleverer, narrower *(most tractable — the §4 paired-degree check would transfer)*
- Greek `-a` → `-on` plurals — criteria, phenomena, automata
- Stem-change `-ora`/`-era` → `-us` plurals — corpora, genera
- French `-eaux` → `-eau` plurals — bureaux, tableaux *(low risk)*

**Orthography**
- `c` → `ck` before `-ed`/`-ing`/`-er` — panicked, mimicking, trafficking, picnicker *(low risk — safest single fix)*

**Transparent derivational suffixes**
- `-ful` (grateful risk), `-less` (ruthless risk), `-hood` *(low risk)*, `-ship`, `-dom` (random risk), `-ally`/`-ically` *(low risk)*, `-ologist` *(low risk)*, `-ward(s)`

**Diminutives & lexicalized suffixes (false positives dominate)**
- `-let`, `-ette`, `-ish`, adjectival `-y`

**Nominalizations & big adjective-formers (false positives dominate)**
- `-ation`/`-tion`/`-ion`, `-ance`/`-ence`, `-ity`/`-ty`, `-ous`, `-al`, `-ic`, `-ify`, `-ment`, `-ism`

**Prefixes (transparent ones handled from 2026-08-23 — see §8)**
- Still open: `de-`, `re-`, `co-`, `dis-` — the four English fossilised onto
  Latin stems, where the word is as rare as the false base and the gate cannot
  separate them. Needs a vetted table (`scripts/fold-disagreements.py`).

**Lowest-risk candidates to actually add:** `c`→`ck` orthography, bare `-er`/`-est`
above the floor, `-eaux`→`-eau`, `-hood`, `-ically`, `-ologist`. Everything else
either needs a curated map (the irregulars) or has false positives the
MEASURED_FLOOR gate can't contain (the big derivational families, and the four
fossilised prefixes).

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
