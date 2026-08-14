#!/usr/bin/env python3
"""Build WordInk's scored word supplement from English Wiktionary.

Only lower-case, single-token English entries with an exact wordfreq Zipf
estimate are included. This keeps phrases, capitalized proper names, and words
with an unknown rarity score out of the game data.

The resulting list is derived from Wiktionary and must remain attributed under
CC BY-SA 4.0. See the header written to the output file.
"""
import argparse
import gzip
import io
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "scripts" / "wiktionary-accepted.txt"
SOURCE_URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
WORD_RE = re.compile(r"^[a-z]+$")
# The category may contain lower-case initialisms. They are not eligible in
# WordInk even when wordfreq can score them.
EXCLUDED_TITLES = {"cps", "lep", "ppmv"}


def wiktionary_words() -> tuple[set[str], int]:
    """Stream the full Wiktextract dump and return eligible English headwords."""
    request = Request(SOURCE_URL, headers={"User-Agent": "WordInk word-list builder (wordink.app)"})
    words: set[str] = set()
    english_entries = 0
    with urlopen(request, timeout=120) as response:
        with gzip.GzipFile(fileobj=response) as compressed:
            for line in io.TextIOWrapper(compressed, encoding="utf-8"):
                entry = json.loads(line)
                if entry.get("lang_code") != "en":
                    continue
                english_entries += 1
                word = entry.get("word", "")
                if WORD_RE.fullmatch(word) and word not in EXCLUDED_TITLES:
                    words.add(word)
    return words, english_entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Import scored English science terms from Wiktionary.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")

    titles, english_entries = wiktionary_words()
    eligible = sorted(titles)
    accepted = [word for word in eligible if zipf_frequency(word, "en", wordlist="best") > 0.0]

    header = [
        "# Accepted English single-word entries derived from Wiktionary.",
        "# Source extract: https://kaikki.org/dictionary/rawdata.html",
        f"# License: CC BY-SA 4.0 ({LICENSE_URL})",
        "# Filtered to lowercase single words with an exact wordfreq Zipf score.",
        "# Regenerate with: python3 scripts/import-wiktionary-science.py",
        "",
    ]
    args.output.write_text("\n".join(header + accepted) + "\n")
    print(f"Read {english_entries} English Wiktionary entries")
    print(f"Kept {len(eligible)} lowercase single-word entries")
    print(f"Accepted {len(accepted)} terms with a wordfreq rarity score")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
