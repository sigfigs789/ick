# WordInk

A daily game where you find the rarest word you can, inspired by Wordle
and BombParty. Every player gets the same 2- or 3-letter drop each day
(like `STR`, `OU`, or `MP`) and enters valid English words that contain
it, in order, for up to 4 distinct guesses. The goal is rarity — your best
one is crowned in the log. No timer, no login, just a 0–10 rarity score and
tier (Very Common → Legend) on every accepted word. Stop anytime with "Lock
in my result," or use all 4 guesses. Every puzzle can be played in
**Standard** or **Freeform** mode (see below), and each mode has its own
progress and its own leaderboard.

Built in React + TypeScript (Vite). Game logic in `src/game/` is plain
TypeScript with no DOM or React dependencies.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL. `npm run build` produces a production build in
`dist/`; `npm run lint` runs ESLint.

## Testing

```bash
npm test          # run once (Vitest)
npm run test:watch
npm run test:ui   # Vitest's browser UI
```

Coverage focuses on `src/game/` (drop selection, word validation,
dedup/stemming, rarity lookup, streak/completion persistence, share text)
since that's where the rules live, plus a couple of component tests
(`GuessLog`, `SubmitForm`) for the click-to-reuse and lock-in interactions.
Tests are colocated as `*.test.ts`/`*.test.tsx` next to the code they cover.

## How the game works

- **Drop selection** (`src/game/drop.ts`, `src/data/drops.json`):
  the day's drop is picked deterministically from a curated list, keyed
  off the number of days since a fixed epoch — every player on the same
  calendar date gets the same drop, no server required.
- **Modes** (`src/game/mode.ts`): from `MODE_CHOICE_START` (2026-09-27) the
  player picks Standard (the default) or Freeform, and the choice is
  remembered. 2026-09-14 to 2026-09-26 was the Freeform trial, when the calendar
  set the mode. Earlier puzzles are Standard only. Every rule is dated by
  puzzle, so an archived puzzle always plays under its original rules.
- **Word validation** (`src/game/submit.ts`): a submission must contain the
  drop as a contiguous, in-order substring, be a known word, and not be the
  same word (or an obvious inflection of the same word — see
  `src/game/stem.ts`) as one already accepted that day. A word is known if
  it is in the curated `src/data/dictionary.json` (~225k words) or in the
  runtime word corpus (`public/corpus/`, ~1.2M words, fetched lazily by
  `src/game/corpus.ts` and built by `scripts/build-word-corpus.py`). A corpus
  word must come from a *lexicon*: Wiktionary (every English headword is
  included), the curated list or the macOS dictionary. Words that only a
  frequency list has seen are refused. Frequency never decides whether a word
  is playable. Merriam-Webster (`api/validate.ts`) is the live fallback for
  words no local list knows.
- **Refusals by tag**: corpus words carry Wiktionary's tags. Misspellings are
  refused in both modes. Standard waives proper nouns and abbreviations, and
  refuses obsolete, archaic or dated words only below Zipf 2.5. Freeform waives
  all of these and refuses only misspellings and non-words. Hand-reviewed
  verdicts live in `src/data/word-rejections.json`.
