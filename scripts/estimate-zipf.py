#!/usr/bin/env python3
"""Have Claude guess a Zipf frequency for the words a puzzle can accept that no
frequency corpus measures, and record the guesses in
src/data/estimated-zipf.json as one batch.

Steps around Claude Code runs, so the workflow takes the same credentials as
"Build with Claude" (a CLAUDE_CODE_OAUTH_TOKEN):

    prepare  picks at most --limit words from scripts/unattested-candidates.mts's
             report (the likeliest to be played first; see `priority`) and
             writes one request per --chunk-size words for Claude to read:
             instructions, calibration anchors and the words.
    record   reads the JSON files Claude wrote, keeps only well-formed estimates
             for words it was asked about, and appends them as one batch with
             their provenance -- the model, the Actions run, the drops and the
             puzzle date -- so an estimate can never be mistaken for a
             measurement.
    summary  writes the PR body: what was estimated, then the words to review --
             every one when they fit, otherwise a sample of 100 -- each with the
             score Standard and Freeform will show (from
             scripts/estimated-scores.mts, run after `record`) and Claude's
             one-line reasoning. When the body cannot hold every word, the full
             list goes to --comments-dir, one file per PR comment.

The game reads the file through `withEstimate` in src/game/dictionary.ts: from
the batch's `since` date on, an estimate stands in for the unattested sentinel
(a flat 10.00 Legend) as the word's own Zipf.

    python scripts/estimate-zipf.py prepare --candidates .tmp/candidates.json \
        --asked-out .tmp/asked.json --requests-dir .tmp/requests --answers-dir .tmp/answers
    python scripts/estimate-zipf.py record --asked .tmp/asked.json \
        --estimates .tmp/answers/*.json --model claude-opus-5-5 --run-url ...
    ./node_modules/.bin/vite-node scripts/estimated-scores.mts -- \
        --asked .tmp/asked.json --out .tmp/scores.json
    python scripts/estimate-zipf.py summary --asked .tmp/asked.json \
        --estimates .tmp/answers/*.json --scores .tmp/scores.json \
        --model claude-opus-5-5 --run-url ... --summary-out .tmp/summary.md \
        --comments-dir .tmp/comments
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESTIMATES_PATH = ROOT / "src" / "data" / "estimated-zipf.json"

# A guess outside this range is not a frequency, it is a malformed answer.
ZIPF_MIN, ZIPF_MAX = -3.0, 8.0

# Claude is asked for 25 words; this keeps a runaway answer from swamping the
# PR, whose body and comments GitHub caps at 65,536 characters each.
REASON_MAX = 200
BODY_MAX = 60_000

# What the PR body shows when every word will not fit: the words that fall
# furthest from 10.00, then an even spread across the Zipf bands.
SAMPLE_SIZE = 100
SAMPLE_TOP = 20

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

OUTPUT_INSTRUCTIONS = """\
Write your answer to `{out}` as JSON and nothing else, in this shape:

{{"estimates": [{{"word": "chatchke", "zipf": 0.42, \
"reason": "Rare variant spelling of tchotchke (~Zipf 2); variants run 1-2 lower."}}, ...]}}

One entry per word below, spelled exactly as given, each with:
- `zipf`: your estimate, a number with two decimals.
- `reason`: one sentence, at most 25 words, on what set the number -- the base \
word and its frequency, the field it belongs to, the inflection, a coinage date. \
A reviewer reads it to decide whether to trust the estimate.

