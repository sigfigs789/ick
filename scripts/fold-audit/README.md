# fold-audit

**Picking this up again? Read [STATE.md](STATE.md) first** — what has been
judged, which batches remain, and the gotchas that cost time.

Does the fold ever change a word's meaning? `running` -> `run` is the point of it;
`scowly` -> `scow` is a bug. This is the harness that answers that at scale.

Run order for a whole-lexicon pass:

```
npx vite-node scripts/fold-audit/funnel.ts                          # what is judgeable
npx vite-node scripts/fold-audit/dump-folds.ts -- 2026-10-01 --all  # every fold
npx vite-node scripts/fold-audit/dedupe.ts                          # one row per question
python3 scripts/fold-audit/make-batches2.py --size 500 --salt 12
claude auth login                                                   # judge.py needs this
python3 scripts/fold-audit/judge.py --workers 8
python3 scripts/fold-audit/score2.py
npx vite-node scripts/fold-audit/verify-fixes.ts                    # after fixing
```

Scoped to a few drops instead, judged by hand or by subagent:

```
npx vite-node scripts/fold-audit/dump-folds.ts -- 2026-10-01 2026-10-02
python3 scripts/fold-audit/make-batches.py
#   ... judge each out/batches/batch-NNN.tsv against RUBRIC.md ...
python3 scripts/fold-audit/score-verdicts.py
```

- **dump-folds.ts** enumerates every fold that *lowers* a score, off the TS engine
  with the real corpus served from disk. A fold is a cap, so one whose base is
  rarer costs nothing and is not worth judging. `--all` drops the drop filter.
- **rules.ts** asks stem.ts which generator could have made each hop, and labels
  the chain by its *loosest* link -- "unliking" -> "liking" -> "like" is a prefix
  question, and reading the last hop would file it under tense.
- **make-batches.py** splits the dump into judge batches, each salted with pairs
  whose answer is already known. The known-bad ones are real folds a human
  overturned, read out of fold-exemptions.json. Without the salt a clean report
  and a lazy judge are the same report.
- **score-verdicts.py** scores calibration first, then findings per rule, and
  writes a blind sample.
- **verify-fixes.ts** replays every flagged fold either side of a fix date.

- **funnel.ts** prints where the 1,217,270 corpus headwords go. Most have no
  fold to be wrong about; the judgeable set is the ~229k whose fold costs points.
- **dedupe.ts** collapses the population by root-and-base through `sameRootKey`:
  "jowly", "jowlier" and "jowliness" all folding to "jow" is one question. It
  takes 229,395 folds to 150,972 questions, keeping the highest-harm member of
  each family as its representative.
- **make-batches2.py** batches the deduped set highest-harm first, so a pass
  that runs out of budget has spent it where a wrong fold costs the most.
- **judge.py** runs the whole thing through `claude -p`, several at a time,
  resuming where it left off and retrying a batch whose answer does not line up
  one-to-one with its input.

Daily, in CI: `.github/workflows/daily-fold-check.yml` dumps the puzzle two days
out, has Claude judge and then defend each fold ([DAILY.md](DAILY.md)), and opens a
draft PR through `apply-daily.py` and `daily-report.ts`.

Helpers: `probe.ts` (fold a few words), `beforeafter.ts` (two dates),
`promotions.ts` (what a cutover does to the whole curated list).

## What the judge is worth

Measured, not assumed, and the reason every batch carries salt. The verbose
protocol in RUBRIC.md and judge.py caught 133/140 planted wrong folds on the
first pass and 20/24 on the second. RUBRIC-EXCEPTIONS.md -- where the judge
reports only what it thinks is wrong and stays silent otherwise -- is roughly
half the cost per pair and caught 4/6. It is kept for the record; prefer the
verbose one. Either way a reported count is a *lower bound* on the real number
of bad folds.

**Run the scripts from the repo root.** Run one from elsewhere and vite resolves a
different module graph, the corpus lexicon silently falls back to curated-only,
and the answers quietly change.

`apply-verdicts.py` is kept as the record of what the 2026-09-22 pass applied, not
as a tool to re-run.
