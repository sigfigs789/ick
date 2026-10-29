#!/usr/bin/env python3
"""The daily suggestion review's bookkeeping, around Claude's verdicts.

See .github/workflows/review-suggested-words.yml for the whole flow. Each step
here is one subcommand:

  check   Read Claude's .tmp/verdicts.json against .tmp/facts.json and keep one
          well-formed verdict per queued word. A word Claude skipped is left
          out: it stays untriaged and the next day's run asks again.
  zipf-sql  Print the SQL that writes each judged word's Zipf onto the queue:
          the game's measurement where it has one, Claude's estimate where not.
  sql     Print the SQL that marks a set of judged words on the queue:
          --status rejected   the cross on /suggested-words, set at run time;
          --status deferred   accepted, waiting on the PR (still unmarked, but
                              no longer 'new', so the next run skips it);
          --status accepted   the tick, set when the PR merges;
          --status new        put back, when the PR is closed unmerged.
  add     Add every accepted word that does not already play to the suggested
          dictionary list (scripts/suggested-words.txt), the way the "Add a
          word" workflow does, and regenerate the rarity data once.
  ledger  Write scripts/suggestion-review/verdicts/<name>.json -- the record
          the merge workflow reads to tick the accepted words -- an
          estimated-zipf batch for the accepted words nothing measures, and the
          PR body.

    python scripts/suggestion-review/review.py check --facts .tmp/facts.json \
        --verdicts .tmp/verdicts.json --out .tmp/judged.json
    python scripts/suggestion-review/review.py sql --judged .tmp/judged.json --status rejected
    python scripts/suggestion-review/review.py add --judged .tmp/judged.json
    python scripts/suggestion-review/review.py ledger --judged .tmp/judged.json \
        --verified .tmp/facts-after.json --run-url URL --summary-out .tmp/summary.md
    python scripts/suggestion-review/review.py sql --ledger scripts/suggestion-review/verdicts/2026-10-28.json --status accepted
"""
import argparse
import importlib.util
import json
import re
import subprocess
import sys
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LEDGER_DIR = ROOT / "scripts" / "suggestion-review" / "verdicts"
MANAGE = ROOT / "scripts" / "manage-extra-word.py"
GENERATE = ROOT / "scripts" / "generate-data.py"

# The queue's own input rule (see the suggested_words migrations). Every word
# that reaches SQL passes it, so a word can be quoted without escaping.
WORD_RE = re.compile(r"^[a-z]{2,30}$")
VERDICTS = ("accept", "reject")
# An estimate outside this range is not a frequency, it is a malformed answer
# (the bounds scripts/estimate-zipf.py holds its own estimates to).
ZIPF_MIN, ZIPF_MAX = -3.0, 8.0
# An estimate for an accepted word applies from this many days out, like the
# daily Zipf estimate's: by then no time zone is playing the puzzle it re-prices.
ESTIMATE_LEAD_DAYS = 2


