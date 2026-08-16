#!/usr/bin/env python3
"""Build WordInk's scored word supplement and lexical reasons from Wiktionary.

Two outputs from a single pass over the Wiktextract dump:

  1. wiktionary-accepted.txt -- lower-case, single-token English headwords with
     an exact wordfreq Zipf estimate. This keeps phrases, capitalized proper
     names, and words with an unknown rarity score out of the game data.

  2. wiktionary-reasons.json -- for the words Wiktionary marks as ineligible
     (proper nouns, abbreviations), a misspelling/mangling of another headword
     (misspelling, pronunciation spelling, misconstruction), or out of current
     use (obsolete / archaic / dated), a `{reason: [sorted words]}` map in the
     same shape as src/data/rejection-metadata.json. generate-data.py merges
     this with the ESDB classification so a rejected word gets an accurate
     error message.

     Tags are per *sense*: a word archaic in one sense but current in another
     stays playable. So a word earns a status or misspelling reason only when
     *every* ordinary sense qualifies, and a name/abbreviation reason only when
     it has no ordinary part of speech at all. When a word is disqualified by
     more than one status the mildest surviving register wins (dated over
     archaic over obsolete) so the message never overstates how dead the word
     is.

The resulting data is derived from Wiktionary and must remain attributed under
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
DEFAULT_REASONS_OUTPUT = ROOT / "scripts" / "wiktionary-reasons.json"
SOURCE_URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
WORD_RE = re.compile(r"^[a-z]+$")
# The category may contain lower-case initialisms. They are not eligible in
# WordInk even when wordfreq can score them.
EXCLUDED_TITLES = {"cps", "lep", "ppmv"}

# Wiktextract part-of-speech codes that make a word ineligible on their own.
NAME_POS = {"name"}  # proper nouns
ABBR_POS = {"abbrev"}

# Sense tags that mark a sense as out of current use, ranked by severity. A word
# is only disqualified when *every* ordinary sense carries one of these, and the
# reason chosen is the mildest (most-alive) register among them.
STATUS_SEVERITY = {"obsolete": 3, "archaic": 2, "dated": 1}
SEVERITY_REASON = {3: "obsolete", 2: "archaic", 1: "dated"}
# Sense tags that mark a sense as an abbreviation rather than an ordinary word.
ABBREV_TAGS = {"abbreviation", "initialism", "acronym"}
# Sense tags that mark a sense as not a word in its own right, but a wrong
# rendering of another headword: a misspelling (e.g. "freind" glossed as
# "Misspelling of friend."), a phonetic/pronunciation spelling of one (which
# Wiktextract's {{eye dialect of}} template also tags this way), or a
# grammatically wrong formation of one ({{misconstruction of}}, e.g.
# "temptative" for "tentative"). wordfreq still assigns these a nonzero score
# -- people type them often enough to show up in corpora -- so this check is
# what keeps them out of play. Deliberately narrow: broader register tags like
# "nonstandard"/"informal"/"rare" also mark plenty of legitimately playable
# words, so they'd cause false exclusions if added here.
MISSPELLING_TAGS = {"misspelling", "pronunciation-spelling", "misconstruction"}


def sense_severity(tags: set[str]) -> int:
    """Out-of-use severity for a sense's tag set (0 = in current use)."""
    return max((STATUS_SEVERITY.get(tag, 0) for tag in tags), default=0)


