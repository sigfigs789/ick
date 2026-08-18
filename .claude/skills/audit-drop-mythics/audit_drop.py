#!/usr/bin/env python3
"""List every Mythic-or-better word available for a WordInk drop, with the
diagnostics needed to judge whether each one deserves that rank.

Read-only: loads src/data/dictionary.json + rarity.json and reuses the scoring
mirrors in scripts/manage-extra-word.py, so every number here is exactly what a
player would see.

Usage (from the repo root, or with --repo):
    python3 audit_drop.py                 # tomorrow's drop, Mountain Time
    python3 audit_drop.py --date 2026-08-18
    python3 audit_drop.py --drop STR
    python3 audit_drop.py --json
"""
import argparse
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Mountain Time = UTC-7 (MDT) / UTC-6 (MST). zoneinfo is used when available so
# the DST boundary is exact; the fixed -7 fallback only matters on hosts with no
# tz database.
try:
    from zoneinfo import ZoneInfo

    MOUNTAIN = ZoneInfo("America/Denver")
except Exception:  # pragma: no cover - no tzdata on host
    MOUNTAIN = timezone(timedelta(hours=-7))

MYTHIC_MIN_SCORE = 9.5

# Mechanical inflections: (suffix, how to rebuild candidate bases). A Mythic word
# that is just one of these on top of a dictionary word is the "unfun" shape the
# audit is looking for -- especially when the base is far more common.
INFLECTIONS = [
    ("ies", lambda s: [s[:-3] + "y"]),
    ("es", lambda s: [s[:-2], s[:-1]]),
    ("s", lambda s: [s[:-1]]),
    ("ed", lambda s: [s[:-2], s[:-1], s[:-2] + "e"]),
    ("ing", lambda s: [s[:-3], s[:-3] + "e"]),
    ("ly", lambda s: [s[:-2], s[:-2] + "e", s[:-3] + "y" if s[:-2].endswith("i") else ""]),
    ("ness", lambda s: [s[:-4], s[:-5] + "y" if s[:-4].endswith("i") else ""]),
    ("er", lambda s: [s[:-2], s[:-1]]),
    ("est", lambda s: [s[:-3], s[:-2]]),
    ("ers", lambda s: [s[:-3], s[:-2]]),
    ("ings", lambda s: [s[:-4], s[:-4] + "e"]),
    # Classical plurals, which the game's spelling-only stemmer cannot see at
    # all: "altostrati" -> "altostratus", "vertebrae" -> "vertebra".
    ("i", lambda s: [s[:-1] + "us"]),
    ("a", lambda s: [s[:-1] + "um", s[:-1] + "on"]),
    ("ae", lambda s: [s[:-1]]),
    ("ices", lambda s: [s[:-4] + "ex", s[:-4] + "ix"]),
    ("es", lambda s: [s[:-2] + "is"]),
]


# Why a given shape is undeserved, in the words the PR body should use.
SHAPE_REASONS = {
    "s": "plural/third-person form",
    "es": "plural/third-person form",
    "ies": "plural form",
    "er": "agent noun or comparative",
    "ers": "plural agent noun",
    "est": "superlative",
    "ings": "plural gerund",
    "ing": "gerund",
    "ed": "past-tense form",
    "ly": "adverb form",
    "ness": "noun form",
    "i": "classical plural",
    "a": "classical plural",
    "ae": "classical plural",
    "ices": "classical plural",
}


