#!/usr/bin/env python3
"""Split a multi-day fold dump into the questions still worth asking.

The fold check judges several puzzles at once (daily-fold-check.yml, two weeks a
run). Their drops share most of their words -- `AC` and `SI` both reach
`acquisitions` -- and a word the check already judged on an earlier puzzle, on
the same fold, needs no second look. So this keeps each word once, on the
earliest puzzle it comes up on in the batch, and drops it altogether when an
already-checked puzzle's dump holds the same word folding along the same path.

    python3 scripts/fold-audit/plan-batch.py \
        --folds out/folds.tsv --checked out/folds-checked.tsv \
        --shard-rows 3000 --chunk-rows 250

Writes, under scripts/fold-audit/out/batch/:
  - todo.tsv: `date	word`, every word left to judge and the puzzle it is
    judged (and later fixed) on;
  - shards/NN/chunk-MM.txt: the rows in DAILY.md's input format, `chunk-rows` to
    a chunk and `shard-rows` to a shard, so each shard is one headless Claude run;
  - shards.json: the shard names, for the workflow's job matrix.
"""
import argparse, csv, json, pathlib, shutil

OUT = pathlib.Path("scripts/fold-audit/out")


def read_tsv(path: pathlib.Path) -> list[dict]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", default=str(OUT / "folds.tsv"))
    ap.add_argument("--checked", help="a dump of puzzles already checked; optional")
    ap.add_argument("--shard-rows", type=int, default=3000)
    ap.add_argument("--chunk-rows", type=int, default=250)
    ap.add_argument("--out", default=str(OUT / "batch"))
    args = ap.parse_args()

    judged = set()
    if args.checked and pathlib.Path(args.checked).exists():
        judged = {(r["word"], r["path"]) for r in read_tsv(pathlib.Path(args.checked))}

    seen: set[str] = set()
    todo: list[dict] = []
    # The dump is in date order, so the first row for a word is its earliest puzzle.
    for row in read_tsv(pathlib.Path(args.folds)):
        if row["word"] in seen:
            continue
        seen.add(row["word"])
        if (row["word"], row["path"]) not in judged:
            todo.append(row)

    out = pathlib.Path(args.out)
    shutil.rmtree(out / "shards", ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    with (out / "todo.tsv").open("w") as f:
        f.write("date\tword\n")
        f.writelines(f"{r['date']}\t{r['word']}\n" for r in todo)

    shards: list[str] = []
    for s in range(0, len(todo), args.shard_rows):
        name = f"{len(shards):02d}"
        shards.append(name)
        rows = todo[s : s + args.shard_rows]
        folder = out / "shards" / name
        folder.mkdir(parents=True)
        for c in range(0, len(rows), args.chunk_rows):
            with (folder / f"chunk-{c // args.chunk_rows:02d}.txt").open("w") as f:
                f.writelines(
                    "|".join([r["word"], r["path"], r["scoreAfter"], r["scoreBefore"], r["rule"]]) + "\n"
                    for r in rows[c : c + args.chunk_rows]
                )
    (out / "shards.json").write_text(json.dumps(shards) + "\n")

    print(f"{len(seen)} distinct words, {len(seen) - len(todo)} already judged, {len(todo)} to judge in {len(shards)} shards")


if __name__ == "__main__":
    main()
