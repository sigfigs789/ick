#!/usr/bin/env python3
"""Ask Claude to guess a Zipf frequency for every word a puzzle can accept that
no frequency corpus measures, and record the guesses in
src/data/estimated-zipf.json as one batch.

Input is the report scripts/unattested-candidates.mts writes. Every guess is
stored with its provenance -- the model, the Actions run, the drop and the
puzzle date it was made for -- so an estimate can never be mistaken for a
measurement. The game reads the file through `withEstimate` in
src/game/dictionary.ts: from the batch's `since` date on, an estimate stands in
for the unattested sentinel (a flat 10.00 Legend) as the word's own Zipf.

Needs the `anthropic` package and an ANTHROPIC_API_KEY. --dry-run prints the
first request's prompt instead of calling the API.

    python scripts/estimate-zipf.py --candidates .tmp/candidates.json \\
        --run-url https://github.com/... --summary-out .tmp/summary.md
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESTIMATES_PATH = ROOT / "src" / "data" / "estimated-zipf.json"

# A guess outside this range is not a frequency, it is a malformed answer.
ZIPF_MIN, ZIPF_MAX = -3.0, 8.0

SYSTEM_PROMPT = """\
You estimate how often English words are used, for WordInk, a daily word game. \
Players type words that contain the day's letter "drop", and each word scores by \
how rare it is: the rarer the word, the higher the score.

Rarity is measured on the Zipf scale: log10 of a word's frequency per billion \
words of running text. Some reference points:
- 7: "the", "of"
- 5: "people", "house"
- 4: "elephant", "baker"
- 3: "camaraderie", "trowel"
- 2: "obsequious", "bicameral"
- 1: "sesquipedalian", "chamiso"
- 0: "achalasias" -- in published dictionaries, almost never seen in text

The game measures frequency from wordfreq (which stops near Zipf 1), then the \
Google Web 1T unigram counts, then Google Books 1-grams. Every word you will be \
given is missing from all of them, so most of them are very rare: plurals and \
inflections of technical terms, chemical and taxonomic names, obscure \
derivations, regional or historical words, proper names. A few are simply newer \
than those corpora (for example "enshittification", coined 2022, would be about \
Zipf 2.5 today). Words like that deserve a higher estimate than their absence \
from the corpora suggests; everything else belongs below the rarest measured \
words, typically between -1.5 and 1.

Estimate each word's Zipf as it would be measured in a large, current corpus of \
general English (books, news and the web). Judge each word on its own: its \
inflection, its field, and how widely it is used. Return a number with two \
decimals for every word you are given, spelled exactly as given -- never skip \
one, and never add one. A guess is expected; do not refuse a word for being \
obscure or for being a name."""

