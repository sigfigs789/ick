---
name: add-online-rare-words
description: Find very rare words online (Datamuse) that contain an upcoming WordInk drop, keep only the ones missing from our dictionary that a frequency corpus can score, and open a PR adding them with pinned rarity/Zipf tests and a bumped dictionary-size assertion. Use whenever the ask is to find/add rare or obscure words for tomorrow's (or a given day's) drop, to grow the dictionary for an upcoming drop, or to run the "Add rare words found online" pipeline locally instead of from the Actions tab.
---

# Add rare words found online for an upcoming drop

This is the local equivalent of the **Add rare words found online** GitHub Action
(`.github/workflows/add-online-words.yml`). Run it locally when the user wants to see
and vet the candidate words before a PR exists, or when Actions isn't an option.

The pipeline is: resolve the drop → ask Datamuse for words containing it → drop
anything already playable or that no corpus can score → add the survivors to the
`online` provenance list → refresh rarity → pin tests → PR.

## 1. Resolve the target date in Mountain Time

The app keys each day's drop off the **player's local calendar date** (`src/game/date.ts`),
so for this repo's maintainer that is `America/Denver` — not UTC. `find-online-words.py`
defaults to "tomorrow" by the *host* clock, so always pass `--date` explicitly:

```bash
python3 -c "from datetime import datetime,timedelta;from zoneinfo import ZoneInfo;print((datetime.now(ZoneInfo('America/Denver'))+timedelta(days=1)).date())"
```

Use the user's date verbatim if they gave one. Then confirm which drop that date maps to
(mirrors `src/game/drop.ts` over `src/data/drops.json`) and say the drop out loud in your
first message, so a wrong date is caught before any regeneration:

```bash
python3 -c "
import json,datetime,sys
d=json.load(open('src/data/drops.json'))
t=datetime.date.fromisoformat(sys.argv[1])
print(t, '->', d['drops'][(t-datetime.date.fromisoformat(d['epoch'])).days % len(d['drops'])])
" 2026-08-18
```

## 2. Work in a worktree

Per `AGENTS.md`, never touch the primary checkout. Create one worktree off `origin/main`:

```bash
git fetch origin && git worktree add worktree/<slug> -b <slug> origin/main
```

Do every step below from that worktree.

## 3. Set up wordfreq — mandatory, not optional

Step 6 runs `generate-data.py --refresh-rarity`, which **re-scores the entire dictionary**
through the `wordfreq → Norvig → Google Books` waterfall (`scripts/frequency.py`). If
`wordfreq` is missing, every word silently falls through to the weaker corpora and the
whole of `rarity.json` drifts. Never run the refresh without it, and pin the same version
CI uses:

```bash
python3 -m venv .venv && .venv/bin/pip install 'wordfreq==3.1.1'
.venv/bin/python -c "from wordfreq import zipf_frequency as z; print(z('eleatic','en'))"  # 1.17
```

Homebrew Python is PEP 668-managed, so a venv is required — do not reach for
`--break-system-packages`. Use `.venv/bin/python` for every Python command from here on.

## 4. Find the candidates

```bash
.venv/bin/python scripts/find-online-words.py --date <YYYY-MM-DD> \
  --max-zipf 2.5 --drop-out .tmp/drop.txt > .tmp/online-words.txt
```

The script itself performs the two checks the request is really about, and reports them on
stderr — capture that summary, it becomes the PR body:

- **already in our dictionary?** candidates present in `dictionary.json` or on any
  provenance list (`extra-words.txt`, `suggested-words.txt`, `online-words.txt`) are
  already playable and are dropped.
- **do we have a Zipf?** words no corpus attests are dropped (`unattested`). Only measured
  words get added, so `--forced` is never used here.
- also dropped: blocklisted words, non `a-z` spellings, and anything above `--max-zipf`.

**If the list is empty, stop.** Report the drop and the skip counts and open no PR — this
is the normal outcome for a drop that was already harvested (each drop recurs on a 1132-day
cycle, and the Action may already have run for it; check `git log --oneline -- scripts/online-words.txt`).

