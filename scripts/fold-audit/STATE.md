# Where the fold audit got to

Last run 2026-09-22; 259 of 302 batches judged, 214 applied.

Everything below is reproducible from the scripts in this directory; `out/` is gitignored, so a fresh clone regenerates it.

## Done

Two numbers, and they differ. **Judged** is how far the detector got;
**applied** is what has actually shipped. Batches 215-258 and 261 were judged
after the last apply, so their verdicts have never been scored, verified or
turned into exemptions.

| | judged | applied |
| --- | ---: | ---: |
| batches | **259 of 302** | 214 |
| questions | 129,500 | 107,000 |
| folds covered | 205,403 (90%) | **175,903 (77%)** |
| flagged by the detector | — | 3,443 |
| confirmed by adversarial review | — | 1,477 |
| exempted | — | 1,466 |
| fixed by a rule change instead | — | 54 |

Shipped in `fold-exemptions.json` (1,670 entries) and one rule change in
`scoringBaseForm`, all dated 2026-10-01 (`LIQUID_STEM_START`).

**The 45 judged-but-unapplied batches live only in `out/`, which is
gitignored.** If this worktree is removed they are gone, and re-running them
costs about twenty minutes at four workers. Nothing else depends on them.

## Remaining

**Batches 259-260 and 262-302** - 43 batches, 21,472 questions, 25,518 folds
(11% of the system). They are the lowest-harm end: the population was sorted
worst-first, so what is left is where a wrong fold costs the least.

An earlier run lost 88 batches to a throttle at eight concurrent workers, not to
anything about their content - a hand-run of batch-300 afterwards returned
perfect output. Four workers ran clean at roughly two batches a minute.

```
claude auth status                                       # must be logged in
python3 scripts/fold-audit/judge.py --workers 4          # resumes; skips the 259
python3 scripts/fold-audit/score2.py
rm -rf scripts/fold-audit/out/verified                   # see "gotchas"
python3 scripts/fold-audit/verify.py --workers 4
npx vite-node scripts/fold-audit/attested.ts
python3 scripts/fold-audit/apply-confirmed.py            # idempotent
npx vitest run src/game/ && npm run build
```

Everything upstream of `judge.py` (`dump-folds.ts --all`, `dedupe.ts`,
`make-batches2.py`) only needs re-running if the engine or the corpus changes.
If it does, **rebuild the batches from scratch** — `key.json` is positional.

## What was learned, in order of how much it should change what you do

**1. Confirmation disagrees with itself 7% of the time.** Re-running the
verification over 803 already-shipped exemptions overturned 56. Same prompt,
same inputs. Every exemption is a promotion — the word scores rarer — and no
test objects, because no invariant says a fold *must* happen. That 7% is the
error bar on the whole exercise and it was invisible until the same work was
done twice. A third pass broke the 56 ties: 46 upheld, 10 backed out.

The flips are not one pass being bad. Both find the same cases hard:
`easterlies` → `easter` and `haily` → `hay` were right first and wrongly
overturned; `timely` → `time` and `jarringly` → `jar` the reverse.

Aggregate reproducibility is much better than the per-item rate — 42.9%
confirmed on one run against 45.0% on the other — which is the usual shape of a
stable mean over an unstable per-item judgement. Do not read any rate in this
report as precise to better than a couple of points.

**2. A detector alone is not actionable.** It flagged 3,443; 1,477 survived
review. `picometer` → `meters` came back "metric prefix unit, not meters", and a
picometer is a metric unit of length. Whole buckets read that way: `measurement`
75 → 19, `privative-less` 49 → 11, `reverse-inflection` 97 → 26. Acting on the
raw flags would have made ~2,000 correctly-folded words rarer than they should
be.

**3. It reversed a rule change.** `reverse-derived` reported 54.5% wrong, which
read as a rule to retire. Verification put it at 12 of 55 judged: 78% of what it
does is right, and retiring it would have broken more than it fixed. The 12 are
exempted and the rule stays. A rule-level rate computed from unverified flags is
not a rule-level rate.

**4. The detector misses about 1 in 13.** Salt recall 2,372/2,568 (92.4%) over
214 batches. Every count here is a lower bound.

**5. One real rule bug existed and it was found by pattern, not by volume.** The
`-ly` strip ate a stem-final l: `howly` → `how` (7.45 points), `growly` → `grow`,
`jowly` → `jow`. Two wrong fixes preceded the right one, both caught by guards
rather than by reading the code: requiring only that the l-final word exists
broke ~50 adverbs (the corpus attests `generall`), and adding "stem must not end
in l" still took `gravely` → `gravel`. The test that works is a degree paradigm —
`growlier`/`growliest` exist, `gravelier` does not — which is what
`degreeBaseCandidates` already does. It reached past the audit's own scope:
`pearly` was `pear`, `steely` was `steed`, `wooly` was `woo`.

## Gotchas that cost time

- **Run every script from the repo root.** From elsewhere, vite resolves a
  different module graph, the corpus lexicon silently falls back to
  curated-only, and the numbers change without any error. This looked like an
  engine bug for a while; it was the working directory.
- **`out/verified/` is positional** against `full-pass-wrong.tsv`. Regenerate
  that file and the cached verifications no longer line up — delete the
  directory before re-verifying.
- **`score-overrides.json` is for demotions only**, and both words must be
  curated. It rejects a promotion-shaped entry, which is what a fold fix always
  is. Use `fold-exemptions.json`.
- **A word must not be in both tables** — a blanket exemption silences an
  override, and a pinned test checks it. One confirmed fold is unapplied for this
  reason.
- **Eight concurrent `claude -p` workers throttle.** Four is fine.

## Deliberately not done

- **Six folds from the first pass**: `physiognomise` → `physiognomies` and its
  like fold onto an inflection of the same word. Odd-looking, same meaning.
- **`fowlest`** stays playable as a misspelling of `foulest`.
  `word-rejections.json` only reaches curated words, so the corpus era has no way
  to reject a corpus-only word. Pre-existing gap, worth its own change.
- **The 09-28..30 puzzles keep the folds this fixes.** The cutover is 2026-10-01
  because `corpus-lexicon.test.ts` pins that 2026-09-28 keeps promotions under a
  fortieth of its demotions, and these are all promotions. Moving it earlier
  means amending that guard deliberately.
