#!/usr/bin/env python3
"""Shared frequency waterfall: wordfreq -> Norvig -> Google Books.

A word's rarity comes from the first corpus that attests it: wordfreq's measured
Zipf where it has one, else a Zipf estimated from Norvig's Google Web 1T counts,
else one from Google Books (calibrated onto the Norvig scale), else nothing --
no corpus attests the word.

Both generate-data.py (scoring the whole dictionary) and manage-extra-word.py
(deciding whether a single word has any rarity score at all) import this so the
"does it have a Zipf" question is answered the same way in both places.

These count lists are generation-time inputs only; they never ship to the
browser.
"""
import math
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Norvig's Google Web 1T unigram counts (norvig.com/ngrams/count_1w.txt) and
# Google Books English 1-grams (v3 20200217), pre-filtered to our words. Both
# are tab-separated `word<TAB>count` lists.
NORVIG_COUNTS_PATH = ROOT / "scripts" / "norvig-count-1w.txt"
GOOGLE_BOOKS_COUNTS_PATH = ROOT / "scripts" / "google-books-counts.txt"

WORD_RE = re.compile(r"^[a-z]+$")


def load_counts(path: Path) -> dict[str, int]:
    """Load a `word<TAB>count` frequency list, keeping pure a-z tokens."""
    counts: dict[str, int] = {}
    if not path.exists():
        return counts
    for line in path.read_text(errors="ignore").splitlines():
        word, _, count = line.partition("\t")
        word = word.strip().lower()
        if not count or not WORD_RE.match(word):
            continue
        try:
            counts[word] = counts.get(word, 0) + int(count)
        except ValueError:
            continue
    return counts


class FrequencyWaterfall:
    """wordfreq -> Norvig -> Google Books Zipf lookup for individual words."""

    def __init__(
        self,
        norvig_path: Path = NORVIG_COUNTS_PATH,
        google_path: Path = GOOGLE_BOOKS_COUNTS_PATH,
    ) -> None:
        self.norvig = load_counts(norvig_path)
        self.norvig_log_total = (
            math.log10(sum(self.norvig.values())) if self.norvig else None
        )
        self.google = load_counts(google_path)
        # Anchor Google Books to the Norvig scale: pick the offset that makes the
        # two agree (in the median) on the words they both contain.
        overlap = [
            math.log10(self.google[w]) - self.norvig_zipf(w)
            for w in self.google
            if self.norvig_zipf(w) is not None
        ]
        self.google_offset = statistics.median(overlap) if overlap else 0.0

    def norvig_zipf(self, word: str):
        count = self.norvig.get(word)
        if not count or self.norvig_log_total is None:
            return None
        return math.log10(count) - self.norvig_log_total + 9

    def google_zipf(self, word: str):
        count = self.google.get(word)
        if not count:
            return None
        return math.log10(count) - self.google_offset

    def zipf(self, word: str):
        """Waterfall Zipf for a word, or None when no corpus attests it.

        wordfreq where measured, else the Norvig or Google Books estimate. Kept
        unclamped so the deepest attested words keep their true position.
        """
        from wordfreq import zipf_frequency

        wf = zipf_frequency(word, "en", wordlist="best")
        if wf > 0:
            return wf
        for candidate in (self.norvig_zipf(word), self.google_zipf(word)):
            if candidate is not None:
                return candidate
        return None
