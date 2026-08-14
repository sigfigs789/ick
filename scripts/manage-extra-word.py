#!/usr/bin/env python3
"""Add a curated word and maintain the dictionary-size regression test."""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTRA_WORDS_PATH = ROOT / "scripts" / "extra-words.txt"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
DICTIONARY_TEST_PATH = ROOT / "src" / "game" / "dictionary.test.ts"

WORD_RE = re.compile(r"^[a-z]{1,15}$")
SIZE_ASSERTION_RE = re.compile(r"(expect\(dictionaryWords\)\.toHaveLength\()\d[\d_]*(\);)")
CURATED_WORDS_RE = re.compile(
    r'(const explicitlyCuratedWords = )\[[^\]]*\](;)', re.DOTALL
)


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def rarity_score(word: str) -> float:
    """Frequency-derived Zipf score for a word, matching generate-data.py.

    A 0.0 means wordfreq has no usable estimate for the word. We refuse to add
    such words instead of letting the pipeline assign them the arbitrary
    unknown-frequency fallback (a displayed rarity of 9.4), which is a guess
    rather than a real measurement.
    """
    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")
    return zipf_frequency(word, "en", wordlist="best")


def add_word(raw_word: str) -> None:
    word = raw_word.strip().lower()
    if not WORD_RE.fullmatch(word):
        sys.exit("Word must contain only English letters and be 1–15 characters long.")
    if word in listed_words(BLOCKLIST_PATH):
        sys.exit(f"{word!r} is blocklisted and cannot be added.")
    if word in json.loads(DICTIONARY_PATH.read_text()):
        sys.exit(f"{word!r} is already in the curated dictionary.")
    if word in listed_words(EXTRA_WORDS_PATH):
        sys.exit(f"{word!r} is already in scripts/extra-words.txt.")

    zipf = rarity_score(word)
    if zipf == 0.0:
        sys.exit(f"{word!r} has no rarity score and cannot be added.")

    existing = EXTRA_WORDS_PATH.read_text() if EXTRA_WORDS_PATH.exists() else ""
    prefix = f"{existing.rstrip()}\n" if existing.strip() else ""
    EXTRA_WORDS_PATH.write_text(f"{prefix}{word}\n")
    print(f"Added {word!r} to {EXTRA_WORDS_PATH} (rarity score {zipf:.2f})")


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


def update_curated_word_test(raw_word: str) -> None:
    word = raw_word.strip().lower()
    contents = DICTIONARY_TEST_PATH.read_text()
    match = CURATED_WORDS_RE.search(contents)
    if not match:
        sys.exit("Could not find the explicitly curated words test list.")

    existing_words = re.findall(r'"([a-z]+)"', match.group(0))
    words = sorted(set(existing_words) | {word})
    formatted_words = ", ".join(f'"{item}"' for item in words)
    replacement = f"{match.group(1)}[{formatted_words}]{match.group(2)}"
    updated = contents[: match.start()] + replacement + contents[match.end() :]
    DICTIONARY_TEST_PATH.write_text(updated)
    print(f"Added {word!r} to the curated-word validity test.")


def main() -> None:
    parser = argparse.ArgumentParser()
    command = parser.add_subparsers(dest="command", required=True)
    add = command.add_parser("add")
    add.add_argument("word")
    command.add_parser("update-size-test")
    word_test = command.add_parser("update-curated-word-test")
    word_test.add_argument("word")
    args = parser.parse_args()

    if args.command == "add":
        add_word(args.word)
    elif args.command == "update-size-test":
        update_size_test()
    else:
        update_curated_word_test(args.word)


if __name__ == "__main__":
    main()
