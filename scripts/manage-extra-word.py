#!/usr/bin/env python3
"""Add a curated or suggested word and maintain the dictionary regression tests.

Two provenance lists feed the playable dictionary:
  - scripts/extra-words.txt      -> "curated": words the maintainer chose to add
  - scripts/suggested-words.txt  -> "suggested": player-submitted words that were
                                    accepted

Both are merged into dictionary.json by generate-data.py; the split only records
where a word came from. An added word is gated on the frequency waterfall
(wordfreq -> Norvig -> Google Books): by default a word no corpus attests is
rejected, because its rarity would be a guess rather than a measurement.
`--forced` overrides that and adds the word anyway; the data pipeline then gives
an otherwise-unscored word the rarest-word floor, a perfect 10.0 / Mythic.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from frequency import FrequencyWaterfall

ROOT = Path(__file__).resolve().parent.parent
EXTRA_WORDS_PATH = ROOT / "scripts" / "extra-words.txt"
SUGGESTED_WORDS_PATH = ROOT / "scripts" / "suggested-words.txt"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
RARITY_PATH = ROOT / "src" / "data" / "rarity.json"
LEGACY_RARITY_PATH = ROOT / "src" / "data" / "rarity-legacy.json"
DICTIONARY_TEST_PATH = ROOT / "src" / "game" / "dictionary.test.ts"

# Legacy (pre-rescale) rarity placeholders for a freshly added word. The legacy
# arrays are index-aligned with dictionary.json and frozen for past puzzles; a
# new word could never have appeared in one, so its legacy entry is only ever
# read to keep the arrays aligned. We reuse the legacy unknown-frequency values
# (Zipf 1.4 -> tenths 14, displayed as "Extremely Rare"/"X") for that padding.
LEGACY_UNKNOWN_TENTHS = 14
LEGACY_UNKNOWN_CODE = "X"

# Displayed-score scale, mirroring CURRENT_SCORING in src/game/dictionary.ts so
# the action log reports the same rarity score a player sees. Words wordfreq can
# measure (Zipf >= MEASURED_FLOOR) fill 0..NORMAL_CEILING; the deep tail below it
# fills the elite NORMAL_CEILING..10 band.
MEASURED_FLOOR = 1.0
NORMAL_CEILING = 9.5
RARITY_LABEL = {
    "Q": "Quotidian",
    "V": "Very Common",
    "C": "Common",
    "U": "Uncommon",
    "R": "Rare",
    "X": "Extremely Rare",
    "M": "Mythic",
}

# The two provenance lists a word can be added to, and the JS test array that
# pins each one's words with the rarity/Zipf the pipeline gave them.
LISTS = {
    "curated": {
        "path": EXTRA_WORDS_PATH,
        "label": "curated",
        "score_array": "curatedWordScores",
    },
    "suggested": {
        "path": SUGGESTED_WORDS_PATH,
        "label": "suggested",
        "score_array": "suggestedWordScores",
    },
}

WORD_RE = re.compile(r"^[a-z]{1,15}$")
SIZE_ASSERTION_RE = re.compile(r"(expect\(dictionaryWords\)\.toHaveLength\()\d[\d_]*(\);)")

# A `[word, rarity, zipf]` tuple inside a scores array.
SCORE_TUPLE_RE = re.compile(r'\["([a-z]+)",\s*"([^"]+)",\s*(-?[\d.]+)\]')


def score_array_re(name: str) -> re.Pattern[str]:
    """Match a `const <name>: ReadonlyArray<[string, string, number]> = [ ... ];`."""
    return re.compile(
        rf"(const {name}: ReadonlyArray<\[string, string, number\]> = )\[([\s\S]*?)\](;)"
    )


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def add_word(raw_word: str, list_name: str, forced: bool) -> None:
    spec = LISTS[list_name]
    path = spec["path"]
    word = raw_word.strip().lower()
    if not WORD_RE.fullmatch(word):
        sys.exit("Word must contain only English letters and be 1–15 characters long.")
    if word in listed_words(BLOCKLIST_PATH):
        sys.exit(f"{word!r} is blocklisted and cannot be added.")
    if word in json.loads(DICTIONARY_PATH.read_text()):
        sys.exit(f"{word!r} is already in the curated dictionary.")
    for other_spec in LISTS.values():
        if word in listed_words(other_spec["path"]):
            sys.exit(
                f"{word!r} is already in the {other_spec['label']} list "
                f"({other_spec['path'].name})."
            )

    # "Has a rarity score" means any corpus in the waterfall attests it:
    # wordfreq, else Norvig, else Google Books. Only a word none of them attest
    # is unscored; without --forced that is a hard rejection.
    zipf = FrequencyWaterfall().zipf(word)
    if zipf is None and not forced:
        sys.exit(
            f"{word!r} has no rarity score in any frequency corpus and was not "
            f"added. Re-run with forced=true to add it anyway (it will score the "
            f"maximum 10.0 / Mythic)."
        )

    existing = path.read_text() if path.exists() else ""
    prefix = f"{existing.rstrip()}\n" if existing.strip() else ""
    path.write_text(f"{prefix}{word}\n")

    if zipf is not None:
        rating = f"Zipf {zipf:.2f}"
    else:
        rating = "no corpus attests it; forced, will score the maximum 10.0 / Mythic"
    print(f"Added {word!r} to {path} as a {spec['label']} word ({rating}).")


def update_size_test() -> None:
    count = len(json.loads(DICTIONARY_PATH.read_text()))
    contents = DICTIONARY_TEST_PATH.read_text()
    updated, replacements = SIZE_ASSERTION_RE.subn(
        rf"\g<1>{count:_}\g<2>", contents, count=1
    )
    if replacements != 1:
        sys.exit("Could not find the dictionary-size assertion to update.")
    DICTIONARY_TEST_PATH.write_text(updated)
    print(f"Updated dictionary-size assertion to {count:,}")


def current_score(zipf: float, max_zipf: float, min_zipf: float) -> float:
    """Displayed 0..10 rarity score for a Zipf, mirroring src/game/dictionary.ts."""
    if zipf >= MEASURED_FLOOR:
        score = NORMAL_CEILING * (max_zipf - zipf) / (max_zipf - MEASURED_FLOOR)
        return round(score * 10) / 10
    score = NORMAL_CEILING + (10 - NORMAL_CEILING) * (MEASURED_FLOOR - zipf) / (
        MEASURED_FLOOR - min_zipf
    )
    return round(min(score, 10) * 100) / 100


def format_score(score: float) -> str:
    """Two decimals in the elite deep-tail band, one otherwise (matches the app)."""
    return f"{score:.2f}" if score >= NORMAL_CEILING else f"{score:.1f}"


def word_rarity(word: str) -> tuple[float, str, float]:
    """(zipf, rarity label, displayed score) for a word from the generated data."""
    dictionary = json.loads(DICTIONARY_PATH.read_text())
    rarity = json.loads(RARITY_PATH.read_text())
    try:
        index = dictionary.index(word)
    except ValueError:
        sys.exit(f"{word!r} is not in dictionary.json; regenerate the data first.")
    hundredths = rarity["zipfHundredths"]
    zipf = round(hundredths[index] / 100, 2)
    label = RARITY_LABEL[rarity["codes"][index]]
    score = current_score(zipf, max(hundredths) / 100, min(hundredths) / 100)
    return zipf, label, score


def record_word(raw_word: str, list_name: str) -> None:
    """Log the added word's Zipf/score and pin them in the dictionary test.

    Reads the regenerated rarity data, so run this after generate-data.py (and
    --refresh-rarity) so a forced, otherwise-unscored word shows its final 10.0.
    """
    array_name = LISTS[list_name]["score_array"]
    word = raw_word.strip().lower()
    zipf, label, score = word_rarity(word)
    print(
        f"{word!r} scored: Zipf {zipf} -> rarity score {format_score(score)} "
        f"({label}) on the WordInk scale."
    )

    contents = DICTIONARY_TEST_PATH.read_text()
    match = score_array_re(array_name).search(contents)
    if not match:
        sys.exit(f"Could not find the {array_name} scores array.")

    entries = {
        w: (rarity, float(z)) for w, rarity, z in SCORE_TUPLE_RE.findall(match.group(2))
    }
    entries[word] = (label, zipf)
    lines = "".join(
        f"  [{json.dumps(w)}, {json.dumps(r)}, {json.dumps(z)}],\n"
        for w, (r, z) in sorted(entries.items())
    )
    replacement = f"{match.group(1)}[\n{lines}]{match.group(3)}"
    updated = contents[: match.start()] + replacement + contents[match.end() :]
    DICTIONARY_TEST_PATH.write_text(updated)
    print(f"Pinned {word!r} ({label}, Zipf {zipf}) in the {array_name} test.")


def align_legacy(raw_word: str) -> None:
    """Keep rarity-legacy.json index-aligned after a word is added.

    generate-data.py rebuilds dictionary.json and rarity.json, but the frozen
    legacy rarity arrays are not regenerated. Inserting the new word's placeholder
    at its sorted position preserves every existing legacy value while keeping the
    arrays the same length as the dictionary (see LEGACY_UNKNOWN_* above).
    """
    word = raw_word.strip().lower()
    dictionary = json.loads(DICTIONARY_PATH.read_text())
    legacy = json.loads(LEGACY_RARITY_PATH.read_text())
    tenths = legacy["zipfTenths"]
    codes = legacy["codes"]

    if len(tenths) == len(dictionary):
        print("rarity-legacy.json already aligned; nothing to insert.")
        return
    try:
        index = dictionary.index(word)
    except ValueError:
        sys.exit(f"{word!r} is not in dictionary.json; regenerate the data first.")
    if len(tenths) != len(dictionary) - 1:
        sys.exit(
            f"rarity-legacy.json is off by {len(dictionary) - len(tenths)} entries; "
            f"expected exactly one missing. Refusing to guess the alignment."
        )

    tenths.insert(index, LEGACY_UNKNOWN_TENTHS)
    legacy["codes"] = codes[:index] + LEGACY_UNKNOWN_CODE + codes[index:]
    legacy["zipfTenths"] = tenths
    LEGACY_RARITY_PATH.write_text(json.dumps(legacy, separators=(",", ":")))
    print(f"Inserted legacy alignment placeholder for {word!r} at index {index}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    command = parser.add_subparsers(dest="command", required=True)

    add = command.add_parser("add")
    add.add_argument("word")
    add.add_argument("--list", choices=LISTS, default="curated", dest="list_name")
    add.add_argument("--forced", action="store_true")

    command.add_parser("update-size-test")

    record = command.add_parser("record-word")
    record.add_argument("word")
    record.add_argument("--list", choices=LISTS, default="curated", dest="list_name")

    legacy = command.add_parser("align-legacy")
    legacy.add_argument("word")

    args = parser.parse_args()

    if args.command == "add":
        add_word(args.word, args.list_name, args.forced)
    elif args.command == "update-size-test":
        update_size_test()
    elif args.command == "align-legacy":
        align_legacy(args.word)
    else:
        record_word(args.word, args.list_name)


if __name__ == "__main__":
    main()