- **Rarity** (`src/game/dictionary.ts`, `src/data/rarity.json`, the corpus's
  `zipf.bin`): a waterfall Zipf frequency, precomputed offline. It uses
  [wordfreq](https://github.com/rspeer/wordfreq) first, then Norvig's web
  counts, then Google Books, then Datamuse (`scripts/frequency.py`). A
  wordfreq `0.0` is not a measurement and falls through to the next source. A
  word no source measures is *unattested* and gets the sentinel Zipf (one notch
  below the rarest measured word), which scores a flat **10.00 / Legend**.
  Tiers run Very Common … Mythic (9.5+) … Legend (9.9+). Freeform scores every
  word on its own frequency. Standard folds a derived form onto its common base
  first (next section). Gameplay never makes a live frequency lookup.
- **Guesses** (`src/game/constants.ts`): up to `MAX_GUESSES` (4) distinct
  words per day, date-gated (6 before 2026-08-20, then 5 until 2026-08-30).
  Only accepted words consume a guess — rejected submissions are free and
  unlimited. The puzzle auto-completes at the limit, or the player can
  call it early via "Lock in my result" (`src/game/storage.ts`'s
  `lockInResult`) once they've got at least one word.
- **Persistence** (`src/game/storage.ts`): today's progress and the
  streak counter live in `localStorage`, keyed by calendar date. Once the
  puzzle is marked complete it can't be re-completed, but players can
  still revisit their result afterward.
- **Sharing** (`src/game/share.ts`, `src/components/ShareImageButton.tsx`):
  two ways to share a result, both spoiler-free by default via the same
  toggle in `ResultsPanel`.
  - **Text**: `buildShareText`'s `spoilerFree` option (default `true`)
    swaps between rarity squares and the actual words.
  - **Image**: `ShareImageButton` rasterizes the results card (via
    `html-to-image`) and copies it straight to the clipboard -- no
    share-sheet dialog in between, so it's click-then-paste. Falls back to
    a plain download only if the Clipboard API has no image-write support
    at all. When spoiler-free, word text is blurred for the capture only
    (a transient `.spoiler-blur` class added/removed around the `toBlob`
    call) -- rarity badges are a sibling element and stay legible either way.

## How rarity folds onto a base word

Folding applies to **Standard only**. Freeform, including the 2026-09-14..26
trial, scores every word as itself.

A word's score comes from its measured Zipf frequency, but frequency corpora
undercount derived forms badly: `asphyxiates` was measured at Zipf 1.09 and
`asphyxiate` at 1.78, so the plural scored **9.77 / Mythic** while the verb it
came from scored **8.75 / Extremely Rare**. Adding an `s` should not be a
discovery, so the engine folds a derived form onto a base word and **caps** its
score there — a fold can only ever pull a word toward common, never make it
rarer. `src/game/dictionary.ts`'s `chainedBase` explores every base reachable by
folding and takes the most common one it finds.

Which folds are safe turns on two questions: is the spelling decisive, and — if
it isn't — does the word have a real measurement worth protecting?

| Family | Folded? | Why |
| --- | --- | --- |
| `-s` / `-es` / `-ies` / `-ves` / `-ices` / `-men` plurals and third-person forms, and `-es` → `-is` (`analyses` → `analysis`, `crises` → `crisis`) | always | `inflectionalBaseCandidates` (`src/game/stem.ts`) offers every candidate spelling and the caller keeps the most common one the dictionary attests. Coincidences are near-ties, so picking wrong barely moves the score: `caves` offers `cave` (4.20) and `cafe` (4.09). The far-from-tie coincidences are pinned by review instead (`theses` → `thesis`, not `these`). |
| `-ed` / `-ing` tenses | always | `tenseBaseForm`, same most-common tie-break: `played` → `play`, not the obscure `playe`. |
| `-ier` / `-iest` comparatives | always | `degreeBaseCandidates`: the spelling rewrites a `-y`, so the reading is checkable — the base's *other degree* must be attested. `happy` has `happiest`, so `happier` folds (it was scoring 5.40 against `happy`'s 3.50); `copy` has no `copiest`, so the agent noun `copier` keeps its own measured score, as do `carrier`, `supplier` and `crier`. The check stands in for the frequency gate, which is why this is the one degree spelling that folds above the floor. |
| `-ness`, `-ly`, `-ization`, `-ability` | always | Bound or transparent suffixes with one unambiguous base. |
| Latin `-a` → `-um`, `-i` → `-us`, `-ae` → `-a` plurals | when the word has **no English plural of its own** | `latinPluralsAllowed`: a Latin plural has no `-s` form (no `podias`, no `memorandas`), so a word that has one is an English singular whatever its ending. `aquaria`, `addenda`, `maxima` and `momenta` fold — all measured, all previously rarer than their own singulars — while `alba`/`albas` (the white garment), `taxi`/`taxis`, `brae`/`braes` and the metal-oxide family (`aluminas`, `magnesias`, `titanias`) keep their own scores. No frequency line can make this cut: `alba` (3.33) is *more* common than `curricula`. |
| bare `-er` / `-est` comparatives and agentives, `-ize`/`-ise` verbs, `-able`/`-ible`/`-ably`/`-ibly` | **only below Zipf 1.0** | `unmeasuredBaseCandidates`, gated on `MEASURED_FLOOR`. Ungated these fold `noter` → `not`, `tempest` → `temp`, `canter` → `cant`, `shoulder` → `should`, `capsize` → `caps`, `expertise` → `expert`, `countable` → `county`, `fallible` → `fall`. Every one of those is *measured* (Zipf 1.07–4.73) and so excluded; `specialest`, `containerise` and `interviewable` are not measured at all, and fold. For `-ier`/`-iest` the strip offers only the `-y` rewrite (`hurrier` → `hurry`, the `abandoner` shape) — the other i-stem candidates let junk chain somewhere real (`campier` reached `campus` through the non-word `campi`). |
| five-letter `-ing` | **no** | Every such word is measured above the floor, so the gate leaves none to fold — which is what keeps `thing` from scoring as `the` (a flat 0.00). The price is that `iring` and `hoing` keep an unearned Mythic. |
| `-en` verbs | **no** | Right often enough to tempt (`harshen` → `harsh`) and wrong often enough to disqualify: `dudeen` → `dude`, `shoneen` → `shone`, `torten` → `tort`. 51 words, ~6 of them wrong. |
| Latin `-a` → `-on` plurals | **no** | The dirty sibling of `-a` → `-um`: folds `comma` → `common`, `silica` → `silicon`, `squadra` → `squadron` — about 19 wrong in 280. |
| prefixes | **some** | `counter-` and `anti-` fold whatever the word's frequency (`UNGATED_PREFIXES`). `under-`, `over-`, `out-` and `un-` fold only below `MEASURED_FLOOR` (`TRANSPARENT_PREFIXES` in `src/game/stem.ts`). The borrowed prefixes (`super-`, `micro-`, `semi-` and the rest) were retired on 2026-09-05 because they attach to Latin stems as readily as to words. `pre-` was retired on 2026-09-05 and came back from 2026-09-27 with every family it reaches reviewed (#329). `re-` does not fold: `release` → `lease` and `report` → `port` are the same shape as a real prefix, and above the floor the corrections cannot reach the wrong base. |

The `-ize`/`-ise` rule also un-sticks a fold that already existed: `-ization` →
`-ize` used to dead-end on an unattested verb, so `winterisation` folded to
`winterise` (Zipf −0.45) and stopped, when `winter` (4.18) was one strip further.

A *tensed* `-ize`/`-ise` form folds through its own verb, never past it
(`izeVerbSpellings`). Stripping `-izes` in one bite reached the stem directly
while the verb itself — measured just above the floor — was gated out of the
very same strip, so `womanizes` displayed 3.50 against `womanize`'s 9.86: a
conjugation scoring six points *more common* than the word it conjugates, the
mirror image of the bug the fold exists to prevent, and the same split ran
through 214 paradigms. Routing through the verb applies the gate once per
paradigm, so every tense of a verb displays what the verb displays. Only when
the verb spelling isn't a dictionary word is the tensed form stripped directly —
there is no sibling left to disagree with, and it is what keeps `winterisation`
working.

The gate is the load-bearing idea. Below `MEASURED_FLOOR` a word's score comes
from the deep-tail band — for an unattested word, from the sentinel outright — so
it is a stand-in rather than a measurement, and a plausible base is strictly
better information. At or above the floor there *is* a measurement, and a guess
from a word ending must not overrule it.

Everything in the "no" rows is handled a word at a time in
`src/data/score-overrides.json` instead. That file is also how a fold the rules
get *wrong* is redirected: an override replaces the spelling guesses outright,
so `theses` scores as `thesis`, not `these`, and `whatsises`, `abatises` and
`complices` are pinned to the singulars the rules cannot see. What an override
cannot say is "score this word on its own data" — every entry pins the word to
*some* base. `src/data/fold-exemptions.json` says exactly that: an exempt word
contributes no fold candidates, so it neither folds nor lets a chain pass
through it. The entries are the words the strips genuinely misread — `momser`
(Yiddish, from *mamzer*, not "more mom"), `limen` and `germen` (not plurals of
`liman` and `german`), `rightsize` and `laterize` (verbs, not degrees of `right`
and `later`) — and because a chain cannot pass through an exempt word, one entry
carries a whole paradigm: `rightsized`, `rightsizes` and `rightsizing` fold
through their verb and stay with it. Both files are dated, and a word must never
appear in both (the exemption would silently win; a test pins the disjointness).

Every widening is date-gated, so no past puzzle re-scores: `scoringFor` picks a
`Scoring` profile from the puzzle date. The first cutovers were `2026-08-15`,
`2026-08-16`, `2026-08-19` (folds became caps, resolved through the whole chain)
and `2026-08-21` (every plausible base spelling at once, plus the gated
families). The full dated list is in the header comment of
`src/game/dictionary.ts`. The latest, all on `MODE_CHOICE_START` (2026-09-27),
are these:

