# Ink

A daily word-drop puzzle inspired by Wordle and BombParty. Every player
gets the same 2- or 3-letter drop each day (like `STR`, `OU`, or `MP`)
and enters valid English words that contain it, in order, for up to 6
distinct guesses. The goal is finding the rarest word you can — your best
one is crowned in the log. No timer, no login, no traditional score, just
a friendly rarity reveal (Very Common → Extremely Rare) on every accepted
word. Stop anytime with "Lock in my result," or use all 6 guesses.

Built in React + TypeScript (Vite). Game logic in `src/game/` is plain
TypeScript with no DOM or React dependencies, which is what made
`native/` possible — a React Native (Expo) port for iOS/Android sharing
that logic and all three data files verbatim; see `native/README.md` for
what's shared vs. rewritten.

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
    `html-to-image`) and hands it to the native share sheet if available,
    falling back to a clipboard image copy, then a plain download. When
    spoiler-free, word text is blurred for the capture only (a transient
    `.spoiler-blur` class added/removed around the `toBlob` call) --
    rarity badges are a sibling element and stay legible either way.

## Regenerating the word/rarity data

The dictionary and rarity data are precomputed offline, not queried live.
To regenerate them:

```bash
pip3 install --user wordfreq
npm run generate-data     # writes src/data/dictionary.json + rarity.json
npm run select-drops  # writes scripts/drop-candidates.json (diagnostic)
```

`scripts/generate-data.py` starts from the macOS system dictionary
(`/usr/share/dict/words`), keeps only pure lowercase a-z entries (which
drops proper nouns, possessives, contractions, and hyphenated compounds in
one pass), scores each word's Zipf frequency via `wordfreq`, drops anything
below a frequency floor (filters out most archaic words and misspellings),
and removes anything in `scripts/blocklist.txt` (hand-curated slurs,
profanity, and stray abbreviations). Rarity bands are tuned in the
`RARITY_BANDS` constant at the top of the script — adjust and rerun as
playtesting suggests.

`scripts/select-drops.py` evaluates a hand-picked pool of candidate
2- and 3-letter drops against the generated dictionary and keeps only
ones with plenty of common-word matches, so no daily puzzle depends on
obscure answers.

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
  streak — only a puzzle finished on its own real calendar date counts.
  That check lives in `storage.ts`'s `updateStreakOnCompletion`, which
  bails out unless the puzzle's date equals `todayDateString()`.

## Not in v1 (by design)

Multiplayer, leaderboards, accounts, and "what percentage of players chose
this word" originality stats are intentionally out of scope for the first
version — see the project brief for the reasoning.
