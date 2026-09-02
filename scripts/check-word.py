#!/usr/bin/env python3
"""Check a single word against the shipped dictionary without changing anything.

Answers three questions for one word, read-only:
  1. Is it a valid (playable) submission? -> membership in src/data/dictionary.json
  2. What is its rarity? -> the Zipf, rarity label, and 0..10 score the game shows,
     computed with the same base-form adjustment as manage-extra-word.py.
  3. If it is not valid, why? -> blocklisted, one of the four rejection-metadata
     categories (proper noun / abbreviation / misspelling / archaic-or-obsolete), or simply not
     on the curated list. For a not-on-list word we also consult the frequency
     waterfall (wordfreq -> Norvig -> Google Books -> Datamuse) to say whether any source
     attests it -- i.e. whether "Add a word" could score it without --forced.

This never writes files and opens no pull request; it only reports. It reuses the
scoring helpers from manage-extra-word.py so a valid word's reported rarity is
exactly what that tool would pin and what a player sees.

Output is GitHub-flavored Markdown on stdout, so the GitHub Action can tee it
straight into the run's step summary.
"""
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
RARITY_PATH = ROOT / "src" / "data" / "rarity.json"
REJECTION_METADATA_PATH = ROOT / "src" / "data" / "rejection-metadata.json"
WORD_REJECTIONS_PATH = ROOT / "src" / "data" / "word-rejections.json"
DERIVED_REJECTIONS_PATH = ROOT / "src" / "data" / "derived-rejections.json"
BLOCKLIST_PATH = SCRIPTS / "blocklist.txt"

# Same input gate as manage-extra-word.py's add: English letters, no length cap
# (the game's own validator in submit.ts and generate-data.py impose no upper
# bound either, so long real words like "gastroenterologist" stay eligible).
WORD_RE = re.compile(r"^[a-z]+$")

# The categories generate-data.py records in rejection-metadata.json, mapped
# to the same player-facing wording submit.ts shows in REJECTION_MESSAGES.
REJECTION_MESSAGES = {
    "proper-noun": "Proper noun. Names aren't playable.",
    "abbreviation": "Abbreviation. Acronyms aren't playable.",
    "name-or-abbreviation": "Name or abbreviation. Not playable.",
    "misspelling": "Not found. Check your spelling?",
    "obsolete": "Obsolete. No longer used.",
    "archaic": "Archaic. Not in modern use.",
    "dated": "Dated. No longer common.",
    "not-a-word": "Not found. Not on the curated list.",
}


def load_scoring_helpers():
    """Import the hyphen-named manage-extra-word.py module for its pure scorers.

    Reused so a valid word's Zipf/label/score here can never drift from what that
    tool pins and what the game displays (see word_rarity() there).
    """
    spec = importlib.util.spec_from_file_location(
        "manage_extra_word", SCRIPTS / "manage-extra-word.py"
    )
    module = importlib.util.module_from_spec(spec)
    # manage-extra-word.py imports `frequency` as a sibling; make it importable.
    sys.path.insert(0, str(SCRIPTS))
    spec.loader.exec_module(module)
    return module


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def rejection_reason(word: str, metadata: dict) -> str | None:
    """The first rejection-metadata category listing `word`, if any.

    Each category is a sorted list (see write_rejection_metadata); a linear `in`
    is fine for a one-off check.
    """
    for reason in ("proper-noun", "abbreviation", "name-or-abbreviation", "misspelling", "obsolete"):
        if word in metadata.get(reason, ()):
            return reason
    return None


