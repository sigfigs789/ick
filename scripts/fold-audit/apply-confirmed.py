#!/usr/bin/env python3
"""Exempt the folds that survived both passes.

Only the confirmed ones. The detector flagged 1,783 and the adversarial review
kept 803: `picometer` -> `meters` was flagged "metric prefix unit, not meters"
and a picometer is a metric unit of length, so 980 of the flags were the
detector being pedantic rather than the fold being wrong. Every exemption is a
promotion -- the word scores rarer afterwards -- so applying an unconfirmed flag
is not a neutral act.

Each entry records both passes' reasoning, because the second one is the reason
the entry exists at all.
"""
import argparse, json, pathlib

SINCE = "2026-10-01"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmed", default="scripts/fold-audit/out/confirmed.json")
    ap.add_argument("--attested", default="scripts/fold-audit/out/attested.txt")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    confirmed = json.load(open(args.confirmed))
    attested = set(pathlib.Path(args.attested).read_text().split())

    p = pathlib.Path("src/data/fold-exemptions.json")
    data = json.loads(p.read_text())
    overrides = set(json.loads(pathlib.Path("src/data/score-overrides.json").read_text()))

    added = skipped_existing = skipped_unattested = skipped_override = 0
    for row in confirmed:
        word = row["word"]
        if word in data:
            skipped_existing += 1
            continue
        # A blanket exemption silences an override, so a word carrying one is
        # left alone rather than given a dead entry -- inflection-scoring.test.ts
        # pins that the two files share no word.
        if word in overrides:
            skipped_override += 1
            continue
        if word not in attested:
            skipped_unattested += 1
            continue
        first = row["reason"].rstrip(". ")
        second = row["verify"].rstrip(". ")
        data[word] = {
            "since": SINCE,
            "reason": (
                f"Folded onto `{row['base']}`, costing {float(row['delta']):.2f} points. "
                f"Flagged in the 2026-09-22 semantic audit ({first}) and confirmed on "
                f"adversarial re-review ({second})."
            ),
        }
        added += 1

    if not args.dry_run:
        p.write_text(json.dumps({k: data[k] for k in sorted(data)}, indent=2) + "\n")
    print(f"exemptions +{added} (now {len(data)})")
    print(f"  skipped: {skipped_existing} already reviewed, {skipped_override} carry an "
          f"override, {skipped_unattested} in neither lexicon")


if __name__ == "__main__":
    main()