def estimate_zipf_module():
    """scripts/estimate-zipf.py, for write_batch: one recorder for every batch."""
    spec = importlib.util.spec_from_file_location("estimate_zipf", ROOT / "scripts" / "estimate-zipf.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # its dataclasses look themselves up here
    spec.loader.exec_module(module)
    return module


def load(path: str):
    return json.loads(Path(path).read_text())


def check(args) -> None:
    facts = {entry["word"]: entry for entry in load(args.facts)["words"]}
    try:
        raw = load(args.verdicts)
    except (OSError, json.JSONDecodeError) as error:
        sys.exit(f"No usable verdicts at {args.verdicts}: {error}")
    if not isinstance(raw, list):
        sys.exit(f"{args.verdicts} must hold a JSON array of verdicts.")

    judged: dict[str, dict] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word", "")).strip().lower()
        verdict = item.get("verdict")
        reason = str(item.get("reason", "")).strip()
        if word not in facts or verdict not in VERDICTS or not reason or word in judged:
            print(f"::warning::Dropped a malformed or unknown verdict: {item!r}")
            continue
        fact = facts[word]
        measured = fact.get("measuredZipf")
        estimate = item.get("zipf")
        if measured is None and not (
            isinstance(estimate, (int, float)) and ZIPF_MIN <= estimate <= ZIPF_MAX
        ):
            print(f"::warning::No usable Zipf estimate for {word!r} ({estimate!r}); it shows TBD.")
        judged[word] = {
            "word": word,
            "verdict": verdict,
            "reason": reason,
            "alreadyPlayable": bool(fact.get("alreadyPlayable")),
            "suggestions": fact.get("suggestions", 0),
            "origin": fact.get("origin"),
            # The game's own measurement when it has one; Claude's guess only
            # where nothing measures the word.
            "zipf": measured
            if measured is not None
            else (round(float(estimate), 2) if isinstance(estimate, (int, float)) and ZIPF_MIN <= estimate <= ZIPF_MAX else None),
            "zipfEstimated": measured is None,
        }

    skipped = sorted(set(facts) - set(judged))
    for word in skipped:
        print(f"::warning::No verdict for {word!r}; it stays on the queue for tomorrow.")
    Path(args.out).write_text(
        json.dumps({"words": list(judged.values()), "skipped": skipped}, indent=2) + "\n"
    )
    accepted = sum(1 for w in judged.values() if w["verdict"] == "accept")
    print(f"{len(judged)} judged: {accepted} accepted, {len(judged) - accepted} rejected, {len(skipped)} skipped")


def words_for(args) -> list[str]:
    if args.ledger:
        # The ledger as merged, which may have been edited on the PR.
        source = load(args.ledger)
        if args.status in ("accepted", "new"):
            words = [w["word"] for w in source["accepted"]]
        elif args.status == "rejected":
            words = [w["word"] for w in source["rejected"]]
        else:
            words = []
    else:
        verdict = "reject" if args.status == "rejected" else "accept"
        words = [w["word"] for w in load(args.judged)["words"] if w["verdict"] == verdict]
    bad = [w for w in words if not WORD_RE.fullmatch(w)]
    if bad:
        sys.exit(f"Refusing to write SQL for malformed words: {bad}")
    return sorted(set(words))


def sql(args) -> None:
    words = words_for(args)
    if not words:
        return
    array = "array[" + ", ".join(f"'{w}'" for w in words) + "]"
    if args.status == "new":
        # Only the words still waiting on this PR: one a curator has marked by
        # hand since keeps that mark.
        print(f"update public.word_sightings set status = 'new' where word = any({array}) and status = 'deferred';")
    else:
        print(f"select public.set_word_status({array}, '{args.status}');")


def zipf_sql(args) -> None:
    """Write each judged word's Zipf onto its queue row: a measurement fills
    `zipf` where the row has none, an estimate goes in `zipf_estimate`. Run after
    the status marks, which give every judged word a row."""
    for entry in load(args.judged)["words"]:
        word, zipf = entry["word"], entry.get("zipf")
        if zipf is None:
            continue
        if not WORD_RE.fullmatch(word) or not isinstance(zipf, (int, float)):
            sys.exit(f"Refusing to write SQL for {entry!r}")
        if entry["zipfEstimated"]:
            print(f"update public.word_sightings set zipf_estimate = {float(zipf):.2f} where word = '{word}';")
        else:
            print(f"update public.word_sightings set zipf = {float(zipf):.2f} where word = '{word}' and zipf is null;")


def run(*command: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *command], cwd=ROOT, capture_output=True, text=True)


