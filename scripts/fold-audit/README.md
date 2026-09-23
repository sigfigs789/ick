# fold-audit

Does the fold ever change a word's meaning? `running` -> `run` is the point of it;
`scowly` -> `scow` is a bug. This is the harness that answers that at scale.

Run order:

```
npx vite-node scripts/fold-audit/dump-folds.ts -- 2026-10-01 2026-10-02 2026-10-03
npx vite-node scripts/fold-audit/dump-folds.ts -- 2026-10-01 --all   # whole lexicon
python3 scripts/fold-audit/make-batches.py
#   ... judge each out/batches/batch-NNN.tsv against RUBRIC.md ...
python3 scripts/fold-audit/score-verdicts.py
npx vite-node scripts/fold-audit/verify-fixes.ts
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

Helpers: `probe.ts` (fold a few words), `beforeafter.ts` (two dates),
`promotions.ts` (what a cutover does to the whole curated list).

**Run the scripts from the repo root.** Run one from elsewhere and vite resolves a
different module graph, the corpus lexicon silently falls back to curated-only,
and the answers quietly change.

`apply-verdicts.py` is kept as the record of what the 2026-09-22 pass applied, not
as a tool to re-run.