Show the user the surviving words with their Zipf before regenerating anything. If they
want a subset, drop the rest from `.tmp/online-words.txt` first — pruning after the
regeneration means unwinding `dictionary.json` and both index-aligned rarity arrays by hand
(that cleanup is what the second commit of PR #125 had to do).

### Watch for words we already rejected on purpose

The filters only know about words that are *playable* or *blocklisted*. A candidate that a
past run surfaced and a human then rejected will surface again on every future run of the
same drop, because rejecting it from a PR does not record it anywhere. Before adding
anything, check whether each word was already turned down:

```bash
git log --oneline -S<word> -- scripts/online-words.txt src/game/dictionary.test.ts
```

Ask the user, and if they reject a word again, **add it to `scripts/blocklist.txt`** (in the
right section, alphabetized, with a trailing comment saying why) so the pipeline stops
re-proposing it. That blocklist commit is a perfectly good PR on its own when no word
survives.

Proper nouns are the usual reason: Datamuse and the frequency corpora happily attest
surnames and famous names, which look like ordinary rare words to every filter here.

## 5. Add each word

Same path as the "Add a word" action, one call per word:

```bash
while IFS= read -r w; do [ -z "$w" ] && continue
  .venv/bin/python scripts/manage-extra-word.py add "$w" --list online
done < .tmp/online-words.txt
```

## 6. Refresh rarity and re-align

Do **not** rebuild the dictionary from the ESDB/SCOWL source (the local `make` is blocked,
and the unpinned upstream silently re-sizes and re-scores everything — see the note in
`add-word.yml`). `add` already inserted each word into `dictionary.json` in place, so only
the rarity data needs regenerating:

```bash
cp src/data/rarity.json .tmp/rarity-before.json          # for the drift check below
.venv/bin/python scripts/generate-data.py --refresh-rarity
WORDS=$(tr '\n' ' ' < .tmp/online-words.txt)
.venv/bin/python scripts/manage-extra-word.py align-legacy $WORDS
.venv/bin/python scripts/manage-extra-word.py update-size-test
while IFS= read -r w; do [ -z "$w" ] && continue
  .venv/bin/python scripts/manage-extra-word.py record-word "$w" --list online
done < .tmp/online-words.txt
```

- `align-legacy` inserts one placeholder per added word into the frozen
  `rarity-legacy.json` so it stays index-aligned with the grown dictionary.
- `update-size-test` bumps the `expect(dictionaryWords).toHaveLength(...)` assertion.
- `record-word` prints each word's Zipf, rarity label and displayed score, and pins
  `[word, rarity, zipf]` into `onlineWordScores` in `src/game/dictionary.test.ts`, which
  the "accepts words added via the action with their recorded rarity and score" test
  asserts through `isValidWord` + `rarityFor`. Keep that log — the scores go in the PR body.

**Drift check.** Index shifts make a raw diff useless, so compare value multisets: the only
new `zipfHundredths` values should be the added words'.

```bash
.venv/bin/python - <<'PY'
import json
from collections import Counter
before = Counter(json.load(open('.tmp/rarity-before.json'))['zipfHundredths'])
after = Counter(json.load(open('src/data/rarity.json'))['zipfHundredths'])
print('added:', sorted((after - before).elements()))
print('lost :', sorted((before - after).elements()))
PY
```

`added` should hold exactly one value per new word and `lost` should be empty. A large
`lost` set means the waterfall changed under you — usually a missing `wordfreq` (go back to
step 3), or a new word became the rarest attested one and moved the unattested **sentinel**
(`refresh-rarity` prints the sentinel it chose). A sentinel move is legitimate but re-scores
every unattested word: say so explicitly and get the user's go-ahead before committing.

## 7. Verify, then open the PR

```bash
npm ci
npm test -- --run src/game/dictionary.test.ts
```

Commit only the pipeline's own files, push the branch, and open a **draft** PR against
`main` (per `AGENTS.md`) titled `Add online rare words for the <DROP> drop`:

```
scripts/online-words.txt
src/data/dictionary.json
src/data/rarity.json
src/data/rarity-legacy.json
src/data/rejection-metadata.json
src/game/dictionary.test.ts
```

The PR body must **list every word out** with its Zipf, rarity label and displayed score,
plus the old → new dictionary size, and the skip counts from step 4 (how many candidates
were already in the dictionary and how many had no Zipf). Note that no word was forced.
