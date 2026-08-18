---
name: audit-drop-mythics
description: Audit the Mythic-and-above answer pool for one WordInk (ick) drop — only the words containing the drop for a puzzle date (defaults to tomorrow, Mountain Time). Scores every such word with the game's own mirrors, triages them (inflections that outrank their own base, inflections riding a base, genuine standalone rare words), and reports each undeserved rank with the word and its score, the base and its score, and why it should change. Judges rejection first — archaic, misspelling, proper noun, abbreviation belong in a blocklist, not a scoring rule — then rescoring, then keep; fun-but-obscure words stay. Finishes by opening a draft PR with the fix. Use whenever Mo asks to check tomorrow's drop, audit the mythics/legends for a drop, or ask whether the top-tier words for a puzzle deserve their rank.
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
- Defaults are tuned for a **daily run**: only words scoring **>= 9.5** (the
  Mythic line) whose
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

## 2. Judge each flagged word — reject, rescore, or keep

Rescoring is not the default verdict. For every flagged word, ask in this order:

1. **Should it be playable at all?** A word that is archaic or obsolete, a
   variant misspelling of a word already on the list, a proper noun, or an
   abbreviation belongs in `blocklist.txt` / the `misspelling` rejection reason —
   not in a scoring rule. Folding it to a base leaves the junk word playable at a
   lower score, which is worse than removing it: the player still gets a
   non-word accepted. Hand these to the **purge-unfun-words** skill.
   Tells: a common sibling spelling is already on the list (`evill` vs `evil`),
   a doubled or dropped letter, `-ise/-ize` pairs where only one is attested, or
   the word reads as 17th-century.
2. **Is it a real form whose score is wrong?** A legitimate inflection of a
   legitimate base (`patientest`, `gratitudes`, `registerers`) — that is the
   rescoring case, and it wants a rule, not a word list.
3. **Is it fine?** Fun to discover even if obscure or debatable
   (`absquatulation`, `ratiocinate`, classical plurals like `altostrati`). Fun
   but negotiable stays.

Check step 1 before proposing any rule. A scoring rule built on top of a word
that should not be in the dictionary bakes the junk in — and worse, the junk
word can hijack the fold: `eviller` capped at the archaic `evill` (9.56) instead
of `evil` (4.40) until the fold was changed to prefer the most common base.

`python3 scripts/check-word.py <word>` gives the rarity plus, for excluded words,
the rejection category ESDB recorded.

## 2b. What to deliberately ignore

The point of the thresholds is that the daily run stays quiet. Do not re-litigate:

- **Gaps under 0.3** — the word and its base are the same rank; nobody notices.
- **Scores under 9.5** — below the Mythic line the rank itself is not at stake.
- **Bases rarer than Zipf 4.2** — `achromatises` outscores `achromatise` by a
  mile, but no player has ever typed either. An undeserved rank nobody reaches
  is not a gameplay problem.
- **The "riding a base form" bucket** — already capped; working as designed.
- **Unattested stand-in scores** — a separate skill owns those; this one does
  not report them.
- **The standalone bucket** — this is the tier's content. Leave it alone.

## 3. Recommend the fix (rescoring cases only)

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
