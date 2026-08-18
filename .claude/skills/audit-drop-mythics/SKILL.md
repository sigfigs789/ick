---
name: audit-drop-mythics
description: Audit the Mythic-and-above answer pool for an upcoming WordInk (ick) drop. Computes the drop for a given puzzle date (defaults to tomorrow in Mountain Time), lists every dictionary word containing it that scores Mythic or Legend, triages them into buckets (inflections that outscore their own base, inflections riding a base, genuine standalone rare words), and judges whether each top-tier word deserves its rank — keeping fun-but-obscure words and flagging unfun mechanical forms (plurals, third-person verbs, agent nouns, comparatives) to be brought back down to their base score. Use whenever Mo asks to check tomorrow's drop, audit the mythics/legends for a drop, or ask whether the top-tier words for a puzzle deserve their rank.
---

# Audit a drop's Mythic+ pool

Goal: the top of the scale should feel earned. A player who lands a Legend
should have found something genuinely delightful — not typed an `-s` onto a word
the game already ranks Legend.

**Scope: one drop.** The only words in play are the ones containing the drop for
the puzzle date — by default tomorrow's, Mountain Time. Nothing else is a
finding, however wrong it looks: a word a player cannot reach on this puzzle is
not this run's problem. Never widen the run into a dictionary-wide sweep, and
never report counts that are not scoped to the drop.

## 1. Run the triage

From the ick checkout (read-only; it changes nothing):

```bash
python3 .claude/skills/audit-drop-mythics/audit_drop.py
```

- Defaults to **tomorrow's puzzle in Mountain Time**. Override with
  `--date YYYY-MM-DD`, or audit an arbitrary drop with `--drop STR`.
- Defaults are tuned for a **daily run**: only words scoring **>= 9.8** whose
  base is **Zipf >= 4.2** (Common — a word a player would actually type) and
  which beat that base by **>= 0.3** are reported. Everything else is counted and
  ignored. Typical output is 0–5 words; a drop that *is* a suffix (`ERS`, `ES`,
  `TER`) spikes to ~50.
- `--min-score`, `--min-base-zipf`, `--min-gap` move those thresholds;
  `--all` drops them entirely for a full audit; `--limit N` prints the
  informational buckets; `--json` emits everything.
- Judged words go in `reviewed.txt` next to the script (one per line) and never
  come back. Add a word there once you have decided to keep it or once the fix
  has shipped — drops repeat bases, so without the ledger the same handful
  reappears every few days.
- Numbers come from `scripts/manage-extra-word.py`'s scoring mirrors, so every
  score matches what a player sees under the newest scoring system.

The script buckets every Mythic+ (score >= 9.5) word containing the drop:

| bucket | meaning |
| --- | --- |
| **Outscores its own base by >= `--min-gap`** | a mechanical inflection whose base is in the dictionary but which `scoringBaseForm`/`tenseBaseForm` (`src/game/stem.ts`, `src/game/dictionary.ts`) fails to fold, so the derived form ranks materially *above* the word it came from. Never legitimate. Sorted by gap — the top of this table is where the damage is. |
| **Inflection at (or within `--min-gap` of) its base** | plural/tense form riding its base word's rarity. Rank is inherited, not earned — low priority, but note it if the base is itself marginal. |
| **Standalone rare word** | scored on its own measured frequency. This is the bucket that should be carrying the tier. |

## 2. Judge the flagged words

Apply the fun test to every word in the first three buckets (and skim the
standalone list for junk shapes — variant misspellings, Latin taxonomy,
`non-`/`re-`-prefixed filler):

- **Keep** — a word that is fun to discover even if obscure or debatable:
  vivid, sayable, has a story (`absquatulation`, `enshittification`,
  `ratiocinate`, classical plurals like `altostrati`). Fun but negotiable stays.
- **Flag** — a word that is only rare because of a mechanical ending, *and*
  clears the 0.3 gap. The worse the gap, the worse the offence — a plural that
  jumps 4+ points off an everyday base (`gratitudes`, `patiences`) is the real
  problem; a 0.1 wobble between two words that are both Legend anyway is not.
  Shapes to watch:
  plurals and third-person verbs (`-s`, `-es`), agent nouns (`-er`, `-ers`),
  comparatives (`-er`, `-est`), gerund plurals (`-ings`). Landing a Legend by
  adding a letter is the exact thing that makes the tier feel cheap.
- **Remove** — misspellings and variant junk that shouldn't be playable at all
  (check `scripts/blocklist.txt` and whether a correctly spelled sibling exists
  in `src/data/dictionary.json`).

## 2b. What to deliberately ignore

The point of the thresholds is that the daily run stays quiet. Do not re-litigate:

- **Gaps under 0.3** — the word and its base are the same rank; nobody notices.
- **Scores under 9.8** — a 9.6 that should be a 9.3 is a rounding argument.
- **Bases rarer than Zipf 4.2** — `achromatises` outscores `achromatise` by a
  mile, but no player has ever typed either. An undeserved rank nobody reaches
  is not a gameplay problem.
- **The "riding a base form" bucket** — already capped; working as designed.
- **Unattested stand-in scores** — a separate skill owns those; this one does
  not report them.
- **The standalone bucket** — this is the tier's content. Leave it alone.

## 3. Recommend the fix

Prefer **one rule change over a word list**. Flagged inflections are almost
always a gap in the base-form folding, and the remedy is to bring the word down
to its baseline — cap its Zipf at its base word's, exactly as
`adjustedZipf` already does for the suffixes it knows:

- `-es` currently strips two characters, so `-se`/`-ze` verbs miss
  (`achromatises` -> `achromatis`, not a word). Also try the plain `-s` strip.
- `-er` / `-ers` / `-est` are not handled at all.
- Classical plurals (`-i` -> `-us`, `-a` -> `-um`/`-on`, `-ae` -> `-a`) are
  invisible to a spelling-only stemmer.

Ship these one shape at a time, cheapest-first — `-er`/`-ers`/`-est` alone
accounts for ~95% of everything the daily filters surface. Any such change is
scoring-system-affecting: it must go behind a **new dated
cutover** in `src/game/dictionary.ts` (see `SENTINEL_FLOOR_START`) so past
puzzles never re-score, be mirrored in `scripts/manage-extra-word.py`, and ship
with tests. Word-level removals go through `scripts/blocklist.txt` plus a data
refresh (`generate-data.py --refresh-rarity`).

## 4. Open the PR

The skill finishes by opening a **draft PR** with the fix — don't stop at a
report. Per `AGENTS.md`: new worktree off `main`, `codex/`-prefixed branch, all
edits there, `npm test && npm run lint && npm run build` before committing,
push, `gh pr create --draft`.

Scope the PR to the narrowest rule that covers what the run actually surfaced —
one shape per PR is fine and preferred. Never regenerate the dictionary for
this; it is a scoring-code change and must not touch `src/data/*.json`.

The PR body leads with the audit table, verbatim from the run — one row per
word, and nothing else in the row:

| word | score | base | base score | why it should change |
| --- | --- | --- | --- | --- |
| `patientest` | **9.92** | `patient` | 4.35 | Superlative of `patient`; -er/-ers/-est are not folded at all… |

Then: the rule being added, the cutover date it sits behind, the before/after
count from `--all` (so the blast radius is explicit), and confirmation that no
data file changed. Add every word in the table to `reviewed.txt` in the same
commit so the next daily run is quiet.
