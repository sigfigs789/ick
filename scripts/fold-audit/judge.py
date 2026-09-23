#!/usr/bin/env python3
"""Run the fold judge over every batch, through the authenticated CLI.

One `claude -p` call per batch, several at a time, resuming where it left off:
a batch whose verdict file already parses is skipped, so an interrupted run
costs nothing to restart. Every batch is validated before it is accepted -- one
verdict per input row, ids matching -- and retried once if it is not.

Usage:
    python3 scripts/fold-audit/judge.py [--workers 8] [--limit N] [--model ...]

Progress goes to out/judge.log. Score it with score2.py.
"""
import argparse, concurrent.futures, json, pathlib, re, subprocess, sys, threading, time

LINE = re.compile(r"^\s*(\d+)\s*\|\s*(same|different|unsure)\s*\|", re.I)

PROMPT = """You are auditing a word game's scoring rule.

WordInk scores a word by how rare it is. Before scoring it FOLDS the word onto \
its base form and prices it as that base, so `running` is common because `run` \
is. The fold is mechanical -- it strips affixes by spelling rule -- so it can \
land on a word that merely LOOKS like a base.

For each numbered pair below, decide whether the proposed base really is the \
word's base form AND carries the same core meaning.

same = genuine. `running`->`run`, `cats`->`cat`, `overthinkings`->`think` (a long \
mechanical derivation still means thinking), `unhappiness`->`unhappy`, \
`materialnesses`->`material` (rare and ugly is not wrong). Folding onto a plural \
or inflection of the right word is also `same`: `lesionless`->`lesions` is fine.

different = wrong. Either the word is not built on that base, or it is but has \
drifted to an unrelated meaning. `rehearse`->`hearse` (coincidental letters), \
`momser`->`mom` (a Yiddish loanword), `bares`->`bar` (plural of `bare`; the -s \
strip overshot), `undertow`->`tow` (a current, not a towing), `scowly`->`scow` \
(from `scowl`; the -ly strip ate the l), `politic`->`politics` (related root, \
not a form of that word).

unsure = genuinely ambiguous, or you do not know one of the words. Use it rather \
than guessing.

Ask yourself: if a player submitted this word and the game said "scored as its \
common form, X", would they accept it or file a bug? Do not reason about \
frequency. Do not assume a fold is right because the words share letters -- \
sharing letters is how the fold got here.

Output EXACTLY one line per pair, in id order, and nothing else -- no preamble, \
no code fences, no summary:
<id>|<same|different|unsure>|<reason, at most 8 words>

PAIRS (id, word, proposed base):
"""


def parse(text: str, expected: int) -> dict | None:
    rows = {}
    for line in text.splitlines():
        m = LINE.match(line)
        if m:
            rows[m.group(1)] = line.strip()
    return rows if len(rows) == expected else None


def run_batch(path: pathlib.Path, out_dir: pathlib.Path, model: str, log) -> tuple[str, bool]:
    name = path.stem
    dest = out_dir / f"{name}.tsv"
    pairs = [l for l in path.read_text().splitlines() if l.strip()]
    if dest.exists() and parse(dest.read_text(), len(pairs)) is not None:
        return name, True

    body = "\n".join(l.replace("\t", " ") for l in pairs)
    for attempt in (1, 2):
        try:
            res = subprocess.run(
                ["claude", "-p", "--model", model, PROMPT + body],
                capture_output=True, text=True, timeout=900, stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            log(f"{name}: timeout (attempt {attempt})")
            continue
        rows = parse(res.stdout, len(pairs))
        if rows is None:
            log(f"{name}: {len(res.stdout.splitlines())} lines, wanted {len(pairs)} (attempt {attempt})")
            continue
        dest.write_text("\n".join(rows[str(i)] for i in range(1, len(pairs) + 1)) + "\n")
        return name, True
    return name, False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batches", default="scripts/fold-audit/out/batches2")
    ap.add_argument("--out", default="scripts/fold-audit/out/verdicts2")
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    batches = sorted(pathlib.Path(args.batches).glob("batch-*.tsv"))
    if args.limit:
        batches = batches[:args.limit]

    log_path = pathlib.Path("scripts/fold-audit/out/judge.log")
    lock = threading.Lock()
    started = time.time()
    done = failed = 0

    def log(msg: str) -> None:
        with lock:
            with open(log_path, "a") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

    log(f"=== run start: {len(batches)} batches, {args.workers} workers, {args.model}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run_batch, b, out_dir, args.model, log) for b in batches]
        for fut in concurrent.futures.as_completed(futures):
            name, ok = fut.result()
            with lock:
                done += 1
                if not ok:
                    failed += 1
            rate = done / max(time.time() - started, 1) * 60
            log(f"{name}: {'ok' if ok else 'FAILED'}  [{done}/{len(batches)}, "
                f"{rate:.1f}/min, {failed} failed]")

    log(f"=== run end: {done} done, {failed} failed, {(time.time()-started)/60:.1f} min")
    print(f"{done} batches, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