- **Corpus lexicon** (`CORPUS_ONLY_START`): the fold can land on any untagged
  lexicon word in the corpus (790k headwords), not just the curated 225k.
- **Shorter forms only** (`SHORTER_FORMS_START`): Standard never scores a word
  as a *longer* form ("titty" is no longer capped at "titties"). The walk can
  still pass through longer forms on the way to a shorter one.
- **The fold audit**: 1,939 reviewed exemptions in `fold-exemptions.json`, plus
  a fix to the `-ly` strip (`LIQUID_STEM_START`). See `scripts/fold-audit/STATE.md`.

`2026-08-21` carries two independent changes that happened to ship the same day,
and it is worth keeping them apart when reading the code. The retuned Zipf bands
(`NARROW_BANDS_START`, `measuredRarity`) change only **which label a score
wears** — Elusive added, Quotidian retired — and move no score. The base-form
widening (`INFLECTION_BASE_START`, `nextBaseForms`) changes only **the score**
and touches no band cutoff. The two constants are the same date on purpose;
either could move to its own date later without disturbing the other.

### Folds only ever demote

A fold may lower a score and never raise one. `adjustedZipf` implements it as
`Math.max(ownZipf, baseZipf)` — higher Zipf means commoner, so taking the maximum
can only push a score down. Every path goes through it, including a reviewed
override, so no entry in `score-overrides.json` can promote a word either.

That rule is **not** the same as "scores never rise". A global rescaling may
legitimately raise every score at once — `2026-08-16` widened the measured band
from `0..9.5` to `0..9.9` and did exactly that — because it preserves ordering and
no word overtakes another. A *fold* raising a score is different: it would be
inventing rarity out of a spelling rule, which is backwards from the correction
folds exist to make.

The guarantee starts at `2026-08-19`, and did not hold before it. The older
`adjustedZipf` branch returned a tense base's frequency *outright* rather than
capping against it, which promoted 7,114 words: `beloved`, measured at Zipf 4.17,
scored **9.75 / Mythic** as `belove` (1.10). Archived puzzles keep those scores on
purpose. That branch is still in the file for them, which makes it a live
copy-paste hazard for the next fold rule — hence the invariants below are stated
date-agnostically rather than pinned to one cutover.

Asserted over the entire dictionary in `src/game/inflection-scoring.test.ts`:

- no fold makes a word rarer than its own measured Zipf, on every date from
  `2026-08-19` on (and undated);
- `beloved`'s pre-cutover Mythic is pinned, so the boundary cannot drift;
- crossing the `2026-08-21` cutover never raises a word's score;
- no folded word scores rarer than the base it folded onto;
- `baseFormSubstitution` never reports a promotion, so analytics cannot either.

"Only ever demote" holds *within* one scoring profile. Crossing a cutover can
raise scores on purpose: the 2026-09-27 shorter-forms rule and the fold-audit
exemptions both did. Those promotions were reviewed word by word.

`scripts/manage-extra-word.py` carries a Python mirror of this whole fold path
(`_next_bases`, `chained_base`, `adjusted_zipf`) *and* of `measuredRarity`, used
by the audit skills in `.claude/skills/` to score candidate words. **It has to
change in lockstep with `dictionary.ts`** or the skills will report scores and
tiers the app does not show. Known drift: the mirror still folds against the
curated `dictionary.json` only, not the corpus lexicon the game has used since
2026-09-27. For a current puzzle, check a score in the game itself.

## Regenerating the word/rarity data

The dictionary, rarity, and rejection guidance data are precomputed offline,
not queried live.
To regenerate them:

```bash
pip3 install --user wordfreq
git clone https://github.com/en-wl/wordlist.git /tmp/esdb
make -C /tmp/esdb
/tmp/esdb/scowl --db /tmp/esdb/scowl.db word-list 80 A,B,Z,C,D 1 --wo-poses=abbr --categories= > /tmp/scowl-regional-80.txt
python3 scripts/import-wiktionary-words.py # streams the full English Wiktionary extract
npm run generate-data -- --word-list /tmp/scowl-regional-80.txt --esdb-db /tmp/esdb/scowl.db
npm run select-drops  # writes scripts/drop-candidates.json (diagnostic)
```

The runtime corpus in `public/corpus/` is built separately, from the full
English Wiktionary extract plus every word list above. It applies no filter: each
word is tagged with what might make it ineligible, and each mode decides what to
do with the tags.

```bash
python3 scripts/build-word-corpus.py   # downloads the kaikki.org extract (~3.2GB)
```

`scripts/generate-data.py` accepts a newline-delimited source list via
`--word-list`; the checked-in data is generated from an ESDB/SCOWL size-80
list with American, British, Canadian, and Australian spellings, with
abbreviations and special categories excluded, plus the scored single-word
terms in `scripts/wiktionary-accepted.txt`. That supplement is derived from
the full English Wiktionary extract and is available under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); words that
ESDB flags as abbreviations, proper nouns, or names are dropped from the
supplement at merge time so lowercase spellings (e.g. `paris`) do not slip
into play. The script also keeps only pure lowercase a-z entries (which drops
proper nouns, possessives, contractions, and hyphenated compounds), scores each word's Zipf
frequency through the waterfall in `scripts/frequency.py`, keeps words no source
measures at the unattested sentinel (a flat 10.00 / Legend) rather than dropping
them, and removes anything in
`scripts/blocklist.txt` (hand-curated slurs, profanity, and stray
abbreviations). Rarity bands are tuned in the `RARITY_BANDS` constant at the
top of the script — adjust and rerun as playtesting suggests.

### Why size 80 (don't bump to 85)

