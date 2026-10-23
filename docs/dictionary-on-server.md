# Moving the dictionary off the client

The question: can the dictionary live in the database, with players only sent
the words for the next three days' drops?

**Yes.** The catch is that what we send can't be a list of *words*. It has to
be a list of *verdicts*: each word the puzzle can accept, already scored by
the existing engine. The measurements are below, followed by what would
change and a suggested order of work. Nothing in the app has changed yet.
`scripts/drop-slices.mts` is the prototype that produced the numbers.

## What players download today

| Asset | Raw | Gzipped | When |
| --- | ---: | ---: | --- |
| Main JS chunk (`index-*.js`, mostly `src/data/*.json`) | 14.2 MB | 3.7 MB | first load, blocks play |
| `public/corpus/` (1.2M words, tags, sources, Zipf) | 9.1 MB | ~3.6 MB | lazily, after first load |

The largest pieces of the main chunk, gzipped: `estimated-zipf.json` 2.1 MB,
`dictionary.json` 0.6 MB, `rarity.json` 0.4 MB, `rejection-metadata.json`
0.4 MB, `rarity-legacy.json` 0.2 MB, `fold-exemptions.json` 0.1 MB. Every
player downloads every word, every score and every future drop
(`drops.json`).

## Why the slice must hold verdicts, not words

The first idea is "send every word that contains the drop." That breaks
scoring, because a score depends on words that don't contain the drop:

- **Folds land on bases outside the drop.** For drop `PI`, `happier` scores
  as `happy`. `chainedBase` walks up to several hops through words that may
  not contain the drop either.
- **Some rules check whether a word is absent.** `latinPluralsAllowed` asks
  whether a word has an English `-s` plural, and the `-ier`/`-iest` rule asks
  whether the base's other degree is attested. A slice missing those words
  would give different answers.
- **Scoring reads side tables** (`estimated-zipf.json`, `fold-exemptions.json`,
  `score-overrides.json`, rejections, the corpus tags), all keyed by words
  outside the drop.

Working out exactly which words each drop's scoring touches would mean
instrumenting a 4,400-line engine, and getting it wrong would change scores
silently. Porting the engine to SQL would mean keeping a third copy of the
fold rules in lockstep, and the Python mirror in `manage-extra-word.py` has
already drifted.

The simpler approach is to run the engine we already have ahead of time. For
each puzzle date, `evaluateSubmission` runs on every curated or corpus word
that contains the drop, in both modes. The result stored is
`word → [standard, freeform]`, where each entry is a Zipf (the word is
accepted) or a rejection reason. The client then looks up a word in a table
and runs no scoring rules at all. Rules are already dated by puzzle, so one
slice per date is exact.

Same-root refusal (`rootKey`) is the one rule that compares one guess with
another. It ended on 2026-10-05 (`SAME_ROOT_REFUSAL_END`), so current puzzles
refuse only exact repeats and don't need it. Archived puzzles from before that
date would need a root key per word in their slices.

## Measured slice sizes

From `./node_modules/.bin/vite-node scripts/drop-slices.mts -- --days 30`,
using the data checked in today:

| Puzzle | Drop | Candidates | Kept | Raw | Gzipped | Build time |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2026-10-23 | CIP | 1,324 | 1,175 | 31 KB | 7 KB | 0.2 s |
| 2026-10-24 | EP | 24,650 | 22,465 | 564 KB | 125 KB | 1.3 s |
| 2026-10-25 | TTE | 7,774 | 6,846 | 161 KB | 38 KB | 0.3 s |
| 2026-10-26 | SES | 16,982 | 16,703 | 417 KB | 107 KB | 1.1 s |
| next 30 days | | | | | avg 60 KB, max 251 KB | |
| worst drop (`ER`, 2029-06-15) | ER | 191,859 | 169,964 | 4.2 MB | 909 KB | 7.9 s |

The next three days of play come to about **170 KB gzipped**, compared with
about 7.3 MB now. Even the worst drop in the rotation is a quarter of today's
main chunk. A compact binary format or shorter keys would cut these further,
but plain JSON is already small enough.