def check(raw_word: str) -> tuple[bool, str]:
    """Return (is_valid, markdown_report) for one word."""
    scoring = load_scoring_helpers()
    word = raw_word.strip().lower()
    lines = [f"## Word check: `{word or raw_word.strip()}`", ""]

    if not WORD_RE.fullmatch(word):
        lines += [
            "**❌ Not a valid input.**",
            "",
            "A word must contain only English letters (a–z). Hyphens, spaces, "
            "digits, and punctuation aren't eligible.",
        ]
        return False, "\n".join(lines)

    dictionary = set(json.loads(DICTIONARY_PATH.read_text()))

    # A reviewed rejection (src/data/word-rejections.json) is checked before
    # dictionary membership: such a word is deliberately still on the curated list
    # -- so its rarity entry stays aligned and past puzzles keep scoring -- but it
    # is not playable, and this is the only source that can say why.
    rejections = (
        json.loads(WORD_REJECTIONS_PATH.read_text()) if WORD_REJECTIONS_PATH.exists() else {}
    )
    if word in rejections:
        entry = rejections[word]
        lines += [
            "**❌ Not valid** — this word was reviewed and rejected.",
            "",
            f"**Reason:** {REJECTION_MESSAGES.get(entry['reason'], entry['reason'])}",
            "",
            f"Rejected as `{entry['reason']}` for puzzles from **{entry['since']}** onward. "
            + (f"{entry['note'].rstrip('.')}. " if entry.get("note") else "")
            + "It stays in the curated list so earlier puzzles still score it, but it "
            "can no longer be submitted.",
        ]
        return False, "\n".join(lines)

    # The derived rejections (src/data/derived-rejections.json) are the same kind of
    # verdict, read off Wiktionary's sense labels in bulk: the word keeps its
    # dictionary slot so past puzzles still score it, but it can't be submitted from
    # its recorded date on.
    derived = (
        json.loads(DERIVED_REJECTIONS_PATH.read_text())
        if DERIVED_REJECTIONS_PATH.exists()
        else {}
    )
    derived_entry = next(
        (
            (since, reason)
            for since, by_reason in sorted(derived.items())
            for reason, words in sorted(by_reason.items())
            if word in set(words)
        ),
        None,
    )
    if derived_entry is not None:
        since, reason = derived_entry
        lines += [
            "**❌ Not valid** — this word carries a rejection reason.",
            "",
            f"**Reason:** {REJECTION_MESSAGES.get(reason, reason)}",
            "",
            (
                "Wiktionary marks every ordinary sense of it that way"
                if reason in ("obsolete", "archaic", "dated")
                else "Wiktionary records no ordinary sense for it"
            )
            + f", so it is unplayable for puzzles from **{since}** onward. It stays "
            "in the curated list so earlier puzzles still score it.",
        ]
        return False, "\n".join(lines)

    if word in dictionary:
        # Valid: score it exactly as the game does (base-form adjustment included).
        zipf, label, score = scoring.word_rarity(word)
        lines += [
            "**✅ Valid** — this word is on WordInk's curated list and is playable.",
            "",
            "| Metric | Value |",
            "| --- | --- |",
            f"| Rarity score | **{scoring.format_score(score)}** / 10 |",
            f"| Rarity tier | **{label}** |",
            f"| Zipf frequency | {zipf} |",
            "",
            "_Rarity score runs 0 (everyday) to 10 (deep-tail); higher is rarer. "
            "The Zipf and score reflect the current (newest) scoring system and "
            "include base-form adjustments (e.g. a tense form inherits its base)._",
        ]
        return True, "\n".join(lines)

    # Invalid: work out the most specific reason.
    lines.append("**❌ Not valid** — this word can't be played.")
    lines.append("")

    if word in listed_words(BLOCKLIST_PATH):
        lines.append(
            "**Reason:** it's on the blocklist (`scripts/blocklist.txt`) and is "
            "excluded on purpose."
        )
        return False, "\n".join(lines)

    metadata = json.loads(REJECTION_METADATA_PATH.read_text())
    reason = rejection_reason(word, metadata)
    if reason is not None:
        lines.append(f"**Reason:** {REJECTION_MESSAGES[reason]}")
        lines.append("")
        lines.append(
            "Proper nouns, abbreviations/acronyms, misspellings, and archaic or "
            "obsolete words are filtered out of the curated list to keep play consistent."
        )
        return False, "\n".join(lines)

    # Not on the list and no rejection category explains it. Consult the
    # frequency waterfall so the report can say whether it's even scoreable.
    lines.append("**Reason:** it's not on WordInk's curated word list.")
    lines.append("")
    zipf = scoring.FrequencyWaterfall().zipf(word, include_bound=True)
    if zipf is None:
        lines.append(
            "No frequency source (wordfreq → Norvig → Google Books → Datamuse) attests this "
            "word, so it has no measured rarity. The **Add a word** action would "
            "reject it unless run with `forced=true` (which scores it the maximum "
            "10.0 / Legend)."
        )
    else:
        lines.append(
            f"It _is_ attested by a frequency corpus (Zipf ≈ {zipf:.2f}), so the "
            "**Add a word** action could add and score it. It just hasn't been "
            "added to the curated list yet."
        )
    return False, "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Check one word, read-only.")
    parser.add_argument("word", help="the English word to check")
    args = parser.parse_args()
    is_valid, report = check(args.word)
    print(report)
    # Exit 0 either way: an invalid word is a valid, expected result of a check,
    # not a run failure. (A malformed input still exits 0 with an explanation.)
    _ = is_valid


if __name__ == "__main__":
    main()
