#!/usr/bin/env python3
"""Have Claude guess a Zipf frequency for the words a puzzle can accept that no
frequency corpus measures, and record the guesses in
src/data/estimated-zipf.json as one batch.

Steps around a Claude Code run, so the workflow takes the same credentials
as "Build with Claude" (a CLAUDE_CODE_OAUTH_TOKEN or an ANTHROPIC_API_KEY):

    prepare  picks at most --limit words from scripts/unattested-candidates.mts's
             report (the likeliest to be played first; see `priority`) and
             writes the request Claude reads: instructions, calibration anchors
             and the words.
    record   reads the JSON Claude wrote, keeps only well-formed estimates for
             words it was asked about, and appends them as one batch with their
             provenance -- the model, the Actions run, the drop and the puzzle
             date -- so an estimate can never be mistaken for a measurement.
    summary  writes the PR body: every estimate with the score each mode will
             show (from scripts/estimated-scores.mts, run after `record`),
             Claude's confidence and its one-line reasoning.

`record` keeps only the estimates Claude gave a confidence above MIN_CONFIDENCE
(0.9); the rest appear in the PR but leave the word at the sentinel.

The game reads the file through `withEstimate` in src/game/dictionary.ts: from
the batch's `since` date on, an estimate stands in for the unattested sentinel
(a flat 10.00 Legend) as the word's own Zipf.

    python scripts/estimate-zipf.py prepare --candidates .tmp/candidates.json \
        --asked-out .tmp/asked.json --request-out .tmp/estimate-request.md
    python scripts/estimate-zipf.py record --asked .tmp/asked.json \
        --estimates .tmp/estimates.json --model claude-opus-5-5 --run-url ... \
        --validated-out .tmp/validated.json
    ./node_modules/.bin/vite-node scripts/estimated-scores.mts -- \
        --asked .tmp/asked.json --estimates .tmp/validated.json --out .tmp/scores.json
    python scripts/estimate-zipf.py summary --asked .tmp/asked.json \
        --estimates .tmp/estimates.json --scores .tmp/scores.json \
        --model claude-opus-5-5 --run-url ... --summary-out .tmp/summary.md
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESTIMATES_PATH = ROOT / "src" / "data" / "estimated-zipf.json"

# A guess outside this range is not a frequency, it is a malformed answer.
ZIPF_MIN, ZIPF_MAX = -3.0, 8.0

# Claude is asked for 25 words; this keeps a runaway answer from swamping the
# PR body, which GitHub caps at 65,536 characters.
REASON_MAX = 200
BODY_MAX = 60_000

# Claude rates each estimate from 0 to 1. Only those above this are recorded;
# the rest are shown in the PR and left at the sentinel, to be asked again the
# next time the drop comes round.
MIN_CONFIDENCE = 0.9

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


def word_list(words: list[dict]) -> str:
    # The lexicons that vouch for each word are context, not a verdict: a word
    # only Wiktionary lists is a different kind of rare from one the curated
    # dictionary has always carried.
    lines = [f"Estimate the Zipf frequency of each of these {len(words)} words:", ""]
    for c in words:
        lines.append(f"{c['word']} ({', '.join(c['sources'])})")
    return "\n".join(lines)


BANDS = [(-math.inf, -1), (-1, 0), (0, 1), (1, 2), (2, 3), (3, math.inf)]


def _cell(text: str) -> str:
    """Make `text` safe inside a Markdown table cell."""
    return text.replace("|", "\\|")


def _shown(score: dict | None) -> str:
    return "—" if score is None else f"{score['score']} {score['rarity']}"


TABLE_HEAD = [
    "| Word | Zipf | Standard | Freeform | Confidence | Why |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
]


def _rows(estimates: dict[str, Estimate], scores: dict, reason_max: int) -> list[str]:
    rows = []
    for word, e in sorted(estimates.items(), key=lambda kv: (-kv[1].zipf, kv[0])):
        shown = scores.get(word, {})
        reason = e.reason if len(e.reason) <= reason_max else e.reason[: reason_max - 1].rstrip() + "…"
        rows.append(
            f"| {word} | {e.zipf:.2f} | {_shown(shown.get('standard'))} | "
            f"{_shown(shown.get('freeform'))} | {'—' if e.confidence is None else f'{e.confidence:.2f}'} | "
            f"{_cell(reason) or '—'} |"
        )
    return rows


def summary(
    report: dict, estimates: dict[str, Estimate], scores: dict, model: str, run_url: str | None
) -> str:
    candidates = [c["word"] for c in report["candidates"]]
    asked = [c["word"] for c in report.get("asked", report["candidates"])]
    missing = [w for w in asked if w not in estimates]
    applied = {w: e for w, e in estimates.items() if e.applied}
    held = {w: e for w, e in estimates.items() if not e.applied}
    head = [
        f"Claude ({model}) estimated a Zipf frequency for **{len(estimates)}** of the "
        f"**{len(candidates)}** words the **{report['drop']}** drop on **{report['date']}** "
        "can accept that no frequency corpus measures, and rated its confidence in each. "
        f"Only the **{len(applied)}** with confidence above {MIN_CONFIDENCE} are recorded; the "
        f"other **{len(held)}** are listed below for review and keep the flat 10.00.",
        "",
        f"The run is capped at {len(asked)} word(s) a day, taken in order: still 10.00 in "
        "Standard, in the curated dictionary, vouched for by more lexicons, shorter. The "
        f"other {len(candidates) - len(asked)}, and every word not recorded here, keep the "
        "flat 10.00 and are asked about again when the drop comes round.",
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
        f"**Standard** and **Freeform** below are the score each mode would show on "
        f"{report['date']} with Claude's estimate applied -- for a recorded word, what players "
        "will see once this merges; for the rest, what they would see if it were recorded. "
        "Every one of these words scores 10.00 today, and an estimate at or below the "
        "rarest measured word still does. Computed by the game's own code, so "
        "Standard's fold is included; — means that mode does not accept the word. **Confidence** is "
        "Claude's own probability that the true Zipf is within 0.5 of its estimate, and **Why** "
        "is its reasoning; neither is stored in the data file.",
        "",
        "| Recorded Zipf | Words |",
        "| --- | ---: |",
    ]
    for low, high in BANDS:
        n = sum(1 for e in applied.values() if low <= e.zipf < high)
        label = f"< {high}" if low == -math.inf else f">= {low}" if high == math.inf else f"{low} to {high}"
        head.append(f"| {label} | {n} |")
    tail = []
    if missing:
        tail += ["", f"No estimate came back for {len(missing)} word(s); they keep the sentinel: {', '.join(missing)}"]
    if run_url:
        tail += ["", f"Run: {run_url}"]

    def body(reason_max: int) -> str:
        lines = list(head)
        lines += ["", f"### Recorded: confidence above {MIN_CONFIDENCE} ({len(applied)})", ""]
        lines += TABLE_HEAD + _rows(applied, scores, reason_max) if applied else ["None."]
        lines += [
            "",
            f"### Not recorded: confidence {MIN_CONFIDENCE} or below, or none given ({len(held)})",
            "",
            "Not written to the data file, so these keep their 10.00. The scores shown are "
            "what they would be if the estimate were recorded.",
            "",
        ]
        lines += TABLE_HEAD + _rows(held, scores, reason_max) if held else ["None."]
        return "\n".join(lines + tail) + "\n"

    # Every word stays in the tables; if the body would pass GitHub's limit, the
    # reasons are what give way.
    reason_max = REASON_MAX
    while len(text := body(reason_max)) > BODY_MAX and reason_max > 20:
        reason_max -= 20
    return text


OUTPUT_INSTRUCTIONS = """\
Write your answer to `{out}` as JSON and nothing else, in this shape:

