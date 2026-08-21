# WordInk

A daily word-drop puzzle inspired by Wordle and BombParty. Every player
gets the same 2- or 3-letter drop each day (like `STR`, `OU`, or `MP`)
and enters valid English words that contain it, in order, for up to 5
distinct guesses. The goal is finding the rarest word you can — your best
one is crowned in the log. No timer, no login, no traditional score, just
a friendly rarity reveal (Very Common → Extremely Rare) on every accepted
word. Stop anytime with "Lock in my result," or use all 5 guesses.

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
- **Word validation** (`src/game/submit.ts`): a submission must contain the
  drop as a contiguous, in-order substring, be in the curated
  dictionary, and not be the same word (or an obvious inflection of the
  same word — see `src/game/stem.ts`) as one already accepted that day.
- **Rarity** (`src/game/dictionary.ts`, `src/data/rarity.json`): precomputed
  offline from [wordfreq](https://github.com/rspeer/wordfreq)'s Zipf
  frequency values (exact value kept, not just the label — see
  `src/game/rank.ts`), bucketed into five friendly labels for display.
  Gameplay never makes a live frequency lookup.
- **Guesses** (`src/game/constants.ts`): up to `MAX_GUESSES` (6) distinct
  words per day. Only accepted words consume a guess — rejected submissions
  are free and unlimited. The puzzle auto-completes at 6, or the player can
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
| `-s` / `-es` / `-ies` / `-ves` / `-ices` / `-ae` / `-i` / `-men` plurals and third-person forms | always | `inflectionalBaseCandidates` (`src/game/stem.ts`) offers every candidate spelling and the caller keeps the most common one the dictionary attests. Coincidences are near-ties, so picking wrong barely moves the score: `caves` offers `cave` (4.20) and `cafe` (4.09). |
| `-ed` / `-ing` tenses | always | `tenseBaseForm`, same most-common tie-break: `played` → `play`, not the obscure `playe`. |
| `-ness`, `-ly`, `-ization`, `-ability` | always | Bound or transparent suffixes with one unambiguous base. |
| `-er` / `-est` comparatives and agentives, Latin `-a` → `-um` plurals, `-ize`/`-ise` verbs, `-able`/`-ible`/`-ably`/`-ibly` | **only below Zipf 1.0** | `unmeasuredBaseCandidates`, gated on `MEASURED_FLOOR`. Ungated these fold `noter` → `not`, `tempest` → `temp`, `canter` → `cant`, `shoulder` → `should`, `comma` → `common`, `capsize` → `caps`, `expertise` → `expert`, `countable` → `county`, `fallible` → `fall`. Every one of those is *measured* (Zipf 1.07–4.73) and so excluded; `specialest`, `asyla`, `containerise` and `interviewable` are not measured at all, and fold. |
| five-letter `-ing` | **no** | Every such word is measured above the floor, so the gate leaves none to fold — which is what keeps `thing` from scoring as `the` (a flat 0.00). The price is that `iring` and `hoing` keep an unearned Mythic. |
| `-en` verbs | **no** | Right often enough to tempt (`harshen` → `harsh`) and wrong often enough to disqualify: `dudeen` → `dude`, `shoneen` → `shone`, `torten` → `tort`. 51 words, ~6 of them wrong. |
| Latin `-a` → `-on` plurals | **no** | The dirty sibling of `-a` → `-um`: folds `comma` → `common`, `silica` → `silicon`, `squadra` → `squadron` — about 19 wrong in 280. |
| prefixes (`un-`, `re-`, `non-`, `over-`) | **no** | Not analysed; a large family (thousands of Mythic/Legend words) and a riskier one, since `release` → `lease` and `report` → `port` are the same shape as a real prefix. |

The `-ize`/`-ise` rule also un-sticks a fold that already existed: `-ization` →
`-ize` used to dead-end on an unattested verb, so `winterisation` folded to
`winterise` (Zipf −0.45) and stopped, when `winter` (4.18) was one strip further.

The gate is the load-bearing idea. Below `MEASURED_FLOOR` a word's score comes
from the deep-tail band — for an unattested word, from the sentinel outright — so
it is a stand-in rather than a measurement, and a plausible base is strictly
better information. At or above the floor there *is* a measurement, and a guess
from a word ending must not overrule it.

Everything in the "no" rows is handled a word at a time in
`src/data/score-overrides.json` instead, which is also where a fold that the
rules get *wrong* gets stopped (`theses` is the plural of `thesis`, not a form of
`these`), and where the gate's own known miss lives (`momser`, a Yiddish
loanword, folds onto `mom`).

Every widening is date-gated, so no past puzzle re-scores: `scoringFor` picks a
`Scoring` profile from the puzzle date, and the four cutovers to date are
`2026-08-15`, `2026-08-16`, `2026-08-19` (folds became caps, resolved through the
whole chain) and `2026-08-21` (every plausible base spelling at once, plus the
gated families).

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

`scripts/manage-extra-word.py` carries a Python mirror of this whole fold path
(`_next_bases`, `chained_base`, `adjusted_zipf`) *and* of `measuredRarity`, used
by the audit skills in `.claude/skills/` to score candidate words. **It has to
change in lockstep with `dictionary.ts`** or the skills will report scores and
tiers the app does not show.

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
frequency via `wordfreq`, treats words without a frequency estimate (`0.0`) as
Zipf `1.4` and Extremely Rare rather than Mythic, and removes anything in
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

Optional, write-only, and entirely server-side. Two tables collect the words
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

Nothing in the game reads either table, and nothing waits on a write. Recording
is strictly downstream of the answer: `api/validate.ts` never awaits its write
(it hands it to the runtime's `waitUntil` when there is one, and would rather
drop a row than delay a player), and the client beacons events without reading
the response. The shipped dictionary remains the only word list the browser
consults, so the game stays offline-first and plays identically whether or not
the database exists — with no credentials set, `api/validate.ts` skips the write
silently and `api/events.ts` answers 503.

Setup: run the migration on a Supabase project, then set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the Vercel project (and in `.env` for local
work — `npm run dev` serves both endpoints, see `vite.config.ts`). The
service-role key is server-side only and is never exposed to the browser, which
is the reason `api/events.ts` exists rather than the client writing directly.
Row-level security is enabled on both tables with no policies at all, so the
`anon` key cannot read or write them even if it leaks.

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
