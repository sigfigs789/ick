# Daily fold check

What Claude does in `.github/workflows/daily-fold-check.yml`. The workflow has
already dumped two weeks of puzzles' folds, kept each word once, and split them
into shards of chunks; one Claude run judges one shard. The workflow prices any
base Claude names, applies the result puzzle by puzzle and opens the PR itself.
Claude's whole job is the two files below.

Every row is a playable answer for one of those puzzles' drops -- the dump runs
each word through the real submission gate -- whose Standard-mode fold lowers
its score. Judge only those rows. Do not look for other words.

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
`word|same|different|unsure|base|reason` for every row.

`base` is asked only of a `different`: the word it really is a form of, the
common form a player would expect it scored as -- `abasing` is from `abase`,
`bares` from `bare`, `scowly` from `scowl`. One lowercase word, shorter than the
word itself and not the base the fold already landed on. `-` when the word is
not a form of anything (`momser`, a loanword) or the subagent is not sure; a
wrong base is worse than none, because none just leaves the word on its own
score. `-` for every `same` and `unsure`.

Run every subagent in the foreground (`run_in_background: false`), several in
one message for parallelism, and keep going until both output files are
written. This runs headless: the moment your turn ends the run is over, and a
background subagent still working is killed with its verdicts.

Collect every `different` into `scripts/fold-audit/out/daily/flagged.tsv`, tab
separated, with the header `word	base	reason`. A `same` or `unsure` stays folding.

## Pass 2 -- defend

The first pass is a detector, and on the 2026-09-22 audit more than half of what
it flagged was the fold being right (`picometer` -> `meters` flagged "metric
prefix unit"; a picometer is a unit of length). So the flags go to one fresh
subagent told the opposite job, with the prompt in `verify.py`'s `PROMPT`:
defend each fold, and answer `wrong` only when the reviewer is right. Show it
the word, the full path, and the flag's reason.

Where pass 1 proposed a base, also show it, and for every fold still `wrong`
have the subagent say whether the word really is a form of that base: `yes` or
`no`. A `no` drops the base (the word is exempted instead); it does not change
the `wrong`.

Where the two passes disagree, break the tie with a third subagent given the
same defend-the-fold prompt; two of three decides.

## Output

`scripts/fold-audit/out/daily/confirmed.tsv`, tab separated, header
`word	scope	base	reason	verify`, one row per fold that is still `wrong`:

- `base` -- pass 1's base where pass 2 said `yes` to it, else `-`. With a base,
  the workflow scores the word as that base, provided the base already has a
  measured score; without one, or when it has none, the word is exempted and
  scores on its own data. Do not look the score up yourself.

- `reason` -- pass 1's reason, at most 8 words.
- `verify` -- the reviewer's reason, at most 8 words.
- `scope` -- `all`, unless the only wrong hop is a prefix strip (rule `prefix`
  or `prefix-ungated`) *and* the word's other folds would be right; then
  `prefix`. `transferals` is trans- + `ferals` only by accident but really is
  the plural of `transferal`, so it takes `prefix`. Most rows take `all`.
  A `prefix` row keeps the word's other folds, so its `base` is ignored.

Write both files even when they are empty (header only). Change nothing else in
the repository.
