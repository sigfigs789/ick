#!/usr/bin/env python3
"""Discover very rare words containing an upcoming drop, using the Datamuse API.

Given a target date (default: tomorrow, UTC), this resolves that day's drop the
same way the app does -- see src/game/drop.ts and src/game/date.ts over
src/data/drops.json -- then asks Datamuse (a free, key-less word API) for words
whose spelling contains the drop substring, and keeps only the ones that are:

  - valid inputs (1-15 lowercase a-z letters) that actually contain the drop,
  - not blocklisted,
  - not already playable (absent from dictionary.json and every provenance list),
  - attested by the frequency waterfall (wordfreq -> Norvig -> Google Books), so
    their rarity is measured rather than a guess -- no --forced needed, and
  - very rare: waterfall Zipf at or below --max-zipf.

Every surviving candidate is printed to stdout (rarest first), one per line, for
the "Add rare words found online" workflow to feed into
scripts/manage-extra-word.py -- exactly like a maintainer running the "Add a
word" action once per word. Diagnostics go to stderr so stdout stays a clean
word list. Pass --drop-out PATH to also write the resolved drop to a file.

Run:
    python3 scripts/find-online-words.py                    # tomorrow's drop
    python3 scripts/find-online-words.py --date 2026-08-20 --max-zipf 2.5
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import word_tags
from frequency import FrequencyWaterfall

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
DICTIONARY_PATH = DATA_DIR / "dictionary.json"
DROPS_PATH = DATA_DIR / "drops.json"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
LIST_PATHS = [
    ROOT / "scripts" / "extra-words.txt",
    ROOT / "scripts" / "suggested-words.txt",
    ROOT / "scripts" / "online-words.txt",
]

DATAMUSE_URL = "https://api.datamuse.com/words"
WORD_RE = re.compile(r"^[a-z]{1,15}$")


def log(message: str) -> None:
    print(message, file=sys.stderr)


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def days_since_epoch(target: date, epoch: date) -> int:
    return (target - epoch).days


def drop_for_date(target: date) -> str:
    """Resolve a calendar date to its drop, mirroring src/game/drop.ts."""
    data = json.loads(DROPS_PATH.read_text())
    drops = data["drops"]
    epoch = date.fromisoformat(data["epoch"])
    day_index = days_since_epoch(target, epoch)
    i = ((day_index % len(drops)) + len(drops)) % len(drops)
    return drops[i]


def datamuse_words_containing(drop: str, max_results: int) -> list[str]:
    """Words whose spelling contains the drop substring, via Datamuse `sp=*drop*`.

    Datamuse returns up to `max_results` matches ordered by frequency (most
    common first), so the rare tail we want sits at the end of the list.
    """
    query = urllib.parse.urlencode(
        {"sp": f"*{drop.lower()}*", "max": max_results, "md": "f"}
    )
    request = urllib.request.Request(
        f"{DATAMUSE_URL}?{query}", headers={"User-Agent": "wordink-online-words"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    return [entry["word"] for entry in payload if "word" in entry]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find very rare words for an upcoming drop via Datamuse."
    )
    parser.add_argument(
        "--date",
        dest="target_date",
        help="target drop date YYYY-MM-DD (default: tomorrow, UTC)",
    )
    parser.add_argument(
        "--max-zipf",
        type=float,
        default=2.5,
        help="only keep words at or below this Zipf frequency (lower = rarer)",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=1000,
        help="how many Datamuse matches to request (its ceiling is 1000)",
    )
    parser.add_argument(
        "--drop-out",
        type=Path,
        help="also write the resolved drop to this file",
    )
    args = parser.parse_args()

    if args.target_date:
        target = date.fromisoformat(args.target_date)
    else:
        target = date.today() + timedelta(days=1)

    drop = drop_for_date(target)
    log(f"Target date {target.isoformat()} -> drop {drop!r}")
    if args.drop_out:
        args.drop_out.write_text(drop)

    dictionary = set(json.loads(DICTIONARY_PATH.read_text()))
    blocklist = listed_words(BLOCKLIST_PATH)
    already_listed = set().union(*(listed_words(path) for path in LIST_PATHS))
    drop_lower = drop.lower()

    try:
        found = datamuse_words_containing(drop, args.max_results)
    except Exception as error:  # noqa: BLE001 - surface any network/parse failure
        sys.exit(f"Datamuse lookup for {drop!r} failed: {error}")
    log(f"Datamuse returned {len(found)} words containing {drop!r}")

    waterfall = FrequencyWaterfall()
    candidates: list[tuple[float, str]] = []
    seen: set[str] = set()
    skipped = {
        "malformed": 0,
        "in_dictionary": 0,
        "in_list": 0,
        "blocklisted": 0,
        "unattested": 0,
        "too_common": 0,
        "disqualified": 0,
    }
    disqualified: list[tuple[str, str]] = []
    for raw in found:
        word = raw.strip().lower()
        if word in seen:
            continue
        seen.add(word)
        if not WORD_RE.fullmatch(word) or drop_lower not in word:
            skipped["malformed"] += 1
            continue
        # Cross-check against the existing dictionary (and the provenance lists
        # that feed it): a word that is already playable is not new, so it is
        # never selected and thus never attempted as an addition.
        if word in dictionary:
            skipped["in_dictionary"] += 1
            continue
        if word in already_listed:
            skipped["in_list"] += 1
            continue
        if word in blocklist:
            skipped["blocklisted"] += 1
            continue
        zipf = waterfall.zipf(word)
        # Unattested words would need --forced (a guessed rarity); skip them.
        if zipf is None:
            skipped["unattested"] += 1
            continue
        # Words above the threshold are not rare enough.
        if zipf > args.max_zipf:
            skipped["too_common"] += 1
            continue
        # Only the rare, new, attested tail reaches the per-word tag check, so it
        # makes just a handful of API calls per run. Drop anything the sources
        # flag as a proper noun, abbreviation, or out-of-use word.
        tags = word_tags.classify(word)
        if tags["disqualified"]:
            skipped["disqualified"] += 1
            disqualified.append((word, tags["reason"]))
            continue
        candidates.append((zipf, word))

    log(
        f"Skipped {skipped['in_dictionary']} already in the dictionary, "
        f"{skipped['in_list']} already on a provenance list, "
        f"{skipped['blocklisted']} blocklisted, "
        f"{skipped['unattested']} unattested, "
        f"{skipped['too_common']} above Zipf {args.max_zipf}, "
        f"{skipped['disqualified']} disqualified by lexical tags"
    )
    for word, reason in disqualified:
        log(f"  dropped {word} ({reason})")
    candidates.sort()  # rarest (lowest Zipf) first
    log(f"{len(candidates)} new candidates <= Zipf {args.max_zipf}; adding all of them")
    for zipf, word in candidates:
        log(f"  {word} (Zipf {zipf:.2f})")
        print(word)


if __name__ == "__main__":
    main()
