#!/usr/bin/env python3
"""Split folds.tsv into judge batches, each salted with known answers.

The salt is the point of the file. A judge that waves everything through and a
fold system with no semantic bugs produce the same report, and the only way to
tell them apart is to hide pairs whose answer is already known in with the real
ones. The known-bad pairs are not invented: every one is a fold the engine
really made and a human really overturned, read out of the `reason` fields in
fold-exemptions.json. They are the exact bug class this audit is hunting.
"""
import argparse, csv, json, pathlib, random

# Word -> the wrong base the rule found, from fold-exemptions.json reasons.
KNOWN_BAD = [
    ("momser", "mom"), ("limen", "liman"), ("germen", "german"),
    ("rightsize", "right"), ("laterize", "later"), ("bares", "bar"),
    ("fares", "far"), ("fores", "for"), ("mares", "mar"), ("sires", "sir"),
    ("stares", "star"), ("tares", "tar"), ("wares", "war"), ("doe", "do"),
    ("morn", "morning"), ("blee", "bleed"), ("specie", "species"),
    ("genu", "genus"), ("politic", "politics"), ("physic", "physics"),
]

# Folds the engine makes that are plainly right -- the other half of the check.
KNOWN_GOOD = [
    ("running", "run"), ("overthinkings", "think"), ("abaci", "abacus"),
    ("materialnesses", "material"), ("cleanses", "clean"), ("walked", "walk"),
    ("happiest", "happy"), ("cats", "cat"), ("rehearsals", "rehearsal"),
    ("unhappiness", "unhappy"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", default="scripts/fold-audit/out/folds.tsv")
    ap.add_argument("--out", default="scripts/fold-audit/out/batches")
    ap.add_argument("--size", type=int, default=250, help="real pairs per batch")
    ap.add_argument("--salt", type=int, default=10, help="salt pairs per batch")
    ap.add_argument("--limit", type=int, default=0, help="stop after N batches")
    ap.add_argument("--seed", type=int, default=20260922)
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.folds), delimiter="\t"))
    rng = random.Random(args.seed)
    # Shuffled, so one batch is never all one rule: a judge that has seen forty
    # -ness strips in a row is being asked a different question than the audit
    # meant to ask, and batch-level rates stay comparable to each other.
    rng.shuffle(rows)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.tsv"):
        old.unlink()
    for old in out.glob("*.json"):
        old.unlink()

    batches = [rows[i:i + args.size] for i in range(0, len(rows), args.size)]
    if args.limit:
        batches = batches[:args.limit]

    key = {}
    for n, batch in enumerate(batches, 1):
        items = [{"word": r["word"], "base": r["base"], "salt": None} for r in batch]
        half = max(1, args.salt // 2)
        for word, base in rng.sample(KNOWN_BAD, half):
            items.append({"word": word, "base": base, "salt": "different"})
        for word, base in rng.sample(KNOWN_GOOD, args.salt - half):
            items.append({"word": word, "base": base, "salt": "same"})
        rng.shuffle(items)

        name = f"batch-{n:03d}"
        with open(out / f"{name}.tsv", "w") as fh:
            for i, it in enumerate(items, 1):
                fh.write(f"{i}\t{it['word']}\t{it['base']}\n")
        key[name] = {str(i): it for i, it in enumerate(items, 1)}

    json.dump(key, open(out / "key.json", "w"), indent=0)
    print(f"{len(rows)} folds -> {len(batches)} batches of {args.size}(+{args.salt} salt) in {out}")


if __name__ == "__main__":
    main()