{{"estimates": [{{"word": "chatchke", "zipf": 0.42, "confidence": 0.6, \
"reason": "Rare variant spelling of tchotchke (~Zipf 2); variants run 1-2 lower."}}, ...]}}

One entry per word below, spelled exactly as given, each with:
- `zipf`: your estimate, a number with two decimals.
- `confidence`: how likely it is, from 0 to 1, that the word's true Zipf is \
within 0.5 of your estimate. Only estimates above {min_confidence} are used; the \
rest are shown to a reviewer and the word keeps its 10.00, so be honest rather \
than generous -- a word you cannot place is 0.2, not 0.7.
- `reason`: one sentence, at most 25 words, on what set the number -- the base \
word and its frequency, the field it belongs to, the inflection, a coinage date. \
A reviewer reads it to decide whether to trust the estimate.

Work from what you know; look a word up on the web only when you cannot place \
it at all, and keep that to a handful of words. Do not edit any other file."""


def prepare(args: argparse.Namespace) -> None:
    report = json.loads(args.candidates.read_text())
    asked = sorted(report["candidates"], key=priority)[: args.limit]
    args.asked_out.write_text(json.dumps({**report, "asked": asked}, indent=2) + "\n")
    instructions = OUTPUT_INSTRUCTIONS.format(out=args.estimates_path, min_confidence=MIN_CONFIDENCE)
    request = "\n\n".join([SYSTEM_PROMPT, calibration(report), instructions, word_list(asked)])
    args.request_out.write_text(request + "\n")
    print(f"Asking for {len(asked)} of {report['count']} word(s) for {report['date']} ({report['drop']}).")


@dataclass
class Estimate:
    zipf: float
    # Claude's own account of the guess, for the reviewer only: neither is
    # recorded in src/data/estimated-zipf.json, which ships in the bundle.
    confidence: float | None
    reason: str

    @property
    def applied(self) -> bool:
        return self.confidence is not None and self.confidence > MIN_CONFIDENCE


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def parse_estimates(raw: str, asked: list[dict]) -> dict[str, Estimate]:
    """The estimates Claude wrote, kept only where the Zipf is a finite number in
    range for a word it was asked about. Anything else is dropped, not fixed. A
    missing or out-of-range confidence reads as none at all, so that estimate is
    shown but not applied; a missing reason only blanks that column."""
    wanted = {c["word"] for c in asked}
    out: dict[str, Estimate] = {}
    for item in json.loads(raw).get("estimates", []):
        if not isinstance(item, dict):
            continue
        word, zipf = str(item.get("word", "")).strip().lower(), _number(item.get("zipf"))
        if word not in wanted or zipf is None or not ZIPF_MIN <= zipf <= ZIPF_MAX:
            continue
        confidence = _number(item.get("confidence"))
        if confidence is not None and not 0 <= confidence <= 1:
            confidence = None
        reason = " ".join(str(item.get("reason") or "").split())
        if len(reason) > REASON_MAX:
            reason = reason[: REASON_MAX - 1].rstrip() + "…"
        out[word] = Estimate(round(zipf, 2), confidence, reason)
    return out


def read_estimates(args: argparse.Namespace) -> tuple[dict, dict[str, Estimate]]:
    report = json.loads(args.asked.read_text())
    try:
        return report, parse_estimates(args.estimates.read_text(), report["asked"])
    except (OSError, json.JSONDecodeError) as error:
        sys.exit(f"Could not read Claude's estimates from {args.estimates}: {error}")


def record(args: argparse.Namespace) -> None:
    report, all_estimates = read_estimates(args)
    estimates = {w: e for w, e in all_estimates.items() if e.applied}

    if estimates:
        data = json.loads(ESTIMATES_PATH.read_text())
        data["batches"].append(
            {
                "since": report["date"],
                "drop": report["drop"],
                "model": args.model,
                "source": "claude",
                "run": args.run_url,
                "estimatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "zipf": {w: e.zipf for w, e in sorted(estimates.items())},
            }
        )
        ESTIMATES_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    if args.validated_out:
        # Every well-formed estimate, recorded or not, so estimated-scores.mts can
        # show what each word would score with its estimate applied.
        validated = {w: e.zipf for w, e in sorted(all_estimates.items())}
        args.validated_out.write_text(json.dumps(validated, indent=2) + "\n")
    print(
        f"Recorded {len(estimates)} estimate(s) with confidence above {MIN_CONFIDENCE} of {len(all_estimates)} returned, "
        f"{len(report['asked'])} asked ({report['count']} candidates)."
    )


def write_summary(args: argparse.Namespace) -> None:
    report, estimates = read_estimates(args)
    scores = json.loads(args.scores.read_text())
    args.summary_out.write_text(summary(report, estimates, scores, args.model, args.run_url))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="step", required=True)

    p = sub.add_parser("prepare", help="pick the words and write Claude's request")
    p.add_argument("--candidates", required=True, type=Path)
    p.add_argument("--limit", type=int, default=200, help="estimate at most this many words, by priority()")
    p.add_argument("--asked-out", required=True, type=Path)
    p.add_argument("--request-out", required=True, type=Path)
    p.add_argument("--estimates-path", default=".tmp/estimates.json", help="where Claude is told to write")

    r = sub.add_parser("record", help="validate Claude's answer and append it as a batch")
    r.add_argument("--asked", required=True, type=Path)
    r.add_argument("--estimates", required=True, type=Path)
    r.add_argument("--validated-out", type=Path, help="write every well-formed estimate as {word: zipf}")
    r.add_argument("--model", required=True)
    r.add_argument("--run-url")

    m = sub.add_parser("summary", help="write the PR body: every estimate with its score and reasoning")
    m.add_argument("--asked", required=True, type=Path)
    m.add_argument("--estimates", required=True, type=Path)
    m.add_argument("--scores", required=True, type=Path, help="scripts/estimated-scores.mts's output")
    m.add_argument("--model", required=True)
    m.add_argument("--run-url")
    m.add_argument("--summary-out", required=True, type=Path)

    args = parser.parse_args()
    {"prepare": prepare, "record": record, "summary": write_summary}[args.step](args)


if __name__ == "__main__":
    main()
