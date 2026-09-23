#!/usr/bin/env python3
"""Batch the deduped population for judging, highest-harm first.

Two differences from make-batches.py, both about cost. The population is the
deduped one -- one question per root-and-base family rather than one per word --
and the protocol is exceptions-only: the judge writes a line for a fold it
thinks is *wrong*, and says nothing about the ones it accepts. Output dominates
the cost of a batch, and on a population that is ~98% correct, saying nothing
about the 98% is most of the saving.

The risk that buys is obvious: silence from a judge that quit early looks
exactly like silence from a judge that approved everything. The salt is what
separates them, so every batch still carries known-bad pairs, and a batch that
misses one is void. The judge must also close with a count, so a truncated
answer is visible rather than silent.
"""
import argparse, csv, json, pathlib, random

KNOWN_BAD = [
    ("momser", "mom"), ("limen", "liman"), ("germen", "german"),
    ("rightsize", "right"), ("laterize", "later"), ("bares", "bar"),
    ("fares", "far"), ("fores", "for"), ("mares", "mar"), ("sires", "sir"),
    ("stares", "star"), ("tares", "tar"), ("wares", "war"), ("doe", "do"),
    ("blee", "bleed"), ("specie", "species"), ("genu", "genus"),
    ("politic", "politics"), ("physic", "physics"), ("scowly", "scow"),
    ("howly", "how"), ("undertow", "tow"), ("outbreak", "break"),
    ("rowses", "row"), ("cytokineses", "cytokines"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", default="scripts/fold-audit/out/folds-deduped.tsv")
    ap.add_argument("--out", default="scripts/fold-audit/out/batches2")
    ap.add_argument("--size", type=int, default=600)
    ap.add_argument("--salt", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=20260922)
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.folds), delimiter="\t"))
    # Highest harm first, so a pass that runs out of budget has still spent it
    # where a wrong fold costs a player the most.
    rows.sort(key=lambda r: -float(r["delta"]))

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("*.tsv")) + list(out.glob("*.json")):
        old.unlink()

    rng = random.Random(args.seed)
    batches = [rows[i:i + args.size] for i in range(0, len(rows), args.size)]
    if args.limit:
        batches = batches[:args.limit]

    key = {}
    for n, batch in enumerate(batches, 1):
        items = [{"word": r["word"], "base": r["base"], "salt": None, "family": r["family"]}
                 for r in batch]
        for word, base in rng.sample(KNOWN_BAD, args.salt):
            items.append({"word": word, "base": base, "salt": "different", "family": "1"})
        rng.shuffle(items)
        name = f"batch-{n:03d}"
        with open(out / f"{name}.tsv", "w") as fh:
            for i, it in enumerate(items, 1):
                fh.write(f"{i}\t{it['word']}\t{it['base']}\n")
        key[name] = {str(i): it for i, it in enumerate(items, 1)}

    json.dump(key, open(out / "key.json", "w"), indent=0)
    covered = sum(int(it["family"]) for b in key.values() for it in b.values() if it["salt"] is None)
    print(f"{len(rows)} questions -> {len(batches)} batches of {args.size}(+{args.salt} salt)")
    print(f"these batches cover {covered} of the 229395 folds")


if __name__ == "__main__":
    main()