## Where the slices would live

Each slice is a function of the checked-in data and the date, so it can be
built offline, the same way `rarity.json` is built today.

1. **Build:** a CI job runs the slice builder for, say, today−1 to today+3 on
   every deploy and on a daily cron. It has to run on every deploy because the
   daily audit PRs (`score-overrides.json`, `word-rejections.json`) change
   tomorrow's scores.
2. **Store:** a Supabase table such as `drop_words(puzzle_date, word,
   standard, freeform, data_version)`, or one JSON object per date in Supabase
   Storage. The table can be queried per word. A blob per date is simpler and
   easy to cache.
3. **Serve:** `api/drop-slice?date=YYYY-MM-DD` refuses any date after
   today + 2. Puzzle dates follow the player's local calendar, so "today"
   varies by about a day between time zones and the window needs that slack.
   Past dates are served freely, since they reveal nothing. Responses carry the
   data version so a stale cached slice is never used against newer rules, the
   same way `corpus.ts` keys its files on `APP_VERSION`.

The client prefetches today's slice plus the next two and keeps them in
`localStorage` or IndexedDB, so a player who opens the game and then goes
offline can still play the next three days.

## What else reads the full dictionary

These all import `src/game/dictionary.ts` today. Each needs its own answer
before the data can leave the bundle.

| Feature | Where | What it would need |
| --- | --- | --- |
| Submitting a guess | `submit.ts` `evaluateSubmission` | the slice lookup, plus the exact-repeat check |
| Spelling hint ("did you mean") | `nearMissForDrop` | already searches only words containing the drop, so the slice is enough |
| Drop ceiling, reveal, idle hints | `bestWordForDrop`, `learnableWordForDrop`, `wordsForDropInTiers` | computed from the slice, or precomputed into it |
| Merriam-Webster fallback | `submit.ts` → `rarityForUncurated` | still folds onto dictionary bases, so scoring has to move into `api/validate.ts` |
| Archive play | `useDailyPuzzle.ts` | slices for past dates fetched on demand, with root keys before 2026-10-05 |
| Re-scoring saved progress and other players' words | `storage.ts`, `leaderboard.ts`, `liveFoldRescore.ts` | most calls already fall back to the stored Zipf (`?? word.zipf`). For other dates, use the stored score or ask the server |
| Admin pages | `FoldReviewPage`, `FoldedLivePage`, `SuggestedWordsPage` | keep the full engine in a lazily loaded admin chunk, or move it to the API |
| Word rules modal, chat notices, analytics | various | each needs checking. Most only use tier and score helpers, which need no data |
| Today's drop itself | `drop.ts`, `drops.json` | if hiding future drops is part of the goal, the drop has to come from the server too. Today every future drop ships in the bundle |

The offline tooling (audit skills, `manage-extra-word.py`, the Python
generators, the test suite) keeps using the full data in the repo and doesn't
change.

## A side benefit: checking leaderboard scores

`api/leaderboard.ts` currently trusts the score the client sends. Once the
server holds every puzzle's verdicts, it can check each submitted word against
them and reject made-up scores.

## Suggested order

1. **Slices offline.** Make `scripts/drop-slices.mts` the builder. Add a test
   that a sample of each slice matches `evaluateSubmission`, and a CI job that
   publishes slices. Nothing changes for players yet.
2. **Serve them.** Add `api/drop-slice` with the date window, plus the Supabase
   table or bucket.
3. **Client reads slices for the core loop:** submitting, spelling hints,
   reveal and idle hints. The full engine stays in the bundle as a fallback,
   behind a flag, so the two can be compared in production.
4. **Move uncurated scoring server-side** (`api/validate.ts`) and switch
   archive play to on-demand slices.
5. **Remove the data from the bundle.** Lazily load the engine for admin pages
   only, and drop `public/corpus/` from what players download. Optionally serve
   the drop from the server too.

Step 1 is about a day of work. Steps 3–5 are the bulk of it, mostly because of
how many call sites read `dictionary.ts` synchronously today.
