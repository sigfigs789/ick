# Daily fold check

What Claude does in `.github/workflows/daily-fold-check.yml`. The workflow has
already dumped the puzzle's folds and split them into chunks; it applies the
result and opens the PR itself. Claude's whole job is the two files below.

Every row is a playable answer for that one puzzle's drop -- the dump runs each
word through the real submission gate -- whose Standard-mode fold lowers its
score. Judge only those rows. Do not look for other words.

## Input

`scripts/fold-audit/out/daily/chunks/chunk-NN.txt`, one fold per line:

```
word|path|score with the fold|score without it|rule
antichain|antichain>chain|5.20|10.00|prefix-ungated
```

`path` is every hop the fold took, word first, base last.

## Pass 1 -- flag

Judge every row against [RUBRIC.md](RUBRIC.md): does the base the fold lands on
mean what the word means? Hand each chunk to its own subagent and run them in
parallel; give each one RUBRIC.md and its chunk, and have it return
`word|same|different|unsure|reason` for every row.

Run every subagent in the foreground (`run_in_background: false`), several in
one message for parallelism, and keep going until both output files are
written. This runs headless: the moment your turn ends the run is over, and a
background subagent still working is killed with its verdicts.

Collect every `different` into `scripts/fold-audit/out/daily/flagged.tsv`, tab
separated, with the header `word	reason`. A `same` or `unsure` stays folding.

## Pass 2 -- defend

The first pass is a detector, and on the 2026-09-22 audit more than half of what
it flagged was the fold being right (`picometer` -> `meters` flagged "metric
prefix unit"; a picometer is a unit of length). So the flags go to one fresh
subagent told the opposite job, with the prompt in `verify.py`'s `PROMPT`:
defend each fold, and answer `wrong` only when the reviewer is right. Show it
the word, the full path, and the flag's reason.

Where the two passes disagree, break the tie with a third subagent given the
same defend-the-fold prompt; two of three decides.

## Output

`scripts/fold-audit/out/daily/confirmed.tsv`, tab separated, header
`word	scope	reason	verify`, one row per fold that is still `wrong`:

- `reason` -- pass 1's reason, at most 8 words.
- `verify` -- the reviewer's reason, at most 8 words.
- `scope` -- `all`, unless the only wrong hop is a prefix strip (rule `prefix`
  or `prefix-ungated`) *and* the word's other folds would be right; then
  `prefix`. `transferals` is trans- + `ferals` only by accident but really is
  the plural of `transferal`, so it takes `prefix`. Most rows take `all`.

Write both files even when they are empty (header only). Change nothing else in
the repository.
