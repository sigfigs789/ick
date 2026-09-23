#!/usr/bin/env python3
"""Score the judge's verdicts: salt calibration first, then the findings.

Calibration comes first because it decides whether the findings mean anything.
The salt pairs are folds the engine really made and a human really overturned,
so a judge that misses them is not reporting a clean fold system -- it is
failing to notice the bugs we already know about.
"""
import argparse, collections, csv, json, pathlib, random, re

LINE = re.compile(r"^\s*(\d+)\s*\|\s*(same|different|unsure)\s*\|\s*(.*?)\s*$", re.I)


def load_verdicts(d: pathlib.Path) -> dict:
    out = {}
    for path in sorted(d.glob("batch-*.tsv")):
        rows = {}
        for line in open(path):
            m = LINE.match(line)
            if m:
                rows[m.group(1)] = (m.group(2).lower(), m.group(3))
        out[path.stem] = rows
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="scripts/fold-audit/out")
    ap.add_argument("--sample", type=int, default=100)
    ap.add_argument("--seed", type=int, default=20260922)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    key = json.load(open(out / "batches" / "key.json"))
    verdicts = load_verdicts(out / "verdicts")
    folds = {(r["word"], r["base"]): r
             for r in csv.DictReader(open(out / "folds.tsv"), delimiter="\t")}

    salt = collections.Counter()
    salt_misses = []
    judged = []
    missing = collections.Counter()

    for batch, rows in verdicts.items():
        expected = key.get(batch, {})
        for idx, item in expected.items():
            got = rows.get(idx)
            if got is None:
                missing[batch] += 1
                continue
            verdict, reason = got
            if item["salt"]:
                want = item["salt"]
                hit = verdict == want
                salt[f"{want}:{'hit' if hit else 'miss'}"] += 1
                if not hit:
                    salt_misses.append((batch, item["word"], item["base"], want, verdict, reason))
                continue
            row = folds.get((item["word"], item["base"]))
            if row:
                judged.append({**row, "verdict": verdict, "reason": reason})

    lines = ["# Fold audit — judge calibration and findings", ""]
    lines.append(f"Batches scored: {len(verdicts)}  ·  real folds judged: {len(judged)}")
    if missing:
        lines.append(f"**Incomplete batches** (missing verdicts): {dict(missing)}")
    lines.append("")

    bad_hit, bad_miss = salt["different:hit"], salt["different:miss"]
    good_hit, good_miss = salt["same:hit"], salt["same:miss"]
    lines += ["## Calibration", ""]
    lines.append("| control | n | judged correctly | rate |")
    lines.append("| --- | ---: | ---: | ---: |")
    if bad_hit + bad_miss:
        lines.append(f"| known-bad folds (must be `different`) | {bad_hit+bad_miss} | {bad_hit} | "
                     f"{100*bad_hit/(bad_hit+bad_miss):.0f}% |")
    if good_hit + good_miss:
        lines.append(f"| known-good folds (must be `same`) | {good_hit+good_miss} | {good_hit} | "
                     f"{100*good_hit/(good_hit+good_miss):.0f}% |")
    lines.append("")
    if salt_misses:
        lines += [
            "Missed controls, listed rather than only counted — a control can itself be",
            "wrong, and a miss the judge repeats across independent batches is evidence",
            "against the control, not against the judge:",
            "",
        ]
        for b, w, base, want, got, why in salt_misses:
            lines.append(f"- `{w}` → `{base}` — wanted **{want}**, got **{got}** ({why}) [{b}]")
        lines.append("")

    by_rule = collections.defaultdict(collections.Counter)
    delta_at_stake = collections.defaultdict(float)
    for r in judged:
        by_rule[r["rule"]][r["verdict"]] += 1
        if r["verdict"] == "different":
            delta_at_stake[r["rule"]] += float(r["delta"])

    lines += ["## Findings by rule", "",
              "| rule | judged | same | different | unsure | wrong % | points at stake |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for rule in sorted(by_rule, key=lambda r: -by_rule[r]["different"]):
        c = by_rule[rule]
        n = sum(c.values())
        lines.append(f"| `{rule}` | {n} | {c['same']} | {c['different']} | {c['unsure']} | "
                     f"{100*c['different']/n:.0f}% | {delta_at_stake[rule]:.0f} |")
    lines.append("")

    flagged = sorted((r for r in judged if r["verdict"] in ("different", "unsure")),
                     key=lambda r: (r["verdict"] != "different", -float(r["delta"])))
    lines += [f"## Flagged folds ({len(flagged)})", "",
              "| word | → base | rule | score | verdict | why |",
              "| --- | --- | --- | ---: | --- | --- |"]
    for r in flagged:
        lines.append(f"| `{r['word']}` | `{r['base']}` | {r['rule']} | "
                     f"{r['scoreBefore']} → {r['scoreAfter']} | {r['verdict']} | {r['reason']} |")
    (out / "fold-review.md").write_text("\n".join(lines) + "\n")

    rng = random.Random(args.seed)
    sample = rng.sample(judged, min(args.sample, len(judged)))
    s = ["# Blind sample — judge these yourself before scrolling down", "",
         "The engine folds each word onto the base shown. Mark each one `same` "
         "(base means the same thing) or `different` (the fold landed on an "
         "unrelated word). The judge's verdicts are at the bottom.", "",
         "| # | word | → base | score |", "| ---: | --- | --- | ---: |"]
    for i, r in enumerate(sample, 1):
        s.append(f"| {i} | `{r['word']}` | `{r['base']}` | {r['scoreBefore']} → {r['scoreAfter']} |")
    s += ["", "---", "", "<details><summary>The judge's verdicts</summary>", "",
          "| # | word | → base | rule | verdict | why |", "| ---: | --- | --- | --- | --- | --- |"]
    for i, r in enumerate(sample, 1):
        s.append(f"| {i} | `{r['word']}` | `{r['base']}` | {r['rule']} | **{r['verdict']}** | {r['reason']} |")
    s += ["", "</details>"]
    (out / "fold-sample.md").write_text("\n".join(s) + "\n")

    print(f"judged {len(judged)} folds, {len(flagged)} flagged")
    print(f"salt: bad {bad_hit}/{bad_hit+bad_miss} caught, good {good_hit}/{good_hit+good_miss} passed")
    print(f"wrote {out}/fold-review.md and {out}/fold-sample.md")


if __name__ == "__main__":
    main()