SCHEMA = {
    "type": "object",
    "properties": {
        "estimates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "zipf": {"type": "number"},
                },
                "required": ["word", "zipf"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["estimates"],
    "additionalProperties": False,
}


def priority(candidate: dict) -> tuple:
    """Sort key for which words get an estimate when a drop reaches more than
    the daily cap: the ones a player is likeliest to type and to see at 10.00.

    1. Still 10.00 in Standard, the default mode (Standard's fold did not move it).
    2. In the curated dictionary, the list the game shipped with.
    3. Vouched for by more lexicons (Wiktionary, macOS, the curated extras).
    4. Shorter, since a short word is more often a word somebody knows.
    """
    sources = candidate["sources"]
    lexicons = sum(1 for s in ("wiktionary", "dictionary", "macos_dict", "curated") if s in sources)
    return (
        0 if "standard" in candidate["modes"] and candidate["standardZipf"] is None else 1,
        0 if "dictionary" in sources else 1,
        -lexicons,
        len(candidate["word"]),
        candidate["word"],
    )


def calibration(report: dict) -> str:
    lines = [f"Measured words containing today's drop {report['drop']}, for calibration:"]
    for anchor in report.get("anchors", []):
        lines.append(f"- {anchor['word']}: {anchor['zipf']:.2f}")
    return "\n".join(lines)


def user_prompt(words: list[dict]) -> str:
    # The lexicons that vouch for each word are context, not a verdict: a word
    # only Wiktionary lists is a different kind of rare from one the curated
    # dictionary has always carried.
    lines = [f"Estimate the Zipf frequency of each of these {len(words)} words:"]
    for c in words:
        lines.append(f"{c['word']} ({', '.join(c['sources'])})")
    return "\n".join(lines)


def ask(client, model: str, effort: str, system: list[dict], words: list[dict]) -> dict[str, float]:
    response = client.messages.create(
        model=model,
        max_tokens=16000,
        system=system,
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": user_prompt(words)}],
    )
    if response.stop_reason == "refusal":
        print(f"  refused a batch of {len(words)} (starting {words[0]['word']})", file=sys.stderr)
        return {}
    if response.stop_reason == "max_tokens":
        print(f"  batch starting {words[0]['word']} hit max_tokens", file=sys.stderr)
        return {}
    text = next(b.text for b in response.content if b.type == "text")
    wanted = {c["word"] for c in words}
    out: dict[str, float] = {}
    for item in json.loads(text)["estimates"]:
        word, zipf = item["word"].strip().lower(), item["zipf"]
        if word in wanted and isinstance(zipf, (int, float)) and math.isfinite(zipf):
            if ZIPF_MIN <= zipf <= ZIPF_MAX:
                out[word] = round(float(zipf), 2)
    return out


def estimate_all(report: dict, model: str, effort: str, batch_size: int, workers: int) -> dict[str, float]:
    import anthropic

    client = anthropic.Anthropic(max_retries=5)
    # The instructions and the day's anchors are the same for every batch, so
    # they are cached once and read back by the rest.
    system = [
        {"type": "text", "text": SYSTEM_PROMPT},
        {"type": "text", "text": calibration(report), "cache_control": {"type": "ephemeral"}},
    ]
    candidates = report["asked"]
    batches = [candidates[i : i + batch_size] for i in range(0, len(candidates), batch_size)]
    results: dict[str, float] = {}

    def run(batch: list[dict]) -> dict[str, float]:
        got = ask(client, model, effort, system, batch)
        # One retry for whatever the first answer left out, on its own.
        missing = [c for c in batch if c["word"] not in got]
        if missing and len(missing) < len(batch):
            got.update(ask(client, model, effort, system, missing))
        return got

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for n, got in enumerate(pool.map(run, batches), 1):
            results.update(got)
            print(f"  batch {n}/{len(batches)}: {len(got)} estimate(s)", file=sys.stderr)
    return results


BANDS = [(-math.inf, -1), (-1, 0), (0, 1), (1, 2), (2, 3), (3, math.inf)]


def summary(report: dict, estimates: dict[str, float], model: str, run_url: str | None) -> str:
    candidates = [c["word"] for c in report["candidates"]]
    asked = [c["word"] for c in report.get("asked", report["candidates"])]
    missing = [w for w in asked if w not in estimates]
    lines = [
        f"Claude ({model}) estimated a Zipf frequency for **{len(estimates)}** of the "
        f"**{len(candidates)}** words the **{report['drop']}** drop on **{report['date']}** "
        "can accept that no frequency corpus measures.",
        "",
        f"The run is capped at {len(asked)} word(s) a day, taken in order: still 10.00 in "
        "Standard, in the curated dictionary, vouched for by more lexicons, shorter. The "
        f"other {len(candidates) - len(asked)} keep the flat 10.00 until the drop comes round again.",
        "",
        "These are guesses, not measurements. They are recorded in `src/data/estimated-zipf.json` "
        "as one batch carrying the model, run and puzzle date, and they apply from that "
        "puzzle on: the word's own Zipf becomes the estimate instead of the unattested "
        "sentinel (a flat 10.00 Legend). Standard still folds on top of it. Accepted words "
        "scored this way are tagged `score_source: estimated` on `answer_accepted` and "
        "fire `estimated_score_used`, which feed the **Claude-estimated scores** section "
        "on /analytics.",
        "",
        f"**Merge before {report['date']}**, or the batch re-prices a puzzle that is "
        "already being played.",
        "",
        "| Estimated Zipf | Words |",
        "| --- | ---: |",
    ]
    for low, high in BANDS:
        n = sum(1 for z in estimates.values() if low <= z < high)
        label = f"< {high}" if low == -math.inf else f">= {low}" if high == math.inf else f"{low} to {high}"
        lines.append(f"| {label} | {n} |")
    top = sorted(estimates.items(), key=lambda kv: -kv[1])[:25]
    lines += ["", "Highest estimates (the words that lose the most of their 10.00):", "", "| Word | Zipf |", "| --- | ---: |"]
    lines += [f"| {w} | {z:.2f} |" for w, z in top]
    if missing:
        shown = ", ".join(missing[:60]) + (" ..." if len(missing) > 60 else "")
        lines += ["", f"No estimate came back for {len(missing)} word(s); they keep the sentinel: {shown}"]
    if run_url:
        lines += ["", f"Run: {run_url}"]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--candidates", required=True, type=Path)
    parser.add_argument("--model", default="claude-opus-5-5")
    parser.add_argument("--effort", default="low", choices=["low", "medium", "high"])
    parser.add_argument("--batch-size", type=int, default=150)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=200, help="estimate at most this many words, by priority()")
    parser.add_argument("--run-url")
    parser.add_argument("--summary-out", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    report = json.loads(args.candidates.read_text())
    count = len(report["candidates"])
    if count == 0:
        print(f"Nothing to estimate for {report['date']} ({report['drop']}).")
        return
    report["asked"] = sorted(report["candidates"], key=priority)[: args.limit]
    if args.dry_run:
        print(SYSTEM_PROMPT, calibration(report), "", user_prompt(report["asked"][: args.batch_size]), sep="\n")
        return

    print(f"Estimating {len(report['asked'])} of {count} word(s) for {report['date']} ({report['drop']}) with {args.model}", file=sys.stderr)
    estimates = estimate_all(report, args.model, args.effort, args.batch_size, args.workers)

    data = json.loads(ESTIMATES_PATH.read_text())
    if estimates:
        data["batches"].append(
            {
                "since": report["date"],
                "drop": report["drop"],
                "model": args.model,
                "source": "claude",
                "run": args.run_url,
                "estimatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "zipf": dict(sorted(estimates.items())),
            }
        )
        ESTIMATES_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    if args.summary_out:
        args.summary_out.write_text(summary(report, estimates, args.model, args.run_url))
    print(f"Recorded {len(estimates)} estimate(s) of {len(report['asked'])} asked ({count} candidates).")


if __name__ == "__main__":
    main()
