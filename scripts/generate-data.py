#!/usr/bin/env python3
"""
Data generation pipeline for Ick.

Produces two SEPARATE artifacts, per design:
  - src/data/dictionary.json  -> the curated list of words a submission is checked against
  - src/data/rarity.json      -> precomputed frequency-derived rarity label for each word
  - src/data/rejection-metadata.json -> concise explanations for excluded ESDB entries

Frequency (via the `wordfreq` package) determines rarity. The curated
dictionary determines whether a submission is allowed at all. They are kept
separate so the "is this a word" question and the "how rare is it" question
can be tuned independently.

Run:
    pip3 install --user wordfreq
    python3 scripts/generate-data.py
    python3 scripts/generate-data.py --word-list /path/to/scowl-us-60.txt
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WORD_LIST = Path("/usr/share/dict/words")
OUT_DIR = ROOT / "src" / "data"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
EXTRA_WORDS_PATH = ROOT / "scripts" / "extra-words.txt"

MIN_LEN = 1

# SCOWL/ESDB is the acceptance authority. A 0.0 from wordfreq means that it
# has no usable frequency estimate, not that the entry is invalid. Keep those
# words just below the 1.0 lower limit of wordfreq's measured large wordlist.
# This maps to a displayed rarity score of 9.4; measured 1.0 words score 10.0.
UNKNOWN_ZIPF = 1.4

# Rarity bucket boundaries (inclusive lower bound), tuned by eyeballing the
# resulting distribution -- see the printed histogram when this script runs.
# These are intentionally generous toward "common" since the goal is that a
# player using everyday words still gets a satisfying, mostly-green result.
RARITY_BANDS = [
    (6.4, "Quotidian"),
    (5.2, "Very Common"),
    (4.2, "Common"),
    (3.3, "Uncommon"),
    (2.5, "Rare"),
    (1.6, "Extremely Rare"),
    (0.0, "Mythic"),
]

WORD_RE = re.compile(r"^[a-z]+$")

# Single-char codes for rarity.json, index-aligned with dictionary.json.
RARITY_CODE = {
    "Quotidian": "Q",
    "Very Common": "V",
    "Common": "C",
    "Uncommon": "U",
    "Rare": "R",
    "Extremely Rare": "X",
    "Mythic": "M",
}


def rarity_for_zipf(z: float) -> str:
    # Unknown-frequency words use a conservative score just below the Mythic
    # display threshold; lack of corpus data is not proof of exceptional rarity.
    if z == UNKNOWN_ZIPF:
        return "Extremely Rare"
    for threshold, label in RARITY_BANDS:
        if z >= threshold:
            return label
    return RARITY_BANDS[-1][1]


def displayed_zipf(z: float) -> float:
    """Match the one-decimal Zipf value stored and shown by the app."""
    return round(z * 10) / 10


def load_blocklist() -> set[str]:
    if not BLOCKLIST_PATH.exists():
        return set()
    words = set()
    for line in BLOCKLIST_PATH.read_text().splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#"):
            words.add(line)
    return words


def load_extra_words() -> set[str]:
    if not EXTRA_WORDS_PATH.exists():
        return set()
    words = set()
    for line in EXTRA_WORDS_PATH.read_text().splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#") and WORD_RE.match(line):
            words.add(line)
    return words


def rejection_metadata(esdb_db: Path, dictionary: set[str]) -> dict[str, str]:
    """Return high-confidence reasons for ESDB words excluded from the game.

    The game intentionally ships a small, static map instead of ESDB's full
    SQLite database.  A word can have several ESDB entries, so collect the
    strongest explanation for its lower-case form.  Unknown words are left out
    and receive the normal curated-list message in the client.
    """
    import sqlite3

    if not esdb_db.exists():
        sys.exit(f"ESDB database not found at {esdb_db}")

    priorities = {"obsolete": 1, "proper-noun": 2, "name-or-abbreviation": 3, "abbreviation": 4}
    reasons: dict[str, str] = {}
    query = """
        select distinct word, base_pos, pos_class, size
        from scowl_v0
    """
    with sqlite3.connect(esdb_db) as conn:
        for word, base_pos, pos_class, size in conn.execute(query):
            normalized = word.lower()
            if normalized in dictionary or not WORD_RE.match(normalized):
                continue

            reason = None
            if base_pos == "abbr" or word.isupper():
                reason = "abbreviation"
            elif pos_class in {"person", "surname", "place", "name", "name?"}:
                reason = "proper-noun"
            elif word != word.lower():
                # ESDB marks some capitalized entries only as `upper`; it
                # explicitly documents that this classification is incomplete.
                # Keep the user-facing explanation accurate without guessing.
                reason = "name-or-abbreviation"
            elif size >= 85:
                # ESDB describes size 85 words as valid but potentially no
                # longer used in modern English.
                reason = "obsolete"

            if reason and (
                normalized not in reasons or priorities[reason] > priorities[reasons[normalized]]
            ):
                reasons[normalized] = reason
    return reasons


def write_rejection_metadata(metadata: dict[str, str]) -> None:
    """Store each reason's sorted words once, instead of repeating reason strings."""
    grouped: dict[str, list[str]] = {}
    for word, reason in metadata.items():
        grouped.setdefault(reason, []).append(word)
    for words in grouped.values():
        words.sort()
    (OUT_DIR / "rejection-metadata.json").write_text(json.dumps(grouped, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Ick's dictionary and rarity data.")
    parser.add_argument(
        "--word-list",
        type=Path,
        default=DEFAULT_WORD_LIST,
        help="newline-delimited source words (default: macOS system dictionary)",
    )
    parser.add_argument(
        "--esdb-db",
        type=Path,
        help="optional ESDB SQLite database used to generate rejection metadata",
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="refresh rejection metadata from --esdb-db without regenerating dictionary data",
    )
    args = parser.parse_args()
    if args.metadata_only:
        if not args.esdb_db:
            parser.error("--metadata-only requires --esdb-db")
        dictionary = set(json.loads((OUT_DIR / "dictionary.json").read_text()))
        metadata = rejection_metadata(args.esdb_db, dictionary)
        write_rejection_metadata(metadata)
        print(f"Wrote {OUT_DIR / 'rejection-metadata.json'} ({len(metadata)} explanations)")
        return

    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")
    if not args.esdb_db:
        parser.error("--esdb-db is required when regenerating dictionary data")
    word_list = args.word_list
    if not word_list.exists():
        sys.exit(f"Word list not found at {word_list}")

    blocklist = load_blocklist()
    print(f"Loaded {len(blocklist)} blocklisted terms")

    raw_words = word_list.read_text(errors="ignore").splitlines()
    raw_words = set(raw_words) | load_extra_words()
    print(f"Read {len(raw_words)} candidate entries")

    candidates: dict[str, float] = {}
    for w in raw_words:
        wl = w.strip().lower()
        # Purely lowercase a-z only: this alone drops proper nouns (which
        # only appear capitalized in the source list), possessives and
        # contractions (apostrophes), and hyphenated compounds.
        if w != wl:
            continue
        if not WORD_RE.match(wl):
            continue
        if len(wl) < MIN_LEN:
            continue
        if wl in blocklist:
            continue
        zipf = zipf_frequency(wl, "en", wordlist="best")
        candidates[wl] = UNKNOWN_ZIPF if zipf == 0.0 else zipf

    print(f"Kept all {len(candidates)} eligible candidates ({UNKNOWN_ZIPF} Zipf fallback for unknowns)")

    # Histogram for tuning RARITY_BANDS.
    from collections import Counter

    hist = Counter(rarity_for_zipf(displayed_zipf(z)) for z in candidates.values())
    for _, label in RARITY_BANDS:
        print(f"  {label:16s} {hist.get(label, 0)}")

    dictionary = sorted(candidates.keys())

    # rarity.json is index-aligned with dictionary.json (same sort order)
    # rather than keyed by word again -- repeating every word as a JSON
    # object key doubled the payload size for no benefit, since the app
    # already has the word list from dictionary.json.
    codes = "".join(RARITY_CODE[rarity_for_zipf(displayed_zipf(candidates[w]))] for w in dictionary)
    zipf_tenths = [round(candidates[w] * 10) for w in dictionary]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "dictionary.json").write_text(json.dumps(dictionary, separators=(",", ":")))
    (OUT_DIR / "rarity.json").write_text(
        json.dumps({"codes": codes, "zipfTenths": zipf_tenths}, separators=(",", ":"))
    )
    metadata = rejection_metadata(args.esdb_db, set(dictionary))
    write_rejection_metadata(metadata)
    print(f"Wrote {OUT_DIR / 'dictionary.json'} ({len(dictionary)} words)")
    print(f"Wrote {OUT_DIR / 'rarity.json'} ({len(dictionary)} entries, index-aligned)")
    print(f"Wrote {OUT_DIR / 'rejection-metadata.json'} ({len(metadata)} explanations)")


if __name__ == "__main__":
    main()
