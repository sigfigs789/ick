#!/usr/bin/env python3
"""Adversarially re-check the folds the judge reported wrong.

The first pass is a detector and detectors have false positives. Measured on the
50k pass, its `measurement` bucket was mostly *not* wrong: "picometer" ->
"meters" was flagged "metric prefix unit, not meters", and a picometer is a
metric unit of length, so the fold was right and the flag was not. Acting on
1,783 flags unchecked would have exempted hundreds of correct folds, and every
one of those is a word scoring rarer than it should.

So the flags get re-read by a reviewer told the opposite job: defend the fold.
Only what survives is applied. The prompt deliberately withholds nothing -- it
shows the original reason -- because the question is whether that reason holds
up, not whether a second judge independently reinvents it.

Usage:
    python3 scripts/fold-audit/verify.py [--workers 8]
"""
import argparse, concurrent.futures, csv, pathlib, re, subprocess, threading, time

LINE = re.compile(r"^\s*(\d+)\s*\|\s*(wrong|fine)\s*\|", re.I)

PROMPT = """A word game folds a word onto its base form and prices it as that \
base, so `running` is scored as common because `run` is. A reviewer has flagged \
the folds below as WRONG -- claiming the base does not mean what the word means.

Your job is the opposite one: defend each fold. Say `wrong` only if the \
reviewer is right and the fold genuinely lands on an unrelated word or a \
different sense. Say `fine` if the fold is defensible.

A fold is `fine` when the word is a real morphological derivative of the base \
and carries its core meaning, even if:
  - the derived term is technical and the base is everyday. `picometer` -> \
`meters` is FINE: a picometer is a metric unit of length. `gibibyte` -> `bytes`, \
`nanomole` -> `mole`, `microsecond` -> `second` are all FINE.
  - the fold lands on a plural or an inflection of the right word. \
`lesionless` -> `lesions` is FINE.
  - the derived word is rare, ugly or unwritten. `materialnesses` -> `material` \
is FINE.
  - a prefix or suffix adds meaning without changing the core. \
`unhappiness` -> `unhappy`, `overthinkings` -> `think` are FINE.

A fold is `wrong` when:
  - the words are unrelated and merely share letters: `rehearse` -> `hearse`, \
`cathole` -> `catholic`, `garle` -> `garlic`.
  - an affix rule overshot a real base: `bares` -> `bar` (it is the plural of \
`bare`), `scowly` -> `scow` (it is from `scowl`).
  - the base is a different word that happens to be spelled the same, whose \
everyday sense is not the word's sense: `kilobar` -> `bar` (the pressure unit \
versus the drinking establishment), `milligray` -> `gray` (the radiation unit, \
named after a person, versus the colour).
  - the derived form's meaning has drifted away from the base: \
`undertow` -> `tow`, `outbreak` -> `break`.

Output EXACTLY one line per item, in id order, nothing else -- no preamble, no \
code fences, no summary:
<id>|<wrong|fine>|<reason, at most 8 words>

ITEMS (id, word, proposed base, the reviewer's objection):
"""


def parse(text, expected):
    rows = {}
    for line in text.splitlines():
        m = LINE.match(line)
        if m:
            rows[m.group(1)] = line.strip()
    return rows if len(rows) == expected else None


def run_batch(idx, items, out_dir, model, log):
    name = f"verify-{idx:03d}"
    dest = out_dir / f"{name}.tsv"
    if dest.exists() and parse(dest.read_text(), len(items)) is not None:
        return name, True
    body = "\n".join(
        f"{i} {r['word']} -> {r['base']} :: {r['reason']}" for i, r in enumerate(items, 1)
    )
    for attempt in (1, 2):
        try:
            res = subprocess.run(
                ["claude", "-p", "--model", model, PROMPT + body],
                capture_output=True, text=True, timeout=900, stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            log(f"{name}: timeout (attempt {attempt})")
            continue
        rows = parse(res.stdout, len(items))
        if rows is None:
            log(f"{name}: {len(res.stdout.splitlines())} lines, wanted {len(items)} (attempt {attempt})")
            continue
        dest.write_text("\n".join(rows[str(i)] for i in range(1, len(items) + 1)) + "\n")
        return name, True
    return name, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wrong", default="scripts/fold-audit/out/full-pass-wrong.tsv")
    ap.add_argument("--out", default="scripts/fold-audit/out/verified")
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--size", type=int, default=250)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.wrong), delimiter="\t"))
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    batches = [rows[i:i + args.size] for i in range(0, len(rows), args.size)]

    log_path = pathlib.Path("scripts/fold-audit/out/verify.log")
    lock = threading.Lock()
    started = time.time()

    def log(msg):
        with lock:
            with open(log_path, "a") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

    log(f"=== verify start: {len(rows)} flags in {len(batches)} batches")
    done = failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run_batch, i, b, out_dir, args.model, log)
                   for i, b in enumerate(batches, 1)]
        for fut in concurrent.futures.as_completed(futures):
            name, ok = fut.result()
            with lock:
                done += 1
                failed += 0 if ok else 1
            log(f"{name}: {'ok' if ok else 'FAILED'} [{done}/{len(batches)}]")
    log(f"=== verify end: {done} done, {failed} failed, {(time.time()-started)/60:.1f} min")
    print(f"{done} batches, {failed} failed")


if __name__ == "__main__":
    main()
