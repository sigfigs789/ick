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

WORD_RE = re.compile(r"^[a-z]{3,15}$")
SIZE_ASSERTION_RE = re.compile(r"(expect\(dictionaryWords\)\.toHaveLength\()\d[\d_]*(\);)")


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def add_word(raw_word: str) -> None:
    word = raw_word.strip().lower()
    if not WORD_RE.fullmatch(word):
        sys.exit("Word must contain only English letters and be 3–15 characters long.")
    if word in listed_words(BLOCKLIST_PATH):
        sys.exit(f"{word!r} is blocklisted and cannot be added.")
    if word in json.loads(DICTIONARY_PATH.read_text()):
        sys.exit(f"{word!r} is already in the curated dictionary.")
    if word in listed_words(EXTRA_WORDS_PATH):
        sys.exit(f"{word!r} is already in scripts/extra-words.txt.")

    existing = EXTRA_WORDS_PATH.read_text() if EXTRA_WORDS_PATH.exists() else ""
    prefix = f"{existing.rstrip()}\n" if existing.strip() else ""
    EXTRA_WORDS_PATH.write_text(f"{prefix}{word}\n")
    print(f"Added {word!r} to {EXTRA_WORDS_PATH}")


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


def main() -> None:
    parser = argparse.ArgumentParser()
    command = parser.add_subparsers(dest="command", required=True)
    add = command.add_parser("add")
    add.add_argument("word")
    command.add_parser("update-size-test")
    args = parser.parse_args()

    if args.command == "add":
        add_word(args.word)
    else:
        update_size_test()


if __name__ == "__main__":
    main()