def stream_wiktionary() -> tuple[dict[str, dict], int]:
    """Stream the full Wiktextract dump, aggregating per-headword lexical data.

    Returns (records, english_entry_count). Each record collects the set of
    parts of speech seen for a headword plus, for its ordinary (non-name,
    non-abbreviation) senses, the out-of-use severity and whether the sense is
    an abbreviation or a misspelling -- everything classify() needs and
    nothing else.
    """
    request = Request(SOURCE_URL, headers={"User-Agent": "WordInk word-list builder (wordink.app)"})
    records: dict[str, dict] = {}
    english_entries = 0
    with urlopen(request, timeout=120) as response:
        with gzip.GzipFile(fileobj=response) as compressed:
            for line in io.TextIOWrapper(compressed, encoding="utf-8"):
                entry = json.loads(line)
                if entry.get("lang_code") != "en":
                    continue
                english_entries += 1
                word = entry.get("word", "")
                if not WORD_RE.fullmatch(word):
                    continue

                record = records.setdefault(
                    word, {"pos": set(), "ord_sev": [], "ord_abbrev": [], "ord_misspelling": []}
                )
                pos = entry.get("pos", "")
                record["pos"].add(pos)
                # Senses of a name/abbreviation entry say nothing about whether
                # the word's ordinary senses are still in use, so skip them.
                if pos in NAME_POS or pos in ABBR_POS:
                    continue

                entry_tags = set(entry.get("tags") or [])
                senses = entry.get("senses") or [{}]
                for sense in senses:
                    tags = set(sense.get("tags") or []) | entry_tags
                    record["ord_sev"].append(sense_severity(tags))
                    record["ord_abbrev"].append(bool(tags & ABBREV_TAGS))
                    record["ord_misspelling"].append(bool(tags & MISSPELLING_TAGS))
    return records, english_entries


def classify(record: dict) -> str | None:
    """The single rejection reason for a headword, or None if it's playable."""
    pos = record["pos"]
    ordinary_pos = pos - NAME_POS - ABBR_POS
    if not ordinary_pos:
        has_name = bool(pos & NAME_POS)
        has_abbr = bool(pos & ABBR_POS)
        if has_name and has_abbr:
            return "name-or-abbreviation"
        if has_name:
            return "proper-noun"
        if has_abbr:
            return "abbreviation"
        return None  # only symbols/characters/etc. -- not our concern

    severities = record["ord_sev"]
    if not severities:
        return None
    # Every ordinary sense is an abbreviation -> the word itself is one.
    if all(record["ord_abbrev"]):
        return "abbreviation"
    # Every ordinary sense is a misspelling of another headword -> not a word
    # of its own, regardless of how often people type it that way.
    if all(record["ord_misspelling"]):
        return "misspelling"
    # Every ordinary sense is out of current use -> pick the mildest register.
    if all(severity >= 1 for severity in severities):
        return SEVERITY_REASON[min(severities)]
    return None


def build_reasons(records: dict[str, dict]) -> dict[str, list[str]]:
    """Group disqualified headwords by reason, `{reason: [sorted words]}`."""
    grouped: dict[str, list[str]] = {}
    for word, record in records.items():
        reason = classify(record)
        if reason:
            grouped.setdefault(reason, []).append(word)
    for words in grouped.values():
        words.sort()
    return grouped


def main() -> None:
    parser = argparse.ArgumentParser(description="Import scored English terms from Wiktionary.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--reasons-output", type=Path, default=DEFAULT_REASONS_OUTPUT)
    args = parser.parse_args()
    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")

    records, english_entries = stream_wiktionary()
    eligible = sorted(word for word in records if word not in EXCLUDED_TITLES)
    accepted = [word for word in eligible if zipf_frequency(word, "en", wordlist="best") > 0.0]

    header = [
        "# Accepted English single-word entries derived from Wiktionary.",
        "# Source extract: https://kaikki.org/dictionary/rawdata.html",
        f"# License: CC BY-SA 4.0 ({LICENSE_URL})",
        "# Filtered to lowercase single words with an exact wordfreq Zipf score.",
        "# Regenerate with: python3 scripts/import-wiktionary-words.py",
        "",
    ]
    args.output.write_text("\n".join(header + accepted) + "\n")

    reasons = build_reasons(records)
    args.reasons_output.write_text(json.dumps(reasons, separators=(",", ":"), sort_keys=True))

    print(f"Read {english_entries} English Wiktionary entries")
    print(f"Kept {len(eligible)} lowercase single-word entries")
    print(f"Accepted {len(accepted)} terms with a wordfreq rarity score")
    print(f"Wrote {args.output}")
    for reason in sorted(reasons):
        print(f"  {reason:20s} {len(reasons[reason])}")
    print(f"Wrote {args.reasons_output}")


if __name__ == "__main__":
    main()
