#!/usr/bin/env python3
"""Exempt the folds the daily check confirmed wrong, from that puzzle on.

The daily fold check (.github/workflows/daily-fold-check.yml, procedure in
DAILY.md) dumps every score-lowering fold a player can reach on one puzzle's
drop, has Claude flag the ones that land on a word of a different meaning, and
has a second, adversarial pass defend each flag. This writes what survived both
into fold-exemptions.json, dated from that puzzle, so every earlier puzzle keeps
the score its players saw.

Only words the dump actually holds are applied -- a verdict naming a word the
dump never surfaced is a judge error, not a finding -- and a word already in
fold-exemptions.json, score-overrides.json or fold-review-verdicts.json is left
alone: a word must be in at most one of those tables, and a test pins it.

Usage:
    python3 scripts/fold-audit/apply-daily.py --date 2026-10-08 [--dry-run]
"""
import argparse, csv, json, pathlib, sys

OUT = pathlib.Path("scripts/fold-audit/out")
EXEMPTIONS = pathlib.Path("src/data/fold-exemptions.json")
OVERRIDES = pathlib.Path("src/data/score-overrides.json")
REVIEW_VERDICTS = pathlib.Path("src/data/fold-review-verdicts.json")


def read_tsv(path: pathlib.Path) -> list[dict]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="the puzzle date the dump was made for")
    ap.add_argument("--folds", default=str(OUT / "folds.tsv"))
    ap.add_argument("--confirmed", default=str(OUT / "daily" / "confirmed.tsv"))
    ap.add_argument("--applied-out", default=str(OUT / "daily" / "applied.txt"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    folds = {r["word"]: r for r in read_tsv(pathlib.Path(args.folds)) if r["date"] == args.date}
    confirmed_path = pathlib.Path(args.confirmed)
    # Claude writes confirmed.tsv even when it is empty, so a missing file means
    # the judging never finished -- not that every fold was right.
    if not confirmed_path.exists():
        raise SystemExit(f"{confirmed_path} is missing: the judge did not finish, so nothing was checked.")
    confirmed = read_tsv(confirmed_path)

    data = json.loads(EXEMPTIONS.read_text())
    taken = set(json.loads(OVERRIDES.read_text())) | set(json.loads(REVIEW_VERDICTS.read_text()))

    applied: list[str] = []
    skipped: list[str] = []
    for row in confirmed:
        word = row["word"].strip().lower()
        fold = folds.get(word)
        if fold is None:
            skipped.append(f"{word}: not in the {args.date} dump")
            continue
        if word in data or word in taken:
            skipped.append(f"{word}: already has an entry in a scoring table")
            continue
        scope = row.get("scope", "").strip()
        if scope not in ("", "all", "prefix"):
            skipped.append(f"{word}: unknown scope {scope!r}")
            continue
        path = " > ".join(fold["path"].split(">"))
        entry = {
            "since": args.date,
            "reason": (
                f"Folded onto `{fold['base']}` ({path}), costing {float(fold['delta']):.2f} points. "
                f"Flagged by the daily fold check for the {args.date} `{fold['drop']}` drop "
                f"({row['reason'].strip().rstrip('. ')}) and confirmed on adversarial re-review "
                f"({row['verify'].strip().rstrip('. ')})."
            ),
        }
        if scope == "prefix":
            entry["scope"] = "prefix"
        data[word] = entry
        applied.append(word)

    if not args.dry_run:
        EXEMPTIONS.write_text(json.dumps({k: data[k] for k in sorted(data)}, indent=2) + "\n")
        out = pathlib.Path(args.applied_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("".join(f"{w}\n" for w in applied))

    print(f"exemptions +{len(applied)} (now {len(data)})")
    for line in skipped:
        print(f"  skipped {line}", file=sys.stderr)


if __name__ == "__main__":
    main()