def add(args) -> None:
    judged = load(args.judged)
    added: list[str] = []
    for entry in judged["words"]:
        if entry["verdict"] != "accept" or entry["alreadyPlayable"]:
            continue
        # Forced: a word no frequency corpus attests still goes in, at the
        # unattested 10.00 until the Zipf estimate catches up with it.
        result = run(str(MANAGE), "add", entry["word"], "--list", "suggested", "--forced")
        print(result.stdout + result.stderr, end="")
        if result.returncode == 0:
            entry["added"] = True
            added.append(entry["word"])
        else:
            entry["addError"] = (result.stderr or result.stdout).strip().splitlines()[-1]

    if added:
        for command in (
            (str(GENERATE), "--refresh-rarity"),
            (str(MANAGE), "align-legacy", *added),
            (str(MANAGE), "update-size-test"),
            *((str(MANAGE), "record-word", word, "--list", "suggested") for word in added),
        ):
            result = run(*command)
            print(result.stdout + result.stderr, end="")
            if result.returncode != 0:
                sys.exit(f"{' '.join(command)} failed")
    Path(args.judged).write_text(json.dumps(judged, indent=2) + "\n")
    print(f"Added {len(added)} word(s) to the suggested list: {', '.join(added) or 'none'}")


def cell(text: str) -> str:
    """Make `text` safe inside a Markdown table cell."""
    return text.replace("|", "\\|").replace("\n", " ")


def zipf_cell(entry: dict) -> str:
    if entry.get("zipf") is None:
        return "–"
    return f"{entry['zipf']:.2f}" + (" *est.*" if entry.get("zipfEstimated") else "")