def reason_for(row, base) -> str:
    """One sentence: what the word is, and why its score is not earned."""
    shape = SHAPE_REASONS.get(base["suffix"], "derived form")
    gap = row["score"] - base["base_score"]
    if base["base_folded"]:
        cause = (
            f"the fold stops after one step -- `{base['base']}` is itself scored from a base "
            "form, but the cap reads its raw frequency, so the inflection escapes"
        )
    elif base["suffix"] in ("i", "a", "ae", "ices"):
        cause = "a spelling-only stemmer cannot see a classical plural, so nothing caps it"
    elif base["suffix"] in ("er", "ers", "est"):
        cause = "-er/-ers/-est are not folded at all, so the form keeps its own frequency"
    elif base["suffix"] in ("es", "s"):
        cause = (
            "the -es strip removes two characters and lands on a non-word, so the form is "
            "never capped at its base"
        )
    else:
        cause = "the base-form fold does not cover this ending, so the form is never capped"
    return (
        f"{shape.capitalize()} of `{base['base']}`; {cause}. Adding `-{base['suffix']}` "
        f"buys {gap:.2f} points and a rank the base never earned."
    )


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def drop_for_date(date_str: str, drops: dict) -> str:
    epoch = datetime.strptime(drops["epoch"], "%Y-%m-%d").date()
    day = datetime.strptime(date_str, "%Y-%m-%d").date()
    words = drops["drops"]
    return words[(day - epoch).days % len(words)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".", help="path to the ick checkout")
    ap.add_argument("--date", help="puzzle date YYYY-MM-DD (default: tomorrow, Mountain Time)")
    ap.add_argument("--drop", help="audit this drop instead of the date's drop")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of Markdown")
    ap.add_argument(
        "--limit",
        type=int,
        default=0,
        help="rows to print for the informational buckets (default 0: counts only)",
    )
    ap.add_argument(
        "--min-score",
        type=float,
        default=9.7,
        help="only flag words scoring at least this (default 9.7: the very top of the scale, "
        "where an undeserved rank is most visible)",
    )
    ap.add_argument(
        "--min-base-zipf",
        type=float,
        default=4.2,
        help="only flag inflections whose base is at least this common -- Zipf 4.2 is the "
        "Common band, i.e. a word a player might actually type (default 4.2)",
    )
    ap.add_argument(
        "--seen",
        default=str(Path(__file__).resolve().parent / "reviewed.txt"),
        help="ledger of already-judged words to suppress; '' disables it",
    )
    ap.add_argument(
        "--all",
        action="store_true",
        help="drop the --min-score/--min-base-zipf/--seen filters and report every offender",
    )
    ap.add_argument(
        "--min-gap",
        type=float,
        default=0.3,
        help="only flag an inflection that outscores its base by at least this much "
        "(default 0.3; smaller gaps are cosmetic and don't change the rank)",
    )
    args = ap.parse_args()
    limit = args.limit
    min_gap = args.min_gap
    min_score = 0.0 if args.all else args.min_score
    min_base_zipf = float("-inf") if args.all else args.min_base_zipf
    seen_path = Path(args.seen) if args.seen and not args.all else None
    seen = (
        {w.strip() for w in seen_path.read_text().split() if w.strip()}
        if seen_path and seen_path.exists()
        else set()
    )

    root = Path(args.repo).resolve()
    scripts = root / "scripts"
    if not (root / "src" / "data" / "dictionary.json").exists():
        sys.exit(f"{root} does not look like the ick repo (no src/data/dictionary.json)")
    sys.path.insert(0, str(scripts))
    mew = load_module(scripts / "manage-extra-word.py", "manage_extra_word")

    date_str = args.date or (datetime.now(MOUNTAIN).date() + timedelta(days=1)).isoformat()
    drops = json.loads((root / "src" / "data" / "drops.json").read_text())
    drop = (args.drop or drop_for_date(date_str, drops)).upper()

    dictionary = json.loads((root / "src" / "data" / "dictionary.json").read_text())
    hundredths = json.loads((root / "src" / "data" / "rarity.json").read_text())["zipfHundredths"]
    index = {w: i for i, w in enumerate(dictionary)}
    zipf_at = lambda w: hundredths[index[w]] / 100  # noqa: E731
    max_zipf = max(hundredths) / 100
    sentinel = min(hundredths) / 100

    # The mirrors' signatures differ across scoring eras (the sentinel argument
    # only exists where unattested words are floored), so bind by arity rather
    # than assuming one shape.
    import inspect

    def bind(fn):
        n = len(inspect.signature(fn).parameters)
        return (lambda z: fn(z, max_zipf, sentinel)) if n >= 3 else (lambda z: fn(z, max_zipf))

    label_of = bind(mew.rarity_label)
    score_at = bind(mew.current_score)
    # adjusted_zipf gained a max_zipf argument with the inflection fold.
    adjust = (
        (lambda w: mew.adjusted_zipf(w, index, zipf_at, max_zipf))
        if len(inspect.signature(mew.adjusted_zipf).parameters) >= 4
        else (lambda w: mew.adjusted_zipf(w, index, zipf_at))
    )

    def score_of(word: str) -> tuple[float, str, float]:
        zipf = round(adjust(word), 2)
        return zipf, label_of(zipf), score_at(zipf)

    needle = drop.lower()
    matches = [w for w in dictionary if needle in w]
    rows = []
    for word in matches:
        zipf, label, score = score_of(word)
        if score < MYTHIC_MIN_SCORE:
            continue
        own_zipf = zipf_at(word)
        # Which base form (if any) the game's own scoring already folded in.
        applied_base = mew._tense_base(word, index, zipf_at) or mew._scoring_base(word, index)
        if applied_base is not None and zipf_at(applied_base) <= own_zipf and mew._tense_base(
            word, index, zipf_at
        ) is None:
            applied_base = None  # transparent-suffix base was rarer, so it was ignored
        # Mechanical inflections the game did NOT fold in -- the unfun candidates.
        unfolded = []
        for suffix, bases in INFLECTIONS:
            if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
                continue
            for cand in bases(word):
                # The base the game already folded is NOT excluded: the fold caps
                # at the base's *raw* Zipf, so a base that is itself scored from a
                # further base form still leaves the inflection above it.
                if cand and cand != word and cand in index:
                    bz, blabel, bscore = score_of(cand)
                    unfolded.append(
                        {
                            "suffix": suffix,
                            "base": cand,
                            "base_zipf": bz,
                            "base_label": blabel,
                            "base_score": round(bscore, 2),
                            # True when the base's own score already comes from a
                            # base form -- the cap reads its raw Zipf, so the fold
                            # effectively stops one level short.
                            "base_folded": abs(bz - zipf_at(cand)) > 1e-9,
                        }
                    )
        rows.append(
            {
                "word": word,
                "zipf": zipf,
                "own_zipf": own_zipf,
                "label": label,
                "score": round(score, 2),
                "display": mew.format_score(score),
                "unattested": own_zipf == sentinel and zipf == sentinel,
                "scored_from_base": applied_base,
                "inflection_of": unfolded,
            }
        )
    rows.sort(key=lambda r: (-r["score"], r["word"]))

    if args.json:
        print(
            json.dumps(
                {"date": date_str, "drop": drop, "matches": len(matches), "words": rows}, indent=2
            )
        )
        return

    # Triage. The buckets are ordered by how much they need a human decision.
    def best_base(r):
        return max(r["inflection_of"], key=lambda i: i["base_score"]) if r["inflection_of"] else None

    overscoring, ignored, folded, standalone = [], [], [], []
    for r in rows:
        base = best_base(r)
        if base and r["score"] - base["base_score"] >= min_gap:
            # Actionable only if it is visible (top of the scale) and reachable
            # (a base common enough that a player would ever type the form), and
            # not already judged in a past run.
            if (
                r["score"] >= min_score
                and base["base_zipf"] >= min_base_zipf
                and r["word"] not in seen
            ):
                overscoring.append((r, base))
            else:
                ignored.append((r, base))
        elif base or r["scored_from_base"]:
            folded.append(r)
        else:
            # Unattested stand-in scores are deliberately not a bucket here --
            # they are handled by a separate skill.
            standalone.append(r)

    legends = sum(1 for r in rows if r["label"] == "Legend")
    print(f"# Drop `{drop}` — puzzle {date_str}\n")
    print(
        f"{len(matches)} dictionary words contain the drop; **{len(rows)} are Mythic or better** "
        f"({legends} Legend, {len(rows) - legends} Mythic).\n"
    )
    print("| bucket | count | what it means |")
    print("| --- | --- | --- |")
    print(
        f"| **Actionable** | {len(overscoring)} | mechanical inflection scoring >= "
        f"{min_score:g} that outranks its base (Zipf >= {min_base_zipf:g}) by >= {min_gap:g} |"
    )
    print(
        f"| Below the filters | {len(ignored)} | outranks its base, but too low-scoring, too "
        "obscure to be typed, or already judged — deliberately ignored |"
    )
    print(
        f"| Inflection at (or within {min_gap:g} of) its base | {len(folded)} | plural/tense "
        "form riding its base word's rarity; rank is inherited, not earned |"
    )
    print(f"| Standalone rare word | {len(standalone)} | scored on its own measured frequency |")
    print()

    if overscoring:
        print("## Actionable — these do not deserve their rank\n")
        print("| word | score | base | base score | why it should change |")
        print("| --- | --- | --- | --- | --- |")
        overscoring.sort(key=lambda rb: -(rb[0]["score"] - rb[1]["base_score"]))
        for r, base in overscoring:
            print(
                f"| `{r['word']}` | **{r['display']}** | `{base['base']}` "
                f"| {base['base_score']:.2f} | {reason_for(r, base)} |"
            )
        print()

    if not overscoring:
        print("Nothing actionable for this drop.\n")

    if folded and limit:
        print(f"## Inflections riding a base form ({len(folded)})\n")
        print("| word | score | base |")
        print("| --- | --- | --- |")
        for r in folded[:limit]:
            base = best_base(r)
            print(
                f"| {r['word']} | {r['display']} | "
                f"{r['scored_from_base'] or (base and base['base']) or '?'} |"
            )
        if len(folded) > limit:
            print(f"\n_({len(folded) - limit} more; rerun with --limit or --json for the rest.)_")
        print()

    if not limit:
        if seen_path:
            print(f"_Ledger: {seen_path} ({len(seen)} words already judged)._")
        print("_Rerun with `--limit N` to see the informational buckets, `--all` to drop every filter._")
        return

    print(f"## Standalone rare words ({len(standalone)}) — rarest first\n")
    print("| word | score | zipf |")
    print("| --- | --- | --- |")
    for r in standalone[:limit]:
        print(f"| {r['word']} | {r['display']} | {r['zipf']} |")
    if len(standalone) > limit:
        print(f"\n_({len(standalone) - limit} more; rerun with --limit or --json for the rest.)_")


if __name__ == "__main__":
    main()
