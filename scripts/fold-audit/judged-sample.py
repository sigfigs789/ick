#!/usr/bin/env python3
"""A random sample of the folds that have actually been through the pipeline.

Not the corrections -- the whole judged population, with what happened to each:
what the detector said, what the adversarial review said about the ones it
flagged, and whether an exemption was written. A sample of the corrections shows
the hits; this shows the work, including the 55% of flags that were thrown out.
"""
import argparse, csv, json, pathlib, random, re

LINE = re.compile(r"^\s*(\d+)\s*\|\s*(same|different|unsure)\s*\|\s*(.*?)\s*$", re.I)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="scripts/fold-audit/out")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--seed", type=int, default=214)
    args = ap.parse_args()
    out = pathlib.Path(args.out)

    key = json.load(open(out / "batches2" / "key.json"))
    folds = {}
    with open(out / "folds-deduped.tsv") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            folds[(r["word"], r["base"])] = r

    # What the adversarial pass kept, and what the tables now hold.
    confirmed = {
        (r["word"], r["base"]): r["verify"]
        for r in json.load(open(out / "confirmed-first50k.json"))
    }
    exempt = set(json.loads(pathlib.Path("src/data/fold-exemptions.json").read_text()))

    judged = []
    for path in sorted((out / "verdicts2").glob("batch-*.tsv")):
        expected = key.get(path.stem)
        if not expected:
            continue
        rows = {}
        for line in open(path):
            m = LINE.match(line)
            if m:
                rows[m.group(1)] = (m.group(2).lower(), m.group(3))
        if len(rows) != len(expected):
            continue
        for idx, item in expected.items():
            if item["salt"]:
                continue
            verdict, reason = rows[idx]
            pair = (item["word"], item["base"])
            row = folds.get(pair)
            if not row:
                continue
            if verdict == "same":
                outcome = "kept"
            elif pair in confirmed:
                outcome = "exempted" if item["word"] in exempt else "confirmed, not yet applied"
            elif verdict == "different":
                outcome = "flagged, overturned on review"
            else:
                outcome = "unsure, left alone"
            judged.append({
                "word": item["word"], "base": item["base"], "rule": row["rule"],
                "scoreBefore": row["scoreBefore"], "scoreAfter": row["scoreAfter"],
                "verdict": verdict, "outcome": outcome, "reason": reason,
                "family": item["family"],
            })

    rng = random.Random(args.seed)
    sample = rng.sample(judged, min(args.n, len(judged)))
    covered = sum(int(r["family"]) for r in judged)

    lines = [f"# {len(sample)} folds, drawn at random from everything judged", "",
             f"From the **{len(judged):,}** distinct questions that have been through the",
             f"pipeline, standing for **{covered:,}** of the 229,395 folds in the system.", "",
             "`verdict` is what the detector said. `outcome` is what actually happened —",
             "including the flags an adversarial second pass overturned, which were 55% of",
             "them. A sample of corrections would show only the hits; this shows the work.", "",
             "| # | word | → base | rule | score | verdict | outcome |",
             "| ---: | --- | --- | --- | ---: | --- | --- |"]
    for i, r in enumerate(sample, 1):
        lines.append(f"| {i} | `{r['word']}` | `{r['base']}` | {r['rule']} | "
                     f"{r['scoreBefore']} → {r['scoreAfter']} | {r['verdict']} | {r['outcome']} |")

    tally = {}
    for r in judged:
        tally[r["outcome"]] = tally.get(r["outcome"], 0) + 1
    lines += ["", "---", "", "## What happened across all of them", "",
              "| outcome | questions |", "| --- | ---: |"]
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {k} | {v:,} |")

    (out / "judged-sample.md").write_text("\n".join(lines) + "\n")
    with open(out / "judged-all.tsv", "w") as fh:
        w = csv.DictWriter(fh, fieldnames=list(judged[0].keys()), delimiter="\t")
        w.writeheader()
        w.writerows(judged)
    print(f"{len(judged)} judged questions covering {covered} folds; sampled {len(sample)}")


if __name__ == "__main__":
    main()