def ledger(args) -> None:
    judged = load(args.judged)
    verified = {entry["word"]: entry for entry in load(args.verified)["words"]}
    date = load(args.verified)["date"]

    def standing(entry: dict) -> dict:
        after = verified.get(entry["word"], {})
        out = {
            "word": entry["word"],
            "reason": entry["reason"],
            "suggestions": entry["suggestions"],
            "zipf": entry.get("zipf"),
            "zipfEstimated": entry.get("zipfEstimated", False),
        }
        if entry["verdict"] == "accept":
            out["alreadyPlayable"] = entry["alreadyPlayable"]
            out["playsNow"] = bool(after.get("alreadyPlayable"))
            standard = after.get("standard", {})
            if standard.get("plays"):
                out["score"] = standard.get("score")
                out["rarity"] = standard.get("rarity")
            if entry.get("addError"):
                out["addError"] = entry["addError"]
        return out

    accepted = [standing(e) for e in judged["words"] if e["verdict"] == "accept"]
    rejected = [standing(e) for e in judged["words"] if e["verdict"] == "reject"]
    record = {
        "date": date,
        "run": args.run_url,
        "accepted": sorted(accepted, key=lambda e: e["word"]),
        "rejected": sorted(rejected, key=lambda e: e["word"]),
        "skipped": judged["skipped"],
    }
    # Accepted words nothing measures would score a flat 10.00; their estimate
    # goes in as a batch the game reads, as the daily Zipf estimate's do.
    estimated = {
        e["word"]: e["zipf"] for e in accepted if e["zipfEstimated"] and e["zipf"] is not None
    }
    batch_path = None
    if estimated:
        since = (Date.fromisoformat(date) + timedelta(days=ESTIMATE_LEAD_DAYS)).isoformat()
        batch_path = estimate_zipf_module().write_batch(
            {
                "since": since,
                # The drop each word was checked against in facts.mts: its own
                # first two letters (a suggestion belongs to no puzzle).
                "drop": ", ".join(sorted({w[:2].upper() for w in estimated})),
                "model": args.model,
                "source": "claude",
                "run": args.run_url,
                "estimatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "note": f"Words accepted off the suggested-words queue on {date} that no corpus measures.",
                "zipf": dict(sorted(estimated.items())),
            }
        )
        # `add` pinned these words in dictionary.test.ts at the sentinel, before
        # the batch existed; the game scores them from the estimate now, so pin
        # them again from it.
        for word in sorted(w for w in estimated if any(e["word"] == w and e.get("added") for e in judged["words"])):
            result = run(str(MANAGE), "record-word", word, "--list", "suggested")
            print(result.stdout + result.stderr, end="")
            if result.returncode != 0:
                sys.exit(f"record-word {word} failed")

    LEDGER_DIR.mkdir(parents=True, exist_ok=True)
    path = LEDGER_DIR / f"{args.name or date}.json"
    path.write_text(json.dumps(record, indent=2) + "\n")

    lines = [
        f"Daily review of the suggested-words queue, {date}: "
        f"**{len(accepted)} accepted**, **{len(rejected)} rejected**"
        + (f", {len(judged['skipped'])} left for tomorrow" if judged["skipped"] else "")
        + ".",
        "",
        "- Rejected words are already crossed out on [/suggested-words](https://wordink.app/suggested-words).",
        "- Accepted words get their tick **when this PR merges** -- and every player who suggested",
        "  one is thanked in the game and earns 📖 *In the dictionary*. Close the PR unmerged to",
        "  put them back on the queue.",
        f"- To overrule a call, edit `{path.relative_to(ROOT)}` (move the word between lists)",
        "  before merging, and fix the dictionary to match. A word moved to `rejected` is crossed",
        "  out on merge.",
    ]
    if batch_path:
        lines.append(
            f"- Zipf marked *est.* is Claude's estimate for a word no corpus measures. The accepted ones are "
            f"recorded in `{batch_path.relative_to(ROOT)}` and apply from {since}; until then they score 10.00."
        )
    broken = [e for e in accepted if not e["playsNow"]]
    if broken:
        lines += [
            "",
            "> [!WARNING]",
            "> These accepted words still do not play after the add. Fix them in this PR before merging:",
        ]
        lines += [f"> - `{e['word']}`: {e.get('addError', 'still refused by the game')}" for e in broken]
    if accepted:
        lines += ["", "### Accepted", "", "| Word | Zipf | Score now (Standard) | | Why |", "|---|---:|---|---|---|"]
        for e in record["accepted"]:
            how = "already plays" if e["alreadyPlayable"] else ("added" if e["playsNow"] else "**not playable yet**")
            score = f"{e['score']} {e['rarity']}" if e.get("score") else "–"
            lines.append(f"| `{e['word']}` | {zipf_cell(e)} | {score} | {how} | {cell(e['reason'])} |")
    if rejected:
        lines += ["", "### Rejected", "", "| Word | Zipf | Why |", "|---|---:|---|"]
        lines += [f"| `{e['word']}` | {zipf_cell(e)} | {cell(e['reason'])} |" for e in record["rejected"]]
    if judged["skipped"]:
        lines += ["", f"No verdict came back for: {', '.join(f'`{w}`' for w in judged['skipped'])}."]
    lines += ["", f"[Run log]({args.run_url})"]
    Path(args.summary_out).write_text("\n".join(lines) + "\n")
    print(f"Wrote {path.relative_to(ROOT)} and {args.summary_out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    command = parser.add_subparsers(dest="command", required=True)

    p = command.add_parser("check")
    p.add_argument("--facts", required=True)
    p.add_argument("--verdicts", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=check)

    p = command.add_parser("sql")
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--judged")
    source.add_argument("--ledger")
    p.add_argument("--status", required=True, choices=("rejected", "deferred", "accepted", "new"))
    p.set_defaults(func=sql)

    p = command.add_parser("zipf-sql")
    p.add_argument("--judged", required=True)
    p.set_defaults(func=zipf_sql)

    p = command.add_parser("add")
    p.add_argument("--judged", required=True)
    p.set_defaults(func=add)

    p = command.add_parser("ledger")
    p.add_argument("--judged", required=True)
    p.add_argument("--verified", required=True)
    p.add_argument("--model", default="claude-opus-5-5")
    p.add_argument("--name", help="Ledger file name, without .json (default: the date)")
    p.add_argument("--run-url", required=True)
    p.add_argument("--summary-out", required=True)
    p.set_defaults(func=ledger)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
