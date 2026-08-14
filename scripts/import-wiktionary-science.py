#!/usr/bin/env python3
"""Build WordInk's reviewed science-term supplement from English Wiktionary.

Only lower-case, single-token English science-category entries with an exact
wordfreq Zipf estimate are included. This keeps abbreviations, phrases, proper
names, and words with an unknown rarity score out of the game data.

The resulting list is derived from Wiktionary and must remain attributed under
CC BY-SA 4.0. See the header written to the output file.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "scripts" / "wiktionary-accepted.txt"
API_URL = "https://en.wiktionary.org/w/api.php"
# The top-level category deliberately leaves out people, social sciences,
# pseudoscience, and broad technology categories.
CATEGORY = "Category:en:Sciences"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
WORD_RE = re.compile(r"^[a-z]+$")
REQUEST_DELAY_SECONDS = 0.25
MAX_RETRIES = 5
# The category may contain lower-case initialisms. They are not eligible in
# WordInk even when wordfreq can score them.
EXCLUDED_TITLES = {"cps", "lep", "ppmv"}


def category_members(category: str) -> set[str]:
    """Fetch all page titles in an English Wiktionary category."""
    titles: set[str] = set()
    continuation: dict[str, str] = {}
    while True:
        params = {
            "action": "query",
            "format": "json",
            "list": "categorymembers",
            "cmtitle": category,
            "cmtype": "page",
            "cmlimit": "500",
            **continuation,
        }
        request = Request(
            f"{API_URL}?{urlencode(params)}",
            headers={"User-Agent": "WordInk word-list builder (contact: wordink.app)"},
        )
        for attempt in range(MAX_RETRIES):
            try:
                with urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                break
            except HTTPError as error:
                if error.code != 429 or attempt == MAX_RETRIES - 1:
                    raise
                time.sleep(2 ** attempt)
        time.sleep(REQUEST_DELAY_SECONDS)
        titles.update(member["title"] for member in payload["query"]["categorymembers"])
        if "continue" not in payload:
            return titles
        continuation = payload["continue"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Import scored English science terms from Wiktionary.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")

    titles = category_members(CATEGORY)
    eligible = sorted(title for title in titles if WORD_RE.match(title) and title not in EXCLUDED_TITLES)
    accepted = [word for word in eligible if zipf_frequency(word, "en", wordlist="best") > 0.0]

    header = [
        "# Selected English science terms derived from Wiktionary.",
        f"# Source category: https://en.wiktionary.org/wiki/{CATEGORY.replace(' ', '_')}",
        f"# License: CC BY-SA 4.0 ({LICENSE_URL})",
        "# Filtered to lowercase single words with an exact wordfreq Zipf score.",
        "# Regenerate with: python3 scripts/import-wiktionary-science.py",
        "",
    ]
    args.output.write_text("\n".join(header + accepted) + "\n")
    print(f"Read {len(titles)} Wiktionary category entries")
    print(f"Kept {len(eligible)} lowercase single-word entries")
    print(f"Accepted {len(accepted)} terms with a wordfreq rarity score")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
