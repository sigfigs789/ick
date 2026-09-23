#!/usr/bin/env python3
"""Score the exceptions-only verdicts.

Checks three things before it reports anything: that each batch closed with a
JUDGED count matching its input, that the planted wrong folds were all caught,
and only then what the judge actually found. The first two are what stand in for
the 98% the judge says nothing about.
"""
import argparse, collections, csv, json, pathlib, re

LINE = re.compile(r"^\s*(\d+)\s*\|\s*(same|different|unsure)\s*\|\s*(.*?)\s*$", re.I)
COUNT = re.compile(r"^\s*JUDGED\s+(\d+)\s*$", re.I)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="scripts/fold-audit/out")
    args = ap.parse_args()
    out = pathlib.Path(args.out)

    key = json.load(open(out / "batches2" / "key.json"))
    folds = {}
    with open(out / "folds-deduped.tsv") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            folds[(r["word"], r["base"])] = r

    reported, salt_hit, salt_miss, bad_batches = [], 0, [], []
    judged_questions = judged_folds = 0

    for path in sorted((out / "verdicts2").glob("batch-*.tsv")):
        batch = path.stem
        expected = key.get(batch)
        if not expected:
            continue
        rows, claimed = {}, None
        for line in open(path):
            m = LINE.match(line)
            if m:
                rows[m.group(1)] = (m.group(2).lower(), m.group(3))
                continue
            c = COUNT.match(line)
            if c:
                claimed = int(c.group(1))
        # The verbose protocol answers every row, so the row count is the
        # completeness check and a JUDGED line is not needed. Under the
        # exceptions protocol the count line was the only such check.
        seen = claimed if claimed is not None else len(rows)
        if seen != len(expected):
            bad_batches.append(f"{batch}: answered {seen}, expected {len(expected)}")
            continue
        for idx, item in expected.items():
            if item["salt"]:
                if rows.get(idx, ("", ""))[0] == "different":
                    salt_hit += 1
                else:
                    salt_miss.append(f"{batch}: {item['word']} -> {item['base']}")
                continue
            judged_questions += 1
            judged_folds += int(item["family"])
            got = rows.get(idx)
            if got and got[0] != "same":
                row = folds.get((item["word"], item["base"]))
                reported.append({
                    "word": item["word"], "base": item["base"], "verdict": got[0],
                    "reason": got[1], "family": item["family"],
                    "rule": row["rule"] if row else "?",
                    "delta": row["delta"] if row else "0",
                    "scoreBefore": row["scoreBefore"] if row else "",
                    "scoreAfter": row["scoreAfter"] if row else "",
                })

    diff = [r for r in reported if r["verdict"] == "different"]
    unsure = [r for r in reported if r["verdict"] == "unsure"]
    by_rule = collections.Counter(r["rule"] for r in diff)

    lines = ["# Full-pass findings", "",
             f"Questions judged: **{judged_questions:,}** of 150,972, covering "
             f"**{judged_folds:,}** of 229,395 folds "
             f"({100*judged_folds/229395:.1f}% of the system).", "",
             f"Salt caught: **{salt_hit}/{salt_hit+len(salt_miss)}**.", ""]
    if salt_miss:
        lines += ["Missed controls:", ""] + [f"- {m}" for m in salt_miss] + [""]
    if bad_batches:
        lines += ["**Batches with a bad JUDGED count (excluded):**", ""] + [f"- {b}" for b in bad_batches] + [""]

    lines += [f"Reported wrong: **{len(diff):,}** questions "
              f"({100*len(diff)/max(judged_questions,1):.2f}%), plus {len(unsure):,} unsure.", "",
              "## By rule", "", "| rule | wrong |", "| --- | ---: |"]
    for rule, n in by_rule.most_common():
        lines.append(f"| `{rule}` | {n} |")

    diff.sort(key=lambda r: -float(r["delta"]))
    lines += ["", f"## Every fold reported wrong ({len(diff)})", "",
              "| word | → base | rule | score | why |", "| --- | --- | --- | ---: | --- |"]
    for r in diff:
        lines.append(f"| `{r['word']}` | `{r['base']}` | {r['rule']} | "
                     f"{r['scoreBefore']} → {r['scoreAfter']} | {r['reason']} |")
    (out / "full-pass.md").write_text("\n".join(lines) + "\n")

    with open(out / "full-pass-wrong.tsv", "w") as fh:
        w = csv.DictWriter(fh, fieldnames=list(diff[0].keys()) if diff else ["word"], delimiter="\t")
        w.writeheader()
        w.writerows(diff)

    print(f"judged {judged_questions} questions / {judged_folds} folds; "
          f"wrong {len(diff)}, unsure {len(unsure)}; salt {salt_hit}/{salt_hit+len(salt_miss)}")


if __name__ == "__main__":
    main()
