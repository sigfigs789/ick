# WordInk

A daily word-drop puzzle inspired by Wordle and BombParty. Every player
gets the same 2- or 3-letter drop each day (like `STR`, `OU`, or `MP`)
and enters valid English words that contain it, in order, for up to 6
distinct guesses. The goal is finding the rarest word you can — your best
one is crowned in the log. No timer, no login, no traditional score, just
a friendly rarity reveal (Very Common → Extremely Rare) on every accepted
word. Stop anytime with "Lock in my result," or use all 6 guesses.

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
demotions for words no corpus attests. Such a word falls to the unattested
sentinel and scores a perfect 10.0 / Legend, which is right for a genuine find
(`enshittification`) and wrong for a mechanical derivation of an ordinary word
(`iratest`, the superlative of a Zipf-2.78 word, which `scoringBaseForm` has no
`-est` rule for). Each entry pins one word to the base it should score as, and
carries its own `since` date so a demotion applies from the puzzle it was
reviewed for onward and no past puzzle re-scores. It is scoring only —
same-root duplicate detection is untouched. Widening the stemmer instead is
deliberately avoided: a blanket bare-`s` strip re-scores 10,877 words and
strips 2,189 of a perfect 10. Entries are added a drop at a time by the
`audit-unscored-legends` skill (`.claude/skills/`), which is also what keeps
this file reviewable.

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