Size 80 is a deliberate cutoff — resist the urge to raise it to 85 "for more
words." We measured it: SCOWL size 85 adds **50,458** entries over size 80, and
they are overwhelmingly junk for a word game. ~98% are attested only at SCOWL's
size-85 tier (which ESDB itself documents as "valid but potentially no longer
used in modern English") and ~97% appear in **no** wordfreq corpus at all —
archaic spellings (`abhominable`, `atwixt`), obsolete inflections (`abidden`),
and dialectal forms (`naebody`, `brawlie`).

The tempting counter-argument — "but 1,186 of them have modern wordfreq
attestation" — doesn't survive inspection. Of those 1,186: **600 are proper
nouns** whose lowercase forms merely appear in text (`alaska`, `albert`,
`aesir`) — exactly what we already strip from the Wiktionary supplement — and
the remaining ~586 are almost entirely foreign borrowings, Latin taxonomy, and
transliterations (`auf`, `bien`, `deus`, `araceae`, `altezza`), not common
English. Essentially none are genuinely useful words that size 80 was wrongly
excluding. Individual real words that slip through size 80's net belong in
`scripts/extra-words.txt`, not a blanket size bump.

To recreate the ESDB/SCOWL source list:

```bash
git clone https://github.com/en-wl/wordlist.git /tmp/esdb
cd /tmp/esdb && make
/tmp/esdb/scowl --db /tmp/esdb/scowl.db word-list 80 A,B,Z,C,D 1 --wo-poses=abbr --categories= > /tmp/scowl-regional-80.txt
python3 scripts/generate-data.py --word-list /tmp/scowl-regional-80.txt --esdb-db /tmp/esdb/scowl.db
```

The ESDB database is required when regenerating the word data so the
high-confidence explanations for excluded proper names, abbreviations, and
words not considered current modern English stay in sync. To refresh only the
rejection explanations against the checked-in dictionary:

```bash
git clone https://github.com/en-wl/wordlist.git /tmp/esdb
make -C /tmp/esdb
python3 scripts/generate-data.py --metadata-only --esdb-db /tmp/esdb/scowl.db
```

`src/data/rejection-metadata.json` is a compact, generated lookup used only
after a word misses the curated dictionary. It intentionally has a generic
fallback for unknown words and ambiguous entries.

`src/data/word-rejections.json` is hand-written too: words that stay on the
curated list but are no longer playable, each with the reason a player sees when
they try one (`misspelling`, `archaic`, `proper-noun`, …). Rejecting this way
rather than deleting the word keeps `rarity.json` index-aligned, leaves past
puzzles scoring what they scored, needs no pinned-count updates, and — because
this file is never regenerated — cannot be undone by a data refresh. Entries are
dated like the overrides below. `scripts/blocklist.txt` remains the tool for
content that must never enter the dictionary at all.

The same file also holds reviewed **non-words**: a word that never made the
curated list, judged once and recorded with its fault — a misspelling
(`conniseur`), a brand or a title (`californication`), a clipping (`conflag`).
Nothing about play changes for those; the entry replaces the generic "not in
WordInk's curated list" message with the specific one, and — because only a
`not-a-word` rejection is handed to the live Merriam-Webster fallback — spares
the quota a word that has already been answered. The tests tell the two kinds
apart by dictionary membership: a retired word must still be scoreable and must
have been playable the day before its `since` date, a reviewed non-word must be
unplayable on every date. Nonsense nobody repeats is better left to the generic
message than recorded here, one typo at a time.

`src/data/derived-rejections.json` applies the same kind of rejection in bulk, and
is **generated** rather than hand-written. The rule is that a curated word which
carries a rejection reason is unplayable and the player is told which reason —
what the word rules have always promised. The filter it came from only ever kept a
classified word from *entering* the list, so words already on it stayed playable
whatever Wiktionary said, and an obsolete spelling scored on its own vanishing
frequency: `ranck` (an obsolete form of `rank`) came out a 9.58 Mythic where `rank`
scores 4.80. Rejecting rather than deleting keeps `rarity.json` index-aligned and
leaves archived puzzles scoring what they scored.

The reasons are Wiktionary's, grouped by the date the rejection takes effect, and
they divide in two:

- **Out of use** (`obsolete`, `archaic`, `dated`) — every ordinary sense of the
  word has fallen out of use. Only counted below **Zipf 2.5**. The gate is the
  guard this family needs, because its false positives are precisely the common
  words: `halt` (3.93), `fraught` (3.12) and `guerilla` (2.90) are each tagged
  obsolete off one dead sense, `thy` and `unto` archaic, `yea` and `fortnight`
  dated. Below the gate the tag is reliable — a 24-word random sample checked
  against Wiktionary came back 24 for 24 (`voyce`, `performe`, `sherriff`,
  `chaunt`).
- **Structural** (`abbreviation`, `proper-noun`, `misspelling`) — Wiktionary
  records no ordinary sense for the headword at all. No gate: `cd` being common
  says nothing about whether it is an abbreviation.

Rebuild it without an ESDB checkout with:

```bash
python3 scripts/generate-data.py --refresh-rejections
```

That only ever *adds* words, under the run's date, so a refresh can't retroactively
invalidate a word an archived puzzle accepted. `scripts/playable-exemptions.txt` is
the pressure valve: a word listed there is held playable despite its label, is
taken back out of the generated file, and is also spared the
`ALWAYS_EXCLUDED_REASONS` filter on a full rebuild — the only way to answer a
label that is simply wrong, since that filter *deletes* rather than rejects.

It is already earning its keep on the abbreviation class: Wiktionary files
"Ellipsis of X" and "Clipping of X" under the same tag as a true initialism, so
`condo`, `thymus`, `ascot`, `corgi`, `seltzer`, `romaine` and a dozen more read as
abbreviations to the pipeline. They are on the keep-list; `ppl`, `idk` and `tbh`
are not. The durable fix is for `import-wiktionary-words.py` to tell an ellipsis
from an initialism, which needs a fresh Wiktextract run — that and the rest of the
open word-data findings are tracked in
[`docs/word-data-followups.md`](docs/word-data-followups.md).

`src/data/score-overrides.json` is the other **hand-written** data file: reviewed
demotions for words a spelling rule can't cap correctly. Most are words no
corpus attests — such a word falls to the unattested sentinel and scores a
perfect 10.0 / Legend, which is right for a genuine find (`enshittification`)
and wrong for a mechanical derivation of an ordinary word (`iratest`, the
superlative of a Zipf-2.78 word, which `scoringBaseForm` has no `-est` rule
for). The rest are measured words whose only reachable base is a coincidence
(`theses` is the plural of `thesis`, but the rules can only see `these`); an
override replaces the spelling rules rather than joining them, so it is also
how a *wrong* fold gets stopped. Each entry pins one word to the base it should
score as, and carries its own `since` date so a demotion applies from the puzzle
it was reviewed for onward and no past puzzle re-scores. It is scoring only —
same-root duplicate detection is untouched. Entries are added a drop at a time
by the `audit-unscored-legends` skill (`.claude/skills/`), which is also what
keeps this file reviewable.

An earlier version of this note argued that widening the stemmer was not
affordable, because a blanket bare-`s` strip re-scores ~10,900 words and strips
2,189 of a perfect 10. The count was right; the conclusion was wrong. Those
re-scores were the fix, not the cost: once every fold became a **cap** rather
than an inheritance (the 2026-08-19 cutover), a wider rule could only ever pull
a word toward common, never make it rarer. The 2026-08-21 cutover therefore
widened it — see "How rarity folds onto a base word" below.

`scripts/select-drops.py` evaluates a hand-picked pool of candidate
2- and 3-letter drops against the generated dictionary and keeps only
ones with plenty of common-word matches, so no daily puzzle depends on
obscure answers.

## Word and event tracking (Supabase)

Optional and entirely server-side, and — apart from the leaderboard below —
write-only. Two tables collect the words
players actually reach for so they can be folded into the curated dictionary
later — at which point those words stop needing a live lookup at all, which is
what keeps Merriam-Webster's 1,000-requests-per-day quota comfortable. Schema
lives in `supabase/migrations/`.

- **`word_sightings`** — one row per word the live fallback has judged, written
  by `api/validate.ts` through the `record_word_sighting` function: the verdict
  (`playable` / `rejected` / `unknown`), the reject reason, the Zipf frequency
  Datamuse attested, MW's parts of speech and first-known-use date, and a
  `status` column for the future triage pass. Failed lookups are never recorded
  — an outage says nothing about a word, and must not overwrite a real verdict.
  `lookups` counts *cache misses*, not plays: `/api/validate` is CDN-cached for
  a day, so treat it as "seen again" rather than as popularity.
- **`analytics_events`** — a mirror of every event already sent to Vercel
  Analytics (`src/analytics.ts`), so they can be queried with SQL and kept past
  the dashboard's retention window. The browser posts each event to
  `api/events.ts` with `sendBeacon` and ignores the result; the endpoint
  validates the shape (snake_case name, at most 32 flat scalar properties) and
  inserts it.

- **`suggested_words`** — the review queue, a view rather than a table. It pools
  the two places a candidate arrives from: live MW approvals still marked `new`
  in `word_sightings`, and words players typed into the How to play suggestion
  box (`word_suggested` events). `origin` says which — `both` is the strongest
  signal there is. Rarest first, so the perfect-10 words surface at the top.
  Graduating a batch is `select set_word_status(array['word', ...], 'accepted')`,
  which drops them out of the queue; a suggestion that was never played gets a
  row of its own with outcome `suggested`, so it can be settled too, and a real
  lookup later overwrites that placeholder while leaving the triage alone.

- **`fold_reviews`** — the fold ledger, written from the page at `/fold`. One
  row per word: the form its score folded onto, both frequencies as the reviewer
  saw them, and `approved` or `rejected`. Two things read it.
  `scripts/export-fold-rejections.mjs` turns the rejections into entries in
  `src/data/fold-exemptions.json`, which is what actually stops a fold — by way
  of a script and a deploy rather than live, because scoring is dated and
  deterministic and an archived puzzle has to score the same next year. And both
  answers together are a labelled set: the judgement a model would have to learn,
  written down. Approvals are stored for that second reason alone; nothing in the
  game reads one.

  The page is gated like `/feedback`: keyed where `REVIEW_TOKEN` is set, open
  where it is not. Setting the token is what makes the labels *yours*, which is
  the half of this worth protecting — the rejections reach the scoring only
  through a script somebody runs and a diff somebody reads.

A review pass also reads `answer_rejected` events, which have no `status` to
settle — a rejected guess is an event, not a row. `scripts/word-review-log.json`
is the watermark for those: each pass records the newest `created_at` it saw, so
the next one filters on `created_at > <reviewed_through>` instead of re-reading
every submission the game has ever refused. The verdicts themselves stay in the
data files (`word-rejections.json` for a rejection, the provenance lists in
`scripts/` for an acceptance); the log only says how far the reading got.

Graduating a word must not cost it its score. `api/validate.ts` scores a live
approval from the frequency Datamuse reports, and the bulk corpora behind
`rarity.json` (wordfreq, Norvig, Google Books) often attest nothing at all for
exactly this kind of word — so adding one to the curated dictionary used to trade
a measured Zipf for the unattested sentinel and a flat 10.00 Legend.
`scripts/datamuse-zipf.txt` is the fix: a hand-recorded `word<TAB>zipf` list,
consulted as the waterfall's last tier, so it can only fill a gap and never
override a measurement. `conization` keeps its 8.7 Extremely Rare instead of
being promoted to a Legend it never earned.

Nothing in the game reads either of these two tables, and nothing waits on a
write. Recording
is strictly downstream of the answer: `api/validate.ts` never awaits its write
(it hands it to the runtime's `waitUntil` when there is one, and would rather
drop a row than delay a player), and the client beacons events without reading
the response. The shipped dictionary remains the only word list the browser
consults, so the game stays offline-first and plays identically whether or not
the database exists — with no credentials set, `api/validate.ts` skips the write
silently and `api/events.ts` answers 503.

### Running the leaderboard locally

There is no fixture: the leaderboard, the finds feed and the review pages
always read whatever the server holds. `vite dev` serves no edge functions, so
those pages need one behind them.

To develop against a real database instead, `supabase start` brings up a local
stack and applies the migrations; point `.env` at the URL and service-role key it
prints. Worth doing before changing this schema — running it for real is what
caught the grants bug below, which no amount of reading would have.

**Privileges: revoke from PUBLIC, then grant back to `service_role`.** `anon` and
`authenticated` hold no grants of their own — they inherit PUBLIC's, which is why
revoking from PUBLIC is what actually locks a function down. But `service_role`
inherits PUBLIC's too, and that is the role PostgREST assumes when an edge
function presents the service key. Revoke from PUBLIC alone and the endpoint gets
`permission denied for function` on its own procedures. Newly created *tables*
grant nothing to anybody but their owner, so they need the same treatment. RLS
stays on with no policies, which is what keeps `anon` and `authenticated` out;
the grants are what let `service_role` through the privilege check before it
bypasses RLS.

Setup: run the migration on a Supabase project, then set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the Vercel project (and in `.env` for local
work — `npm run dev` serves both endpoints, see `vite.config.ts`). The
service-role key is server-side only and is never exposed to the browser, which
is the reason `api/events.ts` exists rather than the client writing directly.
Row-level security is enabled on every table with no policies at all, so the
`anon` key cannot read or write them even if it leaks.

## Leaderboard

Its own page at `/leaderboard` — a board is something you link a friend to, open
in a second tab, and leave with the back button, none of which a modal can do.
Two entry points from the game: a trophy in the header, which is there from the
first day, and a link under the results. Routing is
`src/routes.ts`, about forty lines of `pathname` and `pushState`, since
`vercel.json` already rewrites every non-`/api/` path to `index.html`.

Two boards, both fed by one table and shown together: **this week**, counting
puzzles from the current Sunday onward, and **Monthly**, counting puzzles from
the first of the current month onward. Both are **ranked by total score** — a sum
of daily scores, which rewards showing up daily instead of peaking once. Ties
break on the best single word, then on who got there first. The rank is computed
in SQL and returned as a column rather than inferred from row order, so the thing
that did the sorting is the thing that says the position.

**Fifteen rows a board, and then you.** Fifty rows was a list you scrolled;
fifteen is a list you read, and a top fifteen is something a player can picture
being in. What makes the short board safe is that it hides nobody: the query
takes the player asking (`p_player`) and returns their own row alongside the top
however far down it sits, at the rank they actually hold — 61st of everybody, not
16th of what fits. Everybody is ranked *before* the cut, in the same query, since
a board query and a separate rank query are two answers that can disagree across
a write landing between them. The row renders under the board and outside its
scrolling, because a row you have to scroll to is one you may as well not have.
The cost is that `player` joins the CDN cache key: the 60-second read cache is
shared per player rather than across everybody.

**A month, not all of time and not a season.** The second board used to sum every
puzzle ever, and then a hand-picked season (2026-08-01 to 2026-12-31). A window
that ends is what makes it worth ranking — somebody arriving late has something
they can still win — but a season's ends had to be picked, named on screen, and
opened again by hand, and the board was only ever as current as whoever remembered
to move it. A month needs none of that: the window is `monthStart(date)` in
`src/game/month.ts`, computed from the puzzle date on every fetch, so the board
turns over on the first with nothing to run and nothing to edit. It goes up with
the request the same way the week does, because the puzzle date both windows
bracket is the player's own local calendar date — so a reset lands at the player's
own midnight on both boards. Only the near end is sent: the far end is the last
day of that same month, worked out in `api/leaderboard.ts` rather than trusted,
and the board is bounded at *both* ends in SQL (`p_season_since` /
`p_season_until` — parameters that kept the old word, so a rename never has to
drop and recreate the function mid-deploy). Bounded at both ends because a board
named for a window that quietly counts outside it is a name that lies: a July
history brought in by a backfill, or a score from a clock already on the first of
next month, would count toward a month it is not in. On screen it says **Resets
Tuesday, Sep 1** — the weekday leads because that is the half a player can act
on; a bare date is one they still have to place in their own week. Unlike the
week's "Resets on Sundays" the answer moves, so it is computed rather than a
constant on the page.

**The find is held back for now.** Each row used to carry the player's rarest
word inside the window (`quixotic 7.9`) beside the puzzle count. The problem is
the number rather than the word — a find is displayed with what it scored, and
the scoring system is still being corrected, so a word worth 7.9 today may not be
tomorrow, and a leaderboard is the wrong place to publish a number that moves.
The words are still on the page under Today's finds, where they are the day's
finds rather than a standing claim about a player. The column is still queried
and still sent, so restoring it is the `Row` component and nothing else.

**Stacked, not side by side.** Two boards of the same shape sitting next to each
other read as one wide table split down the middle — you have to check the
heading to know which ranking you are looking at. One under the other, each is
unmistakably its own list, and the weekly one comes first because it is the one
still winnable.

**Recent finds is its own section, below them.** Both are lists of words, but a
leaderboard row is a *player* and a find is a *word*; sharing the top of the page
made that a distinction the reader had to work out. Separate headings, separate
ground, and a heavier rule between them than between the two boards.

**The weekly reset is a window, not a job.** Nothing is deleted or archived on
Sunday morning: `leaderboard_board` simply stops counting the rows that fell out
of range, and the monthly board is the same function over a different pair of
dates. There is no scheduled task that can fail to run. The window start is
computed on the client (`src/game/week.ts`) for the same reason the puzzle date
is: the reset should land at the player's midnight, not at UTC's.

**Both windows step, and each one separately.** Under each heading is a pager —
*Previous week* / *Next week*, *Previous month* / *Next month* — that walks that
board back through the windows that have closed and forward again to the one
being played. Separately, because the two boards are different questions over
different lengths of time, and comparing last month's standings against this
week's is the whole reason the page carries two. Both arrows are always there and
disabled at the ends, the same way the finds feed's are: a control that vanishes
at the edge of its range takes the shape of the thing with it. Back stops at the
window the first puzzle fell in (`weekFloor` / `monthFloor` in
`src/game/leaderboard.ts`) — scores really do go back that far, since a player who
joins today backfills every puzzle their browser remembers.

A stepped-back board says so in three places: the heading names the window
(**Week of Aug 16**, **July 2026**) instead of "This week", the note beside it
reads **Final** rather than when the board resets, and the plaque underneath
carries that window's own champion, since a closed board *is* the answer — its
first row. The live board's plaque still names the window before it. A window
older than the last one gets no plaque at all when nobody scored in it: "Crowned
on Monday" under a week from two months ago would be the one thing on the page
that is simply false. The turnover-day caveat — the "i" beside the label — is
carried by the week just gone as well as the live board, since a reader who steps
back to it is looking at the same window under a different heading, and its top
row can still move (see `weekChampionSettling`). A week older than that one is
closed everywhere, whatever today is, and wears no mark.

Stepping is one request for both boards, carrying the two windows the reader is
looking at, and each board tracks its own loading and error state from the
windows the response came back about — so a month being fetched never blanks the
week beside it, and a failure offers a retry on that board alone. This is also
why the weekly board is now bounded at *both* ends: the moment `p_since` can be a
Sunday in the past, "everything from Sunday onward" stops being the same set of
rows as "the seven days from Sunday". The far end is derived in
`api/leaderboard.ts` from the near one, exactly as the month's is, so the two can
never disagree.

**Weeks run Sunday to Saturday**, not the ISO Monday to Sunday, and the reason is
onboarding rather than convention. A weekly board is only worth playing while you
can still win it, so what matters is the deficit a new arrival faces on the days
people actually arrive — for a casual daily game, the weekend. A Sunday reset
splits the weekend across the boundary: Saturday ends one week and Sunday begins
the next, so a good share of weekend arrivals land on a board hours old and wide
open. A Monday reset puts both weekend days at the far end of the week, five and
six days down, and a newcomer's first impression is a board they cannot catch.
Because the window start is computed client-side and passed to the query, moving
the first day of the week is a one-file change and never a migration — no SQL
knows which day it is.

### Today's finds

Every word anybody has found on today's puzzle, newest first, headed by the drop
they had to contain — a find only means something beside its drop, since
`asphyxiate` is just a word until you know the day asked for PHY. Each carries the
same rarity badge the game shows on an accepted word, and a word several people
found appears once with the count.

**One puzzle, and it is the puzzle the reader is on.** The feed is keyed to a
puzzle date the client sends, not to a clock: `today` is used as given and bounded
only by whether a puzzle exists for it (`wordsDay`). It used to take the *later* of
the client's date and UTC's, which was reasoning about timezones rather than about
puzzles and got it wrong for everybody west of UTC — an American evening is already
tomorrow in UTC, so the feed asked for a drop nobody in the Americas had reached
and came back empty through the busiest hours of the day.

It began as a week of history and read as an archive; the point is the puzzle
everyone is on right now. New finds slide in at the top while the page is open,
and the page re-checks every 60 seconds — the CDN's own cache window, so polling
faster would return the same bytes. Nothing runs while the tab is hidden, coming
back refreshes at once, and a refresh never flashes the loading state or throws
away good data over one bad minute. The feed is its own request and its own
failure: boards that don't load leave it on screen untouched.

**Publishing today's finds is a deliberate trade.** Everybody gets the same drop,
so a word somebody found today is an *answer to today's puzzle* — showing it hands
that answer to anyone still playing. It was withheld at first for exactly that
reason. Accepted anyway: the feed is only worth keeping live if it changes while
you watch, and someone who wanted to be spoiled could always have read the
endpoint directly. Reverting is one line in `wordsDay`, and the middle position —
live only for players who have already locked in — is written down there.

**No rarity bar.** The feed is what the day's players found, and an ordinary word
is part of what happened. Cutting the Commons would quietly turn a record of the
puzzle into a highlight reel, which the boards above it already are.

**Every word, not each player's best.** The feed used to be built from
`leaderboard_scores.top_word` — one word per player per day — which made it a list
of personal bests rather than a list of finds, and gave it a worse habit: that
column is *overwritten* when a player beats themselves, so a find already on screen
would vanish the moment its only finder did better. A feed that removes things is
not a feed. So words get their own table, `leaderboard_finds`, one row per player
per puzzle per word, inserted once and never updated — which is also what makes the
ordering trustworthy, since `found_at` is the moment a word first arrived and
nothing afterwards can move it. Ordered by a word's *first* sighting, so a popular
word stays where it landed and its count goes up, rather than jumping back to the
top each time somebody else finds it.

A list of good words is interesting at any size, so the feed carries the page on
a day when the boards are still thin.

### Published from the first day

Scores accumulate from the first day this ships, and the boards show whatever
there is: no opening date, no player threshold, no waiting room.

Both were tried and both were the same instinct — don't show a three-name board.
The threshold made the launch open-ended, since "six of ten players" is only a
reason to come back if you believe the other four are coming. The date made it
predictable but still made the page a notice about itself, and a leaderboard
nobody can look at is one nobody can check. What makes a thin board safe to show
is that the page is not only a board: the finds feed is there from the first word,
and `backfillHistory` is retroactive, so whenever a player joins, every eligible
day still in their browser goes up in one request.

**The header's trophy is there from the start too**, with its "new" badge. An
earlier version hid it until the leaderboard had *data*, which deadlocked the
cold start: finds only appear once players join, and joining was only reachable
through that button. "See the leaderboard" under a finished puzzle is the second
way in, and either one spends the badge — its whole job is to say "there is
something here you haven't seen", and both entry points lead to the same page.

### Before the leaderboard ships: run the migrations

The leaderboard is the one part of this game that does not degrade gracefully
into working. With no schema on the project, `/api/leaderboard` answers 502 and
the page says it couldn't load the boards — which is fine, the game plays on —
but every submission that arrives meanwhile is logged by `api/_supabase.record`
and dropped. Nothing queues it and nothing retries it.

This used to be permanent: the backfill ran once, on the visit that minted a
player's id, so a player who arrived before the schema landed had their history
swallowed and never sent it again. It now runs on **every** open, so a swallowed
history comes back on its own the next time that player opens the app — the gap
is a window rather than a scar. Words played during the window are still lost,
since nothing queues a dropped write.

So every migration in `supabase/migrations/` must be applied to the project
*before* the leaderboard reaches players. They are ordered and each depends on the one before it, so apply
them all rather than picking the newest:

```
supabase link --project-ref <ref>
supabase db push
```

Then check the endpoint answers rather than 502s. `supabase start` +
`supabase migration up --local` applies the same files to a local stack, which is
worth doing first — running the SQL for real is what caught the grants bug above,
and it is the only way to see that `service_role` can execute every function and
`anon` can execute none.

### Names are handles, derived from the player id

The board calls players things like `TranquilBison72` — an adjective, a noun and
a number, computed from their id by `src/game/handle.ts`.

This replaced naming players after their rarest find, which was charming and
unreadable. On a page that also lists found words, a leaderboard row reading
`asphyxiate` gave no clue whether it was a person or a word, and separating the
sections helped without fixing it: any scheme where names *are* words has that
problem. A capitalised two-word handle is unmistakably a name, which is the whole
job.

**Derived, not stored.** `handleFor(playerId)` is a pure function, so every
browser computes the same name for the same player without asking, the server
holds no display name at all, and a handle is stable forever — it cannot drift
between the two boards, or between devices, or across releases. That deleted a
table, a Postgres function, an endpoint method, and the whole name-picking UI.

There is no free-text field anywhere in the feature, so there is nothing to
sanitise and nothing to impersonate.

The lists are hand-written rather than drawn from the game's dictionary: a
dictionary pairing would eventually produce something unkind or absurd, and
nobody gets to choose their handle, so the floor matters more than the ceiling.
128 × 128 × 100 gives 1.6M handles — the number is what makes duplicates
unlikely rather than merely uncommon, since two words alone would start colliding
on the same board at a few hundred players.

**Each row names the player, then their find**, on both boards: `TranquilBison72`
/ `6 puzzles · asphyxiate 8.3`. The weekly board briefly led with the week's find
instead, which only made sense while a "name" was itself a word.

### Identity, and the history that comes with it

Account-free, and there is nothing to fill in — not even a tap. Opening the app
mints a UUID and stores that id and nothing else (`src/game/player.ts`, minted by
`src/Root.tsx`), which is also everything the handle is computed from. The trophy
appears only once the boards have opened, carrying a one-time "new" badge retired
by the first visit from that day on (`src/game/whatsNew.ts`).

**Playing is the joining.** It has moved twice, each time toward less ceremony: a
"Put me on the board" button, then the leaderboard visit itself, and now opening
the app at all. Both earlier versions lost data that had already been earned — a
player with no id submits nothing, so somebody who played every day and never
tapped the trophy left no trace on the board or in the finds feed, and their
whole record hung on a page they had no particular reason to open.

The trade is worth stating: every player is on the board now, including one who
would not have chosen it. What goes up is an id the browser invented and the
words they found — both of which the leaderboard already shows to everybody — and
none of it reaches back into the game. Nothing is user-facing: no prompt, no
confirmation, no count of what was imported. A browser that cannot store an id
(private mode, storage off) simply isn't a player, and plays exactly as before.

**Every open sends the player's own history.** Somebody arriving today has often
been playing for weeks, and that record is already in localStorage — so
`storage.playedOnItsDay()` collects every stored puzzle and
`leaderboard.backfillHistory()` sends them as one batch.

It runs on every open, not just the one that mints the id, because the per-day
write is monotonic: a day already recorded is a no-op, so re-sending is a repair
rather than a rewrite. That matters because the live path is fire-and-forget —
one request per accepted word, no retry — so a word lost to a tunnel, a closed
tab or a 5xx would otherwise be missing from the board forever. `Root` also
re-sends when a backgrounded tab resurfaces (`visibilitychange`, and `pageshow`
with `persisted`), gated on five minutes away so a tab flick costs nothing: on a
phone, reopening the app usually isn't a page load at all.

### Only puzzles played on their own day count, backwards and forwards

The live path submits only today's puzzle, and the import counts only days it can
show were played when they dropped. Both follow from the same fact: an archive
puzzle can be solved with unlimited time and a dictionary open in the next tab,
so counting it would make the all-time board a measure of how much archive
somebody ground rather than how well they play. The streak already draws this
line; the board draws it in the same place.

Which past days qualify comes down to what the stored record can prove, and there
are two timestamps that can prove it:

- **`firstWordAt`** — stamped when the first word of a puzzle is accepted, and
  never moved. This is exactly the question being asked, and it counts a day the
  player never finished.
- **`completedAt`** — the fallback for every puzzle saved before `firstWordAt`
  existed. It is stamped on the last guess, which for a late-night session lands
  after midnight; the grace window below covers that.

A day with neither timestamp is skipped. Not because it didn't happen, but
because the record cannot say *when* it happened — and guessing in the player's
favour is exactly how the archive would get in wholesale.

**A session may run past midnight.** A puzzle counts if it was played on its own
day or within four hours after it (`LATE_FINISH_GRACE_HOURS`). Finishing at 1am
is an ordinary way to play a daily game, and the live path has always worked this
way — `useDailyPuzzle` reads the date once on load, so a session opened at 23:50
keeps submitting to that puzzle all night. The import was the stricter of the two;
now they agree. The cost, stated rather than hidden: the next puzzle drops at
local midnight, so this leaves a four-hour window each night in which yesterday's
puzzle could be played fresh and still count. Accepted deliberately — the players
it lets in are real and numerous, and the ones it lets cheat have to be awake at
3am to gain a single day's score.

- **`leaderboard_finds`** — one row per player per puzzle per word, written by the
  same call and read only by Today's finds. Inserted once and never updated:
  `found_at` is when a word first arrived, which is what fixes its place in the
  feed. A player re-sends their whole running word list after every accepted word,
  so all but the newest entry conflicts every time — that is the design, not waste,
  and it is what gets a player who joined mid-puzzle their earlier finds. The
  history backfill deliberately sends no words for past days: the feed shows one
  drop at a time, and a year of words would not fit the request body.
- **`leaderboard_scores`** — one row per player per puzzle date, written by
  `api/leaderboard.ts` through `submit_leaderboard_scores`. Takes an array
  because it has two callers of the same shape: the game submitting today after
  each accepted word, and a joining player submitting a whole history. The upsert
  keeps the *higher* of the stored and submitted score, so repeats, out-of-order
  arrivals and a re-sent backfill are all harmless. Each row also carries that
  day's rarest word and its frequency, which is what both boards derive their
  words from — the name from all of a player's rows, the weekly detail from the
  ones inside the window.

This is the one thing in the project the game reads from a database, because
other people's scores can't be shipped in the bundle. The read is contained:
`GET /api/leaderboard` is CDN-cached for a minute, only the leaderboard page ever
calls it, and a failure renders as "couldn't load" with a retry. Submitting is
fire-and-forget from a `keepalive` POST that nothing awaits. A puzzle plays
exactly the same with the endpoint down, unconfigured, or absent.

There are no accounts, so a submission **cannot be authenticated** — anyone who
reads `api/leaderboard.ts` can post a score under a name of their choosing. What
the endpoint does enforce is that a score be one a real game could have produced:
a puzzle date the game has reached, a total within the day's ceiling, a top word
no rarer than the total it belongs to. One bad day fails the whole batch rather
than being quietly dropped. That is enough for ordinary noise and is not a
defence against a determined forgery. Worth knowing before this board is used for
anything that matters.

## Design decisions worth knowing about

- **Plurals/conjugations are accepted** as distinct words, but two forms
  of the same root (`play`, `plays`, `played`) can't both count — see
  `src/game/stem.ts` for the (deliberately simple, non-linguistic)
  duplicate check.
- **The curated dictionary and frequency data are separate files** by
  design: the dictionary decides whether a word is *allowed*; frequency
  data only decides how it's *labeled*. They can be edited independently.
- **Rarity is index-aligned, not keyed by word**, in `rarity.json` to keep
  the payload small — see the comment in `src/game/dictionary.ts`.
- **Clicking a word already in the log** reloads it into the guess box
  (`SubmitForm`'s `prefill` prop) so it's easy to tweak and resubmit a
  near-miss.
- **Sound effects** (`src/audio/sound.ts`) are synthesized with the Web
  Audio API rather than shipped as files — no assets to load, and the
  accept chime's pitch scales with rarity. Muted via a header toggle,
  persisted in `localStorage`.
- **Puzzle archive** (`src/components/PuzzleNav.tsx`): the ‹ › arrows next
  to the puzzle number browse any past date back to the epoch (never into
  the future). Each date's progress persists independently, so revisiting
  one resumes where you left off. Completing an archived puzzle still
  saves and locks it (so it's reviewable later) but never touches the
  streak — only a valid answer submitted on its own real calendar date
  counts. Missing a day resets the streak to zero. Those checks live in
  `storage.ts`, which ignores archive puzzles and clears expired streaks on
  load.

## Not in v1 (by design)

Multiplayer, leaderboards, accounts, and "what percentage of players chose
this word" originality stats are intentionally out of scope for the first
version — see the project brief for the reasoning.
