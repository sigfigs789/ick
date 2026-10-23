#!/usr/bin/env python3
"""Apply a multi-day fold check's verdicts, one puzzle at a time, oldest first.

plan-batch.py assigned every word to the earliest puzzle it comes up on, and the
judges wrote one flagged.tsv and one confirmed.tsv for the whole batch. This
splits those back out by puzzle and runs the daily pipeline on each --
price-bases.ts, apply-daily.py, daily-report.ts -- so every fix is dated from
the first puzzle a player could meet it on, exactly as a daily run would date it.

    python3 scripts/fold-audit/apply-batch.py \
        --flagged out/batch/flagged.tsv --confirmed out/batch/confirmed.tsv

Expects scripts/fold-audit/out/folds.tsv (the batch's dump) and
out/batch/todo.tsv. Writes out/batch/reports/<date>.md, each puzzle's table,
out/batch/pr-body.md, the summary, and out/batch/applied.txt.
"""
import argparse, csv, pathlib, shutil, subprocess

OUT = pathlib.Path("scripts/fold-audit/out")
DAILY = OUT / "daily"
BATCH = OUT / "batch"
VITE_NODE = "./node_modules/.bin/vite-node"


def read_tsv(path: pathlib.Path) -> tuple[list[str], list[dict]]:
    if not path.exists():
        return [], []
    with path.open(newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        return list(reader.fieldnames or []), list(reader)


def write_tsv(path: pathlib.Path, header: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        f.write("\t".join(header) + "\n")
        f.writelines("\t".join(r.get(k, "") for k in header) + "\n" for r in rows)


def lines(path: pathlib.Path) -> list[str]:
    return [l for l in path.read_text().split("\n") if l] if path.exists() else []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flagged", default=str(BATCH / "flagged.tsv"))
    ap.add_argument("--confirmed", default=str(BATCH / "confirmed.tsv"))
    args = ap.parse_args()

    _, todo = read_tsv(BATCH / "todo.tsv")
    puzzle = {r["word"]: r["date"] for r in todo}
    _, folds = read_tsv(OUT / "folds.tsv")
    flagged_header, flagged = read_tsv(pathlib.Path(args.flagged))
    confirmed_header, confirmed = read_tsv(pathlib.Path(args.confirmed))
    if not confirmed_header:
        raise SystemExit(f"{args.confirmed} is missing: the judging did not finish.")
    flagged_header = flagged_header or ["word", "base", "reason"]

    dates = sorted({r["date"] for r in folds})
    drops = {r["date"]: r["drop"] for r in folds}
    reports = BATCH / "reports"
    shutil.rmtree(reports, ignore_errors=True)
    reports.mkdir(parents=True)

    summary: list[str] = []
    all_applied: list[str] = []
    totals = [0, 0, 0, 0, 0]
    for date in dates:
        mine = lambda rows: [r for r in rows if puzzle.get(r["word"].strip().lower()) == date]
        write_tsv(DAILY / "flagged.tsv", flagged_header, mine(flagged))
        write_tsv(DAILY / "confirmed.tsv", confirmed_header, mine(confirmed))
        for stale in ("applied.txt", "redirected.txt", "bases.tsv", "pr-body.md"):
            (DAILY / stale).unlink(missing_ok=True)

        subprocess.run([VITE_NODE, "scripts/fold-audit/price-bases.ts", "--", date], check=True)
        subprocess.run(["python3", "scripts/fold-audit/apply-daily.py", "--date", date], check=True)
        applied = lines(DAILY / "applied.txt")
        if applied:
            # A fresh process, so the engine reads the entries just written.
            subprocess.run([VITE_NODE, "scripts/fold-audit/daily-report.ts", "--", date], check=True)
            shutil.copy(DAILY / "pr-body.md", reports / f"{date}.md")
        all_applied += applied

        row = [
            sum(r["date"] == date for r in folds),
            sum(v == date for v in puzzle.values()),
            len(mine(flagged)),
            len(applied),
            len(lines(DAILY / "redirected.txt")),
        ]
        totals = [a + b for a, b in zip(totals, row)]
        summary.append(f"| {date} | `{drops[date]}` | " + " | ".join(f"{n:,}" for n in row) + " |")

    (BATCH / "applied.txt").write_text("".join(f"{w}\n" for w in all_applied))
    body = [
        f"Fold check for the **{dates[0]}** to **{dates[-1]}** puzzles, Standard mode.",
        "",
        "Every playable answer whose fold lowers its score was dumped for each puzzle. A word "
        "that comes up on several puzzles was judged once, on the earliest, and a word an "
        "already-checked puzzle judged on the same fold was not judged again. Each fold was "
        "judged against RUBRIC.md, every flag was defended by a fresh reviewer, and a third "
        "broke disagreements. Fixes are dated from the puzzle the word was judged on, so "
        "earlier puzzles keep their scores.",
        "",
        f"**{totals[3]:,} folds fixed:** {totals[4]:,} now score as their real base "
        f"(`fold-review-verdicts.json`) and {totals[3] - totals[4]:,} are exempted "
        f"(`fold-exemptions.json`). {totals[2]:,} were flagged and {totals[1]:,} judged.",
        "",
        "| puzzle | drop | folds | judged here | flagged | fixed | of which redirected |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        *summary,
        "",
        "Each puzzle's table -- every word, its fold, the fix, and its score before and "
        "after -- is in the comments below.",
    ]
    (BATCH / "pr-body.md").write_text("\n".join(body) + "\n")
    print(f"{totals[3]} applied ({totals[4]} redirected) across {len(dates)} puzzles")


if __name__ == "__main__":
    main()