Work from what you know; look a word up on the web only when you cannot place \
it at all, and keep that to a handful of words. Do not edit any other file."""


def priority(candidate: dict) -> tuple:
    """Sort key for which words get an estimate when there are more than the
    cap: the ones a player is likeliest to type and to see at 10.00.

    1. Already played at 10.00 (the sweep's --words list).
    2. Still 10.00 in Standard, the default mode (Standard's fold did not move it).
    3. In the curated dictionary, the list the game shipped with.
    4. Vouched for by more lexicons (Wiktionary, macOS, the curated extras).
    5. Shorter, since a short word is more often a word somebody knows.
    """
    sources = candidate["sources"]
    lexicons = sum(1 for s in ("wiktionary", "dictionary", "macos_dict", "curated") if s in sources)
    return (
        0 if candidate.get("played") else 1,
        0 if "standard" in candidate["modes"] and candidate["standardZipf"] is None else 1,
        0 if "dictionary" in sources else 1,
        -lexicons,
        len(candidate["word"]),
        candidate["word"],
    )


def calibration(report: dict) -> str:
    lines = [f"Measured words containing the drops {report['drop']}, for calibration:"]
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


def prepare(args: argparse.Namespace) -> None:
    report = json.loads(args.candidates.read_text())
    asked = sorted(report["candidates"], key=priority)[: args.limit]
    args.asked_out.write_text(json.dumps({**report, "asked": asked}, indent=2) + "\n")
    args.requests_dir.mkdir(parents=True, exist_ok=True)
    chunks = [asked[i : i + args.chunk_size] for i in range(0, len(asked), args.chunk_size)]
    for n, chunk in enumerate(chunks, 1):
        out = args.answers_dir / f"answer-{n:03d}.json"
        instructions = OUTPUT_INSTRUCTIONS.format(out=out)
        request = "\n\n".join([SYSTEM_PROMPT, calibration(report), instructions, word_list(chunk)])
        (args.requests_dir / f"request-{n:03d}.md").write_text(request + "\n")
    print(
        f"Asking for {len(asked)} of {report['count']} word(s) from {report['date']} "
        f"({report['drop']}) in {len(chunks)} request(s)."
    )


@dataclass
class Estimate:
    zipf: float
    # Claude's account of the guess, for the reviewer only: it is not recorded
    # in src/data/estimated-zipf.json, which ships in the bundle.
    reason: str


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def parse_estimates(raw: str, asked: list[dict]) -> dict[str, Estimate]:
    """The estimates Claude wrote, kept only where the Zipf is a finite number in
    range for a word it was asked about. Anything else is dropped, not fixed. A
    missing reason only blanks that column."""
    wanted = {c["word"] for c in asked}
    out: dict[str, Estimate] = {}
    for item in json.loads(raw).get("estimates", []):
        if not isinstance(item, dict):
            continue
        word, zipf = str(item.get("word", "")).strip().lower(), _number(item.get("zipf"))
        if word not in wanted or zipf is None or not ZIPF_MIN <= zipf <= ZIPF_MAX:
            continue
        reason = " ".join(str(item.get("reason") or "").split())
        if len(reason) > REASON_MAX:
            reason = reason[: REASON_MAX - 1].rstrip() + "…"
        out[word] = Estimate(round(zipf, 2), reason)
    return out


def read_estimates(args: argparse.Namespace) -> tuple[dict, dict[str, Estimate]]:
    """Every answer file's estimates together. A file that is missing or is not
    JSON -- a request Claude never finished -- is reported and skipped; its words
    come out as having no estimate."""
    report = json.loads(args.asked.read_text())
    estimates: dict[str, Estimate] = {}
    for path in args.estimates:
        try:
            estimates.update(parse_estimates(path.read_text(), report["asked"]))
        except (OSError, json.JSONDecodeError, AttributeError) as error:
            print(f"::warning::Skipping {path}: {error}", file=sys.stderr)
    return report, estimates


def record(args: argparse.Namespace) -> None:
    report, estimates = read_estimates(args)
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
    print(f"Recorded {len(estimates)} estimate(s) of {len(report['asked'])} asked ({report['count']} candidates).")


BANDS = [(-math.inf, -1), (-1, 0), (0, 1), (1, 2), (2, 3), (3, math.inf)]


def _band(zipf: float) -> int:
    return next(i for i, (low, high) in enumerate(BANDS) if low <= zipf < high)


def _band_label(low: float, high: float) -> str:
    return f"< {high}" if low == -math.inf else f">= {low}" if high == math.inf else f"{low} to {high}"


def _cell(text: str) -> str:
    """Make `text` safe inside a Markdown table cell."""
    return text.replace("|", "\\|")


def _shown(score: dict | None) -> str:
    return "—" if score is None else f"{score['score']} {score['rarity']}"


def _ranked(estimates: dict[str, Estimate]) -> list[tuple[str, Estimate]]:
    """Highest Zipf first: the words that lose the most of their 10.00."""
    return sorted(estimates.items(), key=lambda kv: (-kv[1].zipf, kv[0]))


def _table(rows: list[tuple[str, Estimate]], scores: dict, played: set[str], reason_max: int) -> list[str]:
    lines = [
        "| Word | Zipf | Standard | Freeform | Why |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for word, e in rows:
        shown = scores.get(word, {})
        reason = e.reason if len(e.reason) <= reason_max else e.reason[: reason_max - 1].rstrip() + "…"
        mark = " ★" if word in played else ""
        lines.append(
            f"| {word}{mark} | {e.zipf:.2f} | {_shown(shown.get('standard'))} | "
            f"{_shown(shown.get('freeform'))} | {_cell(reason) or '—'} |"
        )
    return lines


def sample(estimates: dict[str, Estimate], seed: str, size: int = SAMPLE_SIZE) -> list[tuple[str, Estimate]]:
    """The words to review when there are too many to read: the SAMPLE_TOP that
    fall furthest from 10.00, then the rest of `size` spread evenly across the
    Zipf bands -- a band too small for its share gives the rest to the others.
    Seeded by the batch, so the same run always samples the same words."""
    ranked = _ranked(estimates)
    if len(ranked) <= size:
        return ranked
    picked = ranked[:SAMPLE_TOP]
    rng = random.Random(seed)
    pools = [[kv for kv in ranked[SAMPLE_TOP:] if _band(kv[1].zipf) == i] for i in range(len(BANDS))]
    for pool in pools:
        rng.shuffle(pool)
    while len(picked) < size and any(pools):
        for pool in pools:
            if pool and len(picked) < size:
                picked.append(pool.pop())
    return sorted(picked, key=lambda kv: (-kv[1].zipf, kv[0]))


def summary(
    report: dict, estimates: dict[str, Estimate], scores: dict, model: str, run_url: str | None
) -> tuple[str, list[str]]:
    """The PR body and the comments that carry the full list when the body
    cannot (none when it can)."""
    candidates = report["candidates"]
    asked = [c["word"] for c in report.get("asked", candidates)]
    missing = [w for w in asked if w not in estimates]
    played = {c["word"] for c in report.get("asked", candidates) if c.get("played")}
    days = report.get("days", 1)
    scope = (
        f"the **{report['drop']}** drop on **{report['date']}**"
        if days == 1
        else f"the **{days}** puzzles from **{report['date']}** (drops {report['drop']})"
    )
    if report.get("played"):
        scope += ", plus words players have already banked at 10.00,"
    head = [
        f"Claude ({model}) estimated a Zipf frequency for **{len(estimates)}** of the "
        f"**{len(candidates)}** words {scope} can accept that no frequency corpus measures.",
        "",
        f"The run is capped at {len(asked)} word(s), taken in order: already played at 10.00, "
        "still 10.00 in Standard, in the curated dictionary, vouched for by more lexicons, "
        f"shorter. The other {len(candidates) - len(asked)} keep the flat 10.00 for now.",
        "",
        "These are guesses, not measurements. They are recorded in `src/data/estimated-zipf.json` "
        "as one batch carrying the model, run and puzzle date, and they apply from "
        f"**{report['date']}** on: the word's own Zipf becomes the estimate instead of the "
        "unattested sentinel (a flat 10.00 Legend). Standard still folds on top of it. Accepted "
        "words scored this way are tagged `score_source: estimated` on `answer_accepted` and "
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
        n = sum(1 for e in estimates.values() if low <= e.zipf < high)
        head.append(f"| {_band_label(low, high)} | {n} |")
    columns = (
        f"**Standard** and **Freeform** are the score each mode will show on {report['date']} "
        "once this merges, computed by the game's own code, so Standard's fold is included; "
        "— means that mode does not accept the word. Every one of these words scores 10.00 "
        "today, and an estimate at or below the rarest measured word still does. **Why** is "
        "Claude's reasoning, which is not stored in the data file."
        + (" ★ marks a word players have already banked at 10.00." if played else "")
    )
    tail = []
    if missing:
        tail += ["", f"No estimate came back for {len(missing)} word(s); they keep the sentinel: {', '.join(missing)}"]
    if run_url:
        tail += ["", f"Run: {run_url}"]

    ranked = _ranked(estimates)
    full = "\n".join(head + ["", columns, ""] + _table(ranked, scores, played, REASON_MAX) + tail) + "\n"
    if len(full) <= BODY_MAX:
        return full, []

    # Too many words for one body: review a sample here, read the rest below.
    picked = sample(estimates, f"{report['date']}:{report['drop']}")
    if len(missing) > 200:
        tail[1:2] = [f"No estimate came back for {len(missing)} word(s); they keep the sentinel."]
    body = "\n".join(
        head
        + [
            "",
            f"### A sample of {len(picked)} to review",
            "",
            f"The {SAMPLE_TOP} highest estimates, then the rest spread evenly across the bands "
            "above. Every word is in the comments below, highest first.",
            "",
            columns,
            "",
        ]
        + _table(picked, scores, played, REASON_MAX)
        + tail
    ) + "\n"
    rows = _table(ranked, scores, played, REASON_MAX)
    header, rows = rows[:2], rows[2:]
    parts: list[list[str]] = []
    part: list[str] = []
    for row in rows:
        if part and len("\n".join(header + part + [row])) > BODY_MAX - 200:
            parts.append(part)
            part = []
        part.append(row)
    if part:
        parts.append(part)
    comments = [
        f"**Every estimate, part {i} of {len(parts)}**\n\n" + "\n".join(header + p) + "\n"
        for i, p in enumerate(parts, 1)
    ]
    return body, comments


def write_summary(args: argparse.Namespace) -> None:
    report, estimates = read_estimates(args)
    scores = json.loads(args.scores.read_text())
    body, comments = summary(report, estimates, scores, args.model, args.run_url)
    args.summary_out.write_text(body)
    if args.comments_dir:
        args.comments_dir.mkdir(parents=True, exist_ok=True)
        for n, comment in enumerate(comments, 1):
            (args.comments_dir / f"comment-{n:03d}.md").write_text(comment)
    print(f"Wrote the summary and {len(comments)} comment(s) for {len(estimates)} estimate(s).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="step", required=True)

    p = sub.add_parser("prepare", help="pick the words and write Claude's requests")
    p.add_argument("--candidates", required=True, type=Path)
    p.add_argument("--limit", type=int, default=200, help="estimate at most this many words, by priority()")
    p.add_argument("--chunk-size", type=int, default=200, help="words per request")
    p.add_argument("--asked-out", required=True, type=Path)
    p.add_argument("--requests-dir", required=True, type=Path)
    p.add_argument("--answers-dir", required=True, type=Path, help="where Claude is told to write")

    r = sub.add_parser("record", help="validate Claude's answers and append them as a batch")
    r.add_argument("--asked", required=True, type=Path)
    r.add_argument("--estimates", required=True, type=Path, nargs="+")
    r.add_argument("--model", required=True)
    r.add_argument("--run-url")

    m = sub.add_parser("summary", help="write the PR body and comments")
    m.add_argument("--asked", required=True, type=Path)
    m.add_argument("--estimates", required=True, type=Path, nargs="+")
    m.add_argument("--scores", required=True, type=Path, help="scripts/estimated-scores.mts's output")
    m.add_argument("--model", required=True)
    m.add_argument("--run-url")
    m.add_argument("--summary-out", required=True, type=Path)
    m.add_argument("--comments-dir", type=Path)

    args = parser.parse_args()
    {"prepare": prepare, "record": record, "summary": write_summary}[args.step](args)


if __name__ == "__main__":
    main()
